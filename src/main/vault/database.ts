/**
 * 密码本数据库层（与 Python 版 core/database.py 完全兼容）
 *
 * 内存 SQLite：entries 表 + 分类索引，增删改查与模糊搜索。
 * 工作库文件为加密容器解密后的临时明文库，随锁定/退出删除。
 */
import Database from 'better-sqlite3'

export const CATEGORY_DEFAULT = '未分类'

export const VAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT '未分类',
    account    TEXT NOT NULL DEFAULT '',
    password   TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name);
`

const _FIELDS = ['name', 'category', 'account', 'password', 'url', 'note'] as const

function now(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

export interface VaultEntry {
  id: number
  name: string
  category: string
  account: string
  password: string
  url: string
  note: string
  created_at: string
  updated_at: string
}

export function initSchema(db: Database.Database): void {
  db.exec(VAULT_SCHEMA)
}

/** 模糊搜索：匹配名称/账号/网址/备注；可按分类精确过滤 */
export function searchEntries(
  db: Database.Database,
  keyword = '',
  category?: string | null
): VaultEntry[] {
  let sql = 'SELECT * FROM entries WHERE 1=1'
  const args: unknown[] = []
  if (category && category !== '全部') {
    sql += ' AND category = ?'
    args.push(category)
  }
  if (keyword) {
    const like = `%${keyword}%`
    sql += ' AND (name LIKE ? OR account LIKE ? OR url LIKE ? OR note LIKE ?)'
    args.push(like, like, like, like)
  }
  sql += ' ORDER BY updated_at DESC, id DESC'
  return db.prepare(sql).all(...args) as VaultEntry[]
}

export function getEntry(db: Database.Database, entryId: number): VaultEntry | undefined {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId) as
    | VaultEntry
    | undefined
}

/** 返回 [{category, count}]，按条目数降序 */
export function listCategories(db: Database.Database): { category: string; count: number }[] {
  return db
    .prepare(
      'SELECT category, COUNT(*) AS count FROM entries GROUP BY category ORDER BY COUNT(*) DESC, category'
    )
    .all() as { category: string; count: number }[]
}

/** 重命名分类（批量更新该分类下所有条目）；重名/空名/改名为"未分类"时报错 */
export function renameCategory(
  db: Database.Database,
  oldName: string,
  newName: string
): { ok: boolean; error?: string; updated?: number } {
  const from = oldName.trim()
  const to = newName.trim()
  if (!from) return { ok: false, error: '分类不存在' }
  if (!to) return { ok: false, error: '分类名称不能为空' }
  if (from === to) return { ok: true, updated: 0 }
  if (to === CATEGORY_DEFAULT) return { ok: false, error: '不能重命名为「未分类」' }
  const dup = db.prepare('SELECT 1 FROM entries WHERE category = ? LIMIT 1').get(to)
  if (dup) return { ok: false, error: '分类名称已存在' }
  const info = db
    .prepare('UPDATE entries SET category = ?, updated_at = ? WHERE category = ?')
    .run(to, now(), from)
  return { ok: true, updated: info.changes }
}

/** 删除分类：该分类下条目迁移到「未分类」；未分类不可删除 */
export function deleteCategory(
  db: Database.Database,
  name: string
): { ok: boolean; error?: string; moved?: number } {
  const target = name.trim()
  if (!target) return { ok: false, error: '分类不存在' }
  if (target === CATEGORY_DEFAULT) return { ok: false, error: '「未分类」不可删除' }
  const info = db
    .prepare('UPDATE entries SET category = ?, updated_at = ? WHERE category = ?')
    .run(CATEGORY_DEFAULT, now(), target)
  return { ok: true, moved: info.changes }
}

export function countEntries(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM entries').get() as { c: number }
  return row.c
}

/** 新增条目，返回新 id */
export function addEntry(db: Database.Database, data: Partial<VaultEntry>): number {
  const ts = now()
  const values = {
    name: data.name ?? '',
    category: data.category || CATEGORY_DEFAULT,
    account: data.account ?? '',
    password: data.password ?? '',
    url: data.url ?? '',
    note: data.note ?? ''
  }
  const result = db
    .prepare(
      `INSERT INTO entries (name, category, account, password, url, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      values.name,
      values.category,
      values.account,
      values.password,
      values.url,
      values.note,
      ts,
      ts
    )
  return Number(result.lastInsertRowid)
}

export function updateEntry(db: Database.Database, entryId: number, data: Partial<VaultEntry>): void {
  const values = {
    name: data.name ?? '',
    category: data.category || CATEGORY_DEFAULT,
    account: data.account ?? '',
    password: data.password ?? '',
    url: data.url ?? '',
    note: data.note ?? ''
  }
  db.prepare(
    `UPDATE entries SET name=?, category=?, account=?, password=?, url=?, note=?, updated_at=?
     WHERE id=?`
  ).run(values.name, values.category, values.account, values.password, values.url, values.note, now(), entryId)
}

export function deleteEntry(db: Database.Database, entryId: number): void {
  db.prepare('DELETE FROM entries WHERE id = ?').run(entryId)
}
