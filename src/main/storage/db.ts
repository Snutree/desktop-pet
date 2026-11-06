/**
 * 剪贴板本地存储层（已集成进 desktop-pet）
 *
 * 数据目录固定为 %APPDATA%/clipboard-plus：与独立版 ClipboardPlus 共用，
 * 用户已有历史 / 收藏 / 设置无缝延续。
 */
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

/** 数据根目录：%APPDATA%/clipboard-plus（与独立版共用，保留旧数据） */
export function getDataRoot(): string {
  return path.join(app.getPath('appData'), 'clipboard-plus')
}

/** 数据库文件路径：dataRoot/clipboard-plus.db */
export function getDbPath(): string {
  return path.join(getDataRoot(), 'clipboard-plus.db')
}

/** 获取数据库连接（仓储层使用）；未初始化时自动初始化 */
export function getDb(): Database.Database {
  if (!db) return initDatabase()
  return db
}

/** 建表 DDL（与 docs/01-架构设计与数据库设计.md 4.4 保持一致） */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clip_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type  TEXT    NOT NULL CHECK (content_type IN ('text','image')),
  text_content  TEXT,
  image_path    TEXT,
  image_width   INTEGER,
  image_height  INTEGER,
  thumbnail_path TEXT,
  content_hash  TEXT    NOT NULL,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  source_app    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_clip_created ON clip_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clip_hash     ON clip_history (content_hash);
