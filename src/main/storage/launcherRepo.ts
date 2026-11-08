/**
 * 启动中心数据访问层（v6）
 *
 * 分组：launcher_groups（默认分组 is_default=1，不可删除，可改名；名称全局唯一）
 * 启动项：launcher_entries（属于一个分组，组内 sort_order 排序）
 */
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db'
import type { LauncherEntry, LauncherGroup, LauncherInput, LauncherType } from '../../shared/types'

const DEFAULT_GROUP_NAME = '默认分组'

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function serializeTags(tags: string[] | undefined): string {
  const list = [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))]
  return JSON.stringify(list)
}

function mapEntry(row: Record<string, unknown>): LauncherEntry {
  return {
    ...(row as unknown as LauncherEntry),
    tags: parseTags(String(row.tags_json ?? '[]'))
  }
}

function typeFromPath(filePath: string): LauncherType | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.exe') return 'exe'
  if (ext === '.bat') return 'bat'
  if (ext === '.cmd') return 'cmd'
  return null
}

// ── 分组 ─────────────────────────────────────────────────

export function listGroups(): LauncherGroup[] {
  return getDb()
    .prepare(
      `SELECT g.*, COUNT(e.id) AS count
       FROM launcher_groups g
       LEFT JOIN launcher_entries e ON e.group_id = g.id
       GROUP BY g.id
       ORDER BY g.is_default DESC, g.created_at ASC, g.id ASC`
    )
    .all() as LauncherGroup[]
}

export function getGroup(id: number): LauncherGroup | undefined {
  return getDb().prepare('SELECT * FROM launcher_groups WHERE id = ?').get(id) as
    | LauncherGroup
    | undefined
}

export function getDefaultGroup(): LauncherGroup | undefined {
  return getDb()
    .prepare('SELECT * FROM launcher_groups WHERE is_default = 1 ORDER BY id LIMIT 1')
    .get() as LauncherGroup | undefined
}

/** 新建分组；重名/空名返回错误 */
export function addGroup(name: string): { ok: boolean; data?: LauncherGroup; error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '分组名称不能为空' }
  const db = getDb()
  const dup = db.prepare('SELECT id FROM launcher_groups WHERE name = ?').get(trimmed)
  if (dup) return { ok: false, error: '分组名称已存在' }
  const info = db
    .prepare('INSERT INTO launcher_groups (name, is_default, created_at) VALUES (?, 0, ?)')
    .run(trimmed, Date.now())
  return {
    ok: true,
    data: getGroup(Number(info.lastInsertRowid))
  }
}

/** 重命名分组（默认分组不可改名，其余分组可改名；重名报错） */
export function renameGroup(id: number, name: string): { ok: boolean; error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '分组名称不能为空' }
  const db = getDb()
  const group = getGroup(id)
  if (!group) return { ok: false, error: '分组不存在' }
  if (group.is_default === 1) return { ok: false, error: '默认分组不可重命名' }
  if (group.name === trimmed) return { ok: true }
  const dup = db.prepare('SELECT id FROM launcher_groups WHERE name = ? AND id != ?').get(trimmed, id)
  if (dup) return { ok: false, error: '分组名称已存在' }
  db.prepare('UPDATE launcher_groups SET name = ? WHERE id = ?').run(trimmed, id)
  return { ok: true }
}

/** 删除分组（默认分组不可删）；组内启动项级联删除，返回删除数量 */
export function deleteGroup(id: number): { ok: boolean; error?: string; deletedItems?: number } {
  const db = getDb()
  const group = getGroup(id)
  if (!group) return { ok: false, error: '分组不存在' }
  if (group.is_default === 1) return { ok: false, error: '默认分组不可删除' }
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM launcher_entries WHERE group_id = ?')
    .get(id) as { c: number }
  db.prepare('DELETE FROM launcher_groups WHERE id = ?').run(id) // 启动项级联删除
  return { ok: true, deletedItems: count.c }
}

// ── 启动项 ───────────────────────────────────────────────

/** 启动项列表（可按分组过滤），组内按排序 */
export function listEntries(groupId?: number | null): LauncherEntry[] {
  const db = getDb()
  const sql = `SELECT e.*, g.name AS group_name
               FROM launcher_entries e
               JOIN launcher_groups g ON g.id = e.group_id
               ${groupId != null ? 'WHERE e.group_id = ?' : ''}
               ORDER BY e.sort_order ASC, e.id ASC`
  const rows = (groupId != null
    ? db.prepare(sql).all(groupId)
    : db.prepare(sql).all()) as Record<string, unknown>[]
  return rows.map(mapEntry)
}

