/**
 * 消息 JSON 归一化：把"任意结构"的 JSON 整理成可读消息 + 结构化字段
 *
 * 设计目标（v1 闭环）：第三方只需 POST 一段任意 JSON（或轮询返回任意 JSON），
 * 无需按固定 schema 对接，也能得到：
 *   - title：尽量取名称/标题类字段
 *   - body：取留言/内容类字段，没有则把其余字段拼成可读文本
 *   - fields：完整键值对（嵌套对象按 "父.子" 展平），供消息中心展示
 *   - dedupKey：优先 id 类字段，其次旧的"时间|电话|联系人"组合，
 *     最后用内容哈希（同一份数据重复推送不会重复入库）
 *
 * 兼容性：轮询连接器（legacyComposite=true）生成的 dedupKey 与旧版完全一致，
 * 升级后不会把已入库的历史线索重新导入一遍。
 */
import { createHash } from 'node:crypto'
import type { HubMessageKind, MessageField } from '../../shared/datahub'

/** 公司/组织候选字段 */
const COMPANY_KEYS = ['企业名称', '公司名称', '公司', '企业', 'customer', 'company', 'customerName']

/** 标题候选字段（按优先级） */
const TITLE_KEYS = [
  'title',
  'subject',
  'name'
]

/** 正文候选字段（按优先级） */
const MESSAGE_KEYS = [
  'message',
  'content',
  'body',
  'description',
  'desc',
  'detail',
  'details',
  'remark',
  'remarks',
  'note',
  'notes',
  'text',
  'msg',
  '留言',
  '备注',
  '需求',
  '需求描述',
  '内容',
  '说明',
  '咨询内容',
  '问题描述'
]

/** id 候选字段（用于去重） */
const ID_KEYS = ['id', 'ID', '_id', 'uuid', 'guid', 'orderId', 'order_id', 'requestId', 'request_id', 'leadId', 'lead_id', 'formId', 'form_id', '编号', '单号', '#']

/** 时间候选字段 */
const TIME_KEYS = ['time', 'timestamp', 'createdAt', 'created_at', '提交时间', '时间', 'date', 'datetime', 'submitTime', 'submit_time']

/** 电话/微信候选字段 */
const PHONE_KEYS = ['联系电话 / 微信', '联系电话', '电话', '手机号', '手机', '微信', 'phone', 'mobile', 'tel', 'telephone', 'wechat']

/** 联系人候选字段 */
const CONTACT_KEYS = ['联系人', '联系人/姓名', '姓名', 'contact', 'customerName', 'name']

/** 数组包裹的常见字段名：从这些字段里递归取出记录数组 */
const LIST_KEYS = ['data', 'leads', 'list', 'items', 'records', 'rows', 'results', 'result', 'messages', 'entries']

const MAX_FIELDS = 30
const MAX_VALUE_LEN = 600
const MAX_BODY_LEN = 1200

export interface NormalizeOptions {
  /** 消息类型（轮询线索默认 lead；Webhook 默认 info） */
  kind?: HubMessageKind
  /** 轮询连接器：使用旧版 dedupKey 组合，保证升级后不重复导入历史线索 */
  legacyComposite?: boolean
}

export interface NormalizedMessage {
  sourceId: string
  sourceName: string
  kind: HubMessageKind
  title: string
  body: string
  dedupKey: string
  fields: MessageField[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 值转文本：数组用顿号连接，对象转 JSON；空值返回空串 */
function valueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === 'object' ? '' : String(v).trim()))
      .filter(Boolean)
    return parts.join('、')
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 把一条记录展平成键值对（嵌套对象按 "父.子" 命名；数组收成一行） */
export function flattenRecord(record: Record<string, unknown>, prefix = '', depth = 0): MessageField[] {
  const out: MessageField[] = []
  if (depth > 3) return out
  for (const [key, raw] of Object.entries(record)) {
    const label = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(raw)) {
      out.push(...flattenRecord(raw, label, depth + 1))
      continue
    }
    const text = valueToText(raw)
    if (!text) continue
    out.push({ label, value: text.length > MAX_VALUE_LEN ? text.slice(0, MAX_VALUE_LEN) + '…' : text })
  }
  return out
}

/** 按候选键取值（先精确匹配，再忽略大小写） */
function pick(fields: MessageField[], keys: string[]): string {
  for (const key of keys) {
    const hit = fields.find((f) => f.label === key)
    if (hit) return hit.value
  }
  const lower = new Map(fields.map((f) => [f.label.toLowerCase(), f.value]))
  for (const key of keys) {
    const hit = lower.get(key.toLowerCase())
    if (hit) return hit
  }
  return ''
}