CREATE INDEX IF NOT EXISTS idx_clip_fav      ON clip_history (is_favorite, created_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type      TEXT    NOT NULL CHECK (content_type IN ('text','image')),
  text_content      TEXT,
  image_path        TEXT,
  thumbnail_path    TEXT,
  note              TEXT,
  content_hash      TEXT    NOT NULL,
  source_history_id INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER,
  FOREIGN KEY (source_history_id) REFERENCES clip_history (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_fav_created ON favorites (created_at DESC);

-- 收藏目录（v4：目录制收藏）
CREATE TABLE IF NOT EXISTS favorite_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 收藏 ↔ 目录 多对多关联（一条内容可属于多个目录）
CREATE TABLE IF NOT EXISTS favorite_category_map (
  favorite_id INTEGER NOT NULL REFERENCES favorites (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES favorite_categories (id) ON DELETE CASCADE,
  PRIMARY KEY (favorite_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_fcm_cat ON favorite_category_map (category_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 任务追踪（v5）
CREATE TABLE IF NOT EXISTS task_statuses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#8a94a6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  description   TEXT,
  source_type   TEXT    NOT NULL DEFAULT 'internal',
  source_detail TEXT,
  priority      TEXT    NOT NULL DEFAULT 'medium',
  category      TEXT,
  link          TEXT,
  due_date      INTEGER,
  status_id     INTEGER NOT NULL REFERENCES task_statuses (id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status  ON tasks (status_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_updated ON tasks (updated_at DESC);

CREATE TABLE IF NOT EXISTS task_progress_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  note       TEXT    NOT NULL,
  status_id  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tpl_task ON task_progress_logs (task_id, created_at DESC);
`

/**
 * 初始化数据库：打开连接 → WAL → 建表 → 版本迁移。
 * 幂等：重复调用返回已有连接。
 */
export function initDatabase(): Database.Database {
  if (db) return db

  // 确保 userData 目录存在
  const dir = path.dirname(getDbPath())
  fs.mkdirSync(dir, { recursive: true })

  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA_SQL)
  migrate(db)

  return db
}

/**
 * schema 版本迁移：
 *  - v1：初始结构
 *  - v2：clip_history 增加 thumbnail_path 列（图片缩略图索引）
 *  - v3：favorites 增加 thumbnail_path 列（收藏列表缩略图索引）
 *  - v4：收藏目录制（favorite_categories + favorite_category_map；
 *        自动创建"默认收藏"目录，现有收藏全部归入）
 *  - v5：任务追踪（task_statuses + tasks + task_progress_logs；
 *        自动预置默认状态：待处理/进行中/已完成/已取消）
 * 后续表结构变更时按版本递增追加迁移逻辑。
 */
function migrate(database: Database.Database): void {
  const row = database
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined
  const current = row ? Number(row.value) : 0

  if (current < 1) {
    // v1：初始结构（SCHEMA_SQL 已保证幂等）
    setSchemaVersion(database, '1')
  }
  if (current < 2) {
    // v2：clip_history 增加缩略图索引列（老库 ALTER，新库建表时已包含）
    if (!columnExists(database, 'clip_history', 'thumbnail_path')) {
      database.exec('ALTER TABLE clip_history ADD COLUMN thumbnail_path TEXT')
    }
    setSchemaVersion(database, '2')
  }
  if (current < 3) {
    // v3：favorites 增加缩略图索引列
    if (!columnExists(database, 'favorites', 'thumbnail_path')) {
      database.exec('ALTER TABLE favorites ADD COLUMN thumbnail_path TEXT')
    }
    setSchemaVersion(database, '3')
  }
  if (current < 4) {
    // v4：收藏目录制。建表幂等；确保"默认收藏"目录存在，现有收藏全部归入
    database.exec(SCHEMA_SQL)
    const def = database
      .prepare('SELECT id FROM favorite_categories WHERE is_default = 1')
      .get() as { id: number } | undefined
    if (!def) {
      const info = database
        .prepare('INSERT INTO favorite_categories (name, is_default, created_at) VALUES (?, 1, ?)')
        .run('默认收藏', Date.now())
      const defaultId = Number(info.lastInsertRowid)
      database
        .prepare(
          'INSERT OR IGNORE INTO favorite_category_map (favorite_id, category_id) SELECT id, ? FROM favorites'
        )
        .run(defaultId)
    } else {
      // 已有默认目录：把无归属的收藏补进默认目录
      database
        .prepare(
          `INSERT OR IGNORE INTO favorite_category_map (favorite_id, category_id)
           SELECT f.id, ? FROM favorites f
           WHERE NOT EXISTS (SELECT 1 FROM favorite_category_map m WHERE m.favorite_id = f.id)`
        )
        .run(def.id)
    }
    setSchemaVersion(database, '4')
  }
  if (current < 5) {
    // v5：任务追踪。建表幂等；首次预置默认状态
    database.exec(SCHEMA_SQL)
    const cnt = database.prepare('SELECT COUNT(*) AS c FROM task_statuses').get() as { c: number }
    if (cnt.c === 0) {
      const defaults: [string, string][] = [
        ['待处理', '#8a94a6'],
        ['进行中', '#ff9a3c'],
        ['已完成', '#52c41a'],
        ['已取消', '#ea6668']
      ]
      const now = Date.now()
      const ins = database.prepare(
        'INSERT INTO task_statuses (name, color, sort_order, is_system, created_at) VALUES (?, ?, ?, 1, ?)'
      )
      defaults.forEach(([name, color], i) => ins.run(name, color, i + 1, now))
    }
    setSchemaVersion(database, '5')
  }
  // 未来 v6：if (current < 6) { ... }
}

function setSchemaVersion(database: Database.Database, version: string): void {
  database
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(version)
}

/** 检查表是否已包含某列（PRAGMA table_info） */
function columnExists(database: Database.Database, table: string, column: string): boolean {
  const cols = database.pragma(`table_info(${table})`) as { name: string }[]
  return cols.some((c) => c.name === column)
}

/** 关闭数据库连接（app 退出前调用） */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 数据库瘦身：回收已删除内容占用的空闲页（启动后低频执行一次）。
 * 先 checkpoint 截断 WAL，再 VACUUM 重写主库文件。内容保持不变。
 */
export function vacuumDatabase(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.exec('VACUUM')
    console.log('[main] 数据库 VACUUM 完成（回收空闲页）')
  } catch (err) {
    console.warn('[main] 数据库 VACUUM 失败：', err)
  }
}

/** 获取数据库状态（阶段 1 用于 UI 验证建表结果） */
export function getDbStatus(): {
  tables: { name: string }[]
  counts: Record<string, number>
  path: string
} {
  if (!db) initDatabase()
  const tables = db!
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all() as { name: string }[]
  const counts: Record<string, number> = {}
  for (const t of tables) {
    const row = db!.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }
    counts[t.name] = row.c
  }
  return { tables, counts, path: getDbPath() }
}
