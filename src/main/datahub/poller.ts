/**
 * 定时轮询连接器（DataHub 第二类数据源）
 *
 * 对 enabled 的 poll 连接器按 pollIntervalSec 间隔拉取：
 *  - 支持 GET / POST（POST 可带自定义 JSON 请求体），可自定义请求头
 *  - 响应为 JSON → 任意结构都交给 normalize 整理成消息（数组/包裹对象/单对象均可）
 *  - 响应为 HTML → 解析 <table> 表格行（后台管理页可直接当数据源）
 * 新记录按 dedupKey 去重后进入消息中心，并通知宠物气泡 / 系统通知。
 */
import type { DataSource } from '../../shared/datahub'
import { listConnectors } from './store'
import { normalizePayload } from './normalize'

export type PolledMessage = ReturnType<typeof normalizePayload>[number]

const ACTIVE_POLLERS = new Map<string, NodeJS.Timeout>()
/** 已完成过一次拉取的连接器：首次拉取只入库、不弹通知（避免开屏轰炸历史线索） */
const POLLED_ONCE = new Set<string>()
let SEEN = new Set<string>()
let seenReady = false

/** 用已入库的去重键初始化去重集合（持久化于 datahub.json，清空消息后也不会重放） */
export function initSeen(seenKeys: string[]): void {
  SEEN = new Set(seenKeys)
  seenReady = true
}

export function stopPollers(): void {
  for (const t of ACTIVE_POLLERS.values()) clearInterval(t)
  ACTIVE_POLLERS.clear()
}

/** 按当前连接器配置启动/重启全部 poller（连接器增删改后调用） */
export function restartPollers(onMessage: (m: PolledMessage, opts?: { silent?: boolean }) => boolean): void {
  stopPollers()
  if (!seenReady) return
  for (const c of listConnectors()) {
    if (c.kind === 'poll' && c.enabled && c.url) {
      schedule(c, onMessage)
    }
  }
}

function schedule(
  c: DataSource,
  onMessage: (m: PolledMessage, opts?: { silent?: boolean }) => boolean
): void {
  const run = async (): Promise<void> => {
    await pollOnce(c, onMessage)
  }
  void run()
  const intervalMs = Math.max(10, c.pollIntervalSec ?? 60) * 1000
  const timer = setInterval(() => void run(), intervalMs)
  ACTIVE_POLLERS.set(c.id, timer)
  console.log(`[poller] 已启动「${c.name}」 每 ${intervalMs / 1000}s ${c.method ?? 'GET'} ${c.url}`)
}

/** 组装请求头：连接器自定义 JSON + token（X-Token） */
function buildHeaders(c: DataSource): Record<string, string> {
  const headers: Record<string, string> = {}
  if (c.requestHeaders) {
    try {
      const parsed = JSON.parse(c.requestHeaders) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsed)) {
        if (v === null || v === undefined) continue
        headers[k] = String(v)
      }
    } catch {
      console.warn(`[poller]「${c.name}」请求头不是合法 JSON，已忽略`)
    }
  }
  if (c.token) headers['X-Token'] = c.token
  return headers
}

async function pollOnce(
  c: DataSource,
  onMessage: (m: PolledMessage, opts?: { silent?: boolean }) => boolean
): Promise<void> {
  try {
    const firstRun = !POLLED_ONCE.has(c.id)
    POLLED_ONCE.add(c.id)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const method = c.method === 'POST' ? 'POST' : 'GET'
    const headers = buildHeaders(c)
    const body = method === 'POST' ? (c.requestBody ?? '') : undefined
    if (method === 'POST' && body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    const res = await fetch(c.url, {
      signal: controller.signal,
      method,
      headers,
      body
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.log(`[poller]「${c.name}」HTTP ${res.status}`)
      return
    }
    const text = await res.text()
    const payload = parseResponse(text, res.headers.get('content-type') ?? '')
    const messages = normalizePayload(c.id, c.name, payload, {
      kind: 'lead',
      legacyComposite: true
    })
    let added = 0
    for (const mapped of messages) {
      if (SEEN.has(mapped.dedupKey)) continue
      // 首次拉取（可能是历史数据）只入库，不打扰
      const ok = onMessage(mapped, { silent: firstRun })
      SEEN.add(mapped.dedupKey)
      if (ok) added++
    }
    if (added > 0) console.log(`[poller]「${c.name}」新增 ${added} 条`)
  } catch (err) {
    console.log(`[poller]「${c.name}」拉取失败：${String(err)}`)
  }
}

// ── 响应解析 ─────────────────────────────────────────────

/** JSON 响应返回原始结构（交给 normalize 自动整理）；HTML 响应解析表格行 */
function parseResponse(text: string, contentType: string): unknown {
  const trimmed = text.trimStart()
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch {
      // JSON 解析失败 → 落到 HTML 表格
    }
  }
  return parseHtmlTable(text)
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

/** 解析 HTML 表格：表头 <th> 映射列名，行 <tr><td> 为单元格 */
function parseHtmlTable(html: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return rows
  const table = tableMatch[1]

  let headers: string[] = []
  const theadMatch = table.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)
  if (theadMatch) {
    headers = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]))
  } else {
    const firstTr = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)
    if (firstTr && /<th/i.test(firstTr[1])) {
      headers = [...firstTr[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]))
    }
  }

  const bodyMatch = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
  const body = bodyMatch ? bodyMatch[1] : table
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]))
    if (cells.length === 0) continue
    const row: Record<string, unknown> = {}
    if (headers.length) {
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? ''
      })
    } else {
      cells.forEach((c, i) => {
        row[`col${i}`] = c
      })
    }
    rows.push(row)
  }
  return rows
}