export function getEntry(id: number): LauncherEntry | undefined {
  const row = getDb()
    .prepare(
      `SELECT e.*, g.name AS group_name
       FROM launcher_entries e JOIN launcher_groups g ON g.id = e.group_id
       WHERE e.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? mapEntry(row) : undefined
}

function nextSortOrder(groupId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM launcher_entries WHERE group_id = ?')
    .get(groupId) as { m: number }
  return row.m + 1
}

export function addEntry(
  input: LauncherInput,
  iconPath: string | null
): { ok: boolean; data?: LauncherEntry; error?: string } {
  const name = input.name.trim()
  if (!name) return { ok: false, error: '名称不能为空' }
  if (!input.file_path) return { ok: false, error: '请选择启动文件' }
  if (!fs.existsSync(input.file_path)) return { ok: false, error: '启动文件不存在' }
  const type = typeFromPath(input.file_path)
  if (!type) return { ok: false, error: '只支持 .exe / .bat / .cmd 文件' }
  const group = getGroup(input.group_id)
  if (!group) return { ok: false, error: '分组不存在' }
  const dir = path.dirname(input.file_path)
  const now = Date.now()
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO launcher_entries
        (name, type, file_path, dir_path, group_id, tags_json, run_as_admin, icon_path,
         sort_order, last_run_at, run_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
    )
    .run(
      name,
      type,
      input.file_path,
      dir,
      group.id,
      serializeTags(input.tags),
      input.run_as_admin ? 1 : 0,
      iconPath,
      nextSortOrder(group.id),
      now,
      now
    )
  return { ok: true, data: getEntry(Number(info.lastInsertRowid)) }
}

export function updateEntry(
  id: number,
  patch: Partial<LauncherInput>,
  iconPath?: string | null
): { ok: boolean; data?: LauncherEntry; error?: string } {
  const db = getDb()
  const current = getEntry(id)
  if (!current) return { ok: false, error: '启动项不存在' }

  const sets: string[] = []
  const args: unknown[] = []
  const push = (col: string, v: unknown): void => {
    sets.push(`${col} = ?`)
    args.push(v)
  }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: '名称不能为空' }
    push('name', name)
  }
  let filePath = current.file_path
  if (patch.file_path !== undefined && patch.file_path !== current.file_path) {
    if (!patch.file_path || !fs.existsSync(patch.file_path)) {
      return { ok: false, error: '启动文件不存在' }
    }
    const type = typeFromPath(patch.file_path)
    if (!type) return { ok: false, error: '只支持 .exe / .bat / .cmd 文件' }
    filePath = patch.file_path
    push('file_path', filePath)
    push('type', type)
    push('dir_path', path.dirname(filePath))
  }
  if (patch.group_id !== undefined && patch.group_id !== current.group_id) {
    const group = getGroup(patch.group_id)
    if (!group) return { ok: false, error: '分组不存在' }
    push('group_id', group.id)
    push('sort_order', nextSortOrder(group.id))
  }
  if (patch.tags !== undefined) push('tags_json', serializeTags(patch.tags))
  if (patch.run_as_admin !== undefined) push('run_as_admin', patch.run_as_admin ? 1 : 0)
  if (iconPath !== undefined) push('icon_path', iconPath)

  if (sets.length > 0) {
    push('updated_at', Date.now())
    db.prepare(`UPDATE launcher_entries SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
  }
  return { ok: true, data: getEntry(id) }
}

export function deleteEntry(id: number): boolean {
  return getDb().prepare('DELETE FROM launcher_entries WHERE id = ?').run(id).changes > 0
}

/** 组内拖拽排序：按传入顺序写 sort_order */
export function reorderEntries(groupId: number, orderedIds: number[]): void {
  const db = getDb()
  const ids = orderedIds.filter((n) => Number.isInteger(n) && n > 0)
  const tx = db.transaction((): void => {
    const upd = db.prepare(
      'UPDATE launcher_entries SET sort_order = ?, updated_at = ? WHERE id = ? AND group_id = ?'
    )
    ids.forEach((id, index) => upd.run(index, Date.now(), id, groupId))
  })
  tx()
}

/** 记录一次启动（用于"最近启动时间"） */
export function recordRun(id: number): void {
  getDb()
    .prepare(
      'UPDATE launcher_entries SET last_run_at = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?'
    )
    .run(Date.now(), Date.now(), id)
}

/** 默认分组名称（供 UI 兜底） */
export const LAUNCHER_DEFAULT_GROUP = DEFAULT_GROUP_NAME