/** 稳定序列化（键排序）后做短哈希，作为内容去重键 */
function contentHash(record: Record<string, unknown>): string {
  const stable = stableStringify(record)
  return createHash('sha1').update(stable).digest('hex').slice(0, 16)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : { value }
}

/**
 * 从任意 JSON 中取出"记录数组"：
 *  - 数组 → 每个元素一条
 *  - 对象 → 常见包裹字段（data/leads/list…）里的数组，否则整体一条
 */
export function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord)
  if (isPlainObject(payload)) {
    for (const key of LIST_KEYS) {
      const v = payload[key]
      if (Array.isArray(v) && v.length > 0) return v.map(asRecord)
    }
    return [payload]
  }
  return []
}

/** 把一条记录归一化成消息 */
export function normalizeRecord(
  sourceId: string,
  sourceName: string,
  record: Record<string, unknown>,
  opts: NormalizeOptions = {}
): NormalizedMessage {
  const fields = flattenRecord(record).slice(0, MAX_FIELDS)
  const title = buildTitle(fields) || sourceName
  const message = pick(fields, MESSAGE_KEYS)
  const body = (message || buildFieldBody(fields, title)).slice(0, MAX_BODY_LEN)

  const id = pick(fields, ID_KEYS)
  let dedupKey: string
  if (id) {
    dedupKey = `${sourceId}:${id}`
  } else if (opts.legacyComposite) {
    // 与旧版轮询去重键完全一致：`${连接器}:${时间}|${电话}|${联系人}`
    const time = pick(fields, TIME_KEYS)
    const phone = pick(fields, PHONE_KEYS)
    const contact = pick(fields, CONTACT_KEYS)
    dedupKey = `${sourceId}:${time}|${phone}|${contact}`
  } else {
    dedupKey = `${sourceId}:h${contentHash(record)}`
  }

  if (!title && !body) {
    return {
      sourceId,
      sourceName,
      kind: opts.kind ?? 'info',
      title: `${sourceName} 新消息`,
      body: '',
      dedupKey: `${sourceId}:h${contentHash(record)}`,
      fields
    }
  }

  return {
    sourceId,
    sourceName,
    kind: opts.kind ?? 'info',
    title: title.slice(0, 120),
    body,
    dedupKey,
    fields
  }
}

/** 没有标题候选时的兜底：取第一个不算太长的字符串字段 */
function firstReadable(fields: MessageField[]): string {
  const hit = fields.find((f) => f.value.length > 0 && f.value.length <= 80)
  return hit?.value ?? ''
}

/**
 * 标题策略：优先 title/subject/name；
 * 否则"公司 · 联系人"（与旧版官网表单标题一致）；再否则第一个可读字段。
 */
function buildTitle(fields: MessageField[]): string {
  const direct = pick(fields, TITLE_KEYS)
  if (direct) return direct
  const company = pick(fields, COMPANY_KEYS)
  const contact = pick(fields, CONTACT_KEYS)
  if (company && contact && company !== contact) return `${company} · ${contact}`
  return company || contact || firstReadable(fields)
}

/** 没有留言类字段时，把除标题外的字段拼成可读正文 */
function buildFieldBody(fields: MessageField[], title: string): string {
  const parts = fields
    .filter((f) => f.value !== title)
    .slice(0, 8)
    .map((f) => `${f.label}：${f.value}`)
  return parts.join(' · ')
}

/**
 * 任意 JSON → 消息数组（0..n 条）。
 * 无法识别为记录时，退化为一条"原始文本"消息，保证不丢消息。
 */
export function normalizePayload(
  sourceId: string,
  sourceName: string,
  payload: unknown,
  opts: NormalizeOptions = {}
): NormalizedMessage[] {
  const records = extractRecords(payload)
  if (records.length > 0) return records.map((r) => normalizeRecord(sourceId, sourceName, r, opts))

  const text = typeof payload === 'string' ? payload : safeStringify(payload)
  if (!text) return []
  return [
    {
      sourceId,
      sourceName,
      kind: opts.kind ?? 'info',
      title: `${sourceName} 新消息`,
      body: text.slice(0, MAX_BODY_LEN),
      dedupKey: `${sourceId}:h${createHash('sha1').update(text).digest('hex').slice(0, 16)}`,
      fields: [{ label: '原始内容', value: text.slice(0, MAX_VALUE_LEN) }]
    }
  ]
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}
