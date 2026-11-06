/**
 * DataHub 存储：连接器配置 + 消息队列，JSON 持久化到 userData/datahub.json
 *
 * v1 闭环要点：
 *  - 去重键（seenKeys）独立持久化，且与"清空消息"解耦：
 *    以前去重只依赖内存 + 最近 500 条消息，清空消息后重启会把历史线索重新导入；
 *    现在 seenKeys 单独保存（上限 5000，FIFO），清空消息不会再触发重放。
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DataSource, HubMessage } from '../../shared/datahub'

interface HubStore {
  connectors: DataSource[]
  messages: HubMessage[]
  /** 已入库过的去重键（独立持久化，清空消息不清它） */
  seenKeys: string[]
}

const MAX_MESSAGES = 500
const MAX_SEEN_KEYS = 5000

let store: HubStore = { connectors: [], messages: [], seenKeys: [] }
let file = ''

export function loadStore(): void {
  file = join(app.getPath('userData'), 'datahub.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<HubStore>
      const messages = Array.isArray(raw.messages) ? raw.messages : []
      // 兼容旧文件：没有 seenKeys 时用已入库消息的去重键初始化（避免升级后重放）
      const seenKeys = Array.isArray(raw.seenKeys)
        ? raw.seenKeys.filter((k): k is string => typeof k === 'string')
        : messages.map((m) => m.dedupKey).filter((k): k is string => typeof k === 'string')
      store = {
        connectors: Array.isArray(raw.connectors) ? raw.connectors : [],
        messages,
        seenKeys: capSeen(seenKeys)
      }
    }
  } catch {
    store = { connectors: [], messages: [], seenKeys: [] }
  }
}

function save(): void {
  try {
    writeFileSync(file, JSON.stringify(store, null, 2))
  } catch {
    // 存储失败不阻断业务
  }
}

function capSeen(keys: string[]): string[] {
  return keys.length > MAX_SEEN_KEYS ? keys.slice(keys.length - MAX_SEEN_KEYS) : keys
}

// ── 连接器 ──────────────────────────────────────────
export function listConnectors(): DataSource[] {
  return [...store.connectors]
}

export function getConnector(id: string): DataSource | undefined {
  return store.connectors.find((c) => c.id === id)
}

export function addConnector(data: Omit<DataSource, 'id' | 'createdAt'>): DataSource {
  const conn: DataSource = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...data
  }
  store.connectors.push(conn)
  save()
  return conn
}

export function updateConnector(id: string, patch: Partial<DataSource>): boolean {
  const idx = store.connectors.findIndex((c) => c.id === id)
  if (idx < 0) return false
  store.connectors[idx] = { ...store.connectors[idx], ...patch, id }
  save()
  return true
}

export function deleteConnector(id: string): boolean {
  const before = store.connectors.length
  store.connectors = store.connectors.filter((c) => c.id !== id)
  const removed = before !== store.connectors.length
  if (removed) save()
  return removed
}

// ── 消息 ────────────────────────────────────────────
/** 最新在前 */
export function listMessages(): HubMessage[] {
  return [...store.messages].reverse()
}

/** 未读数 */
export function getUnreadCount(): number {
  return store.messages.filter((m) => !m.read).length
}

/** 已入库的去重键（供轮询器初始化内存去重集合） */
export function listSeenKeys(): string[] {
  return [...store.seenKeys]
}

/** 入队一条消息；同 dedupKey 幂等去重，返回 null 表示重复 */
export function pushMessage(m: Omit<HubMessage, 'id' | 'read' | 'createdAt'>): HubMessage | null {
  if (store.seenKeys.includes(m.dedupKey)) return null
  const msg: HubMessage = {
    ...m,
    id: randomUUID(),
    read: false,
    createdAt: Date.now()
  }
  store.messages.push(msg)
  if (store.messages.length > MAX_MESSAGES) {
    store.messages = store.messages.slice(-MAX_MESSAGES)
  }
  store.seenKeys.push(m.dedupKey)
  store.seenKeys = capSeen(store.seenKeys)
  save()
  return msg
}

export function markRead(id: string): boolean {
  const m = store.messages.find((x) => x.id === id)
  if (!m) return false
  m.read = true
  save()
  return true
}

export function markAllRead(): boolean {
  let changed = false
  for (const m of store.messages) {
    if (!m.read) {
      m.read = true
      changed = true
    }
  }
  if (changed) save()
  return changed
}

/** 清空消息列表（保留 seenKeys，避免历史消息被重新导入） */
export function clearMessages(): boolean {
  if (store.messages.length === 0) return false
  store.messages = []
  save()
  return true
}
