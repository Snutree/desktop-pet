/**
 * 剪贴历史数据访问层（阶段 2）
 * 基于 better-sqlite3（同步 API），仅在主进程调用。
 */
import { getDb } from './db'
import { deleteImageFiles } from './imageStore'

/** 剪贴板记录（对应 clip_history 表行，渲染进程共享此类型） */
export interface ClipRecord {
  id: number
  content_type: 'text' | 'image'
  text_content: string | null
  image_path: string | null
  thumbnail_path: string | null
  image_width: number | null
  image_height: number | null
  content_hash: string
  is_favorite: number
  source_app: string | null
  created_at: number
  updated_at: number
}

/** 入库输入（由监听模块构造） */
export interface NewClipInput {
  contentType: 'text' | 'image'
  contentHash: string
  textContent: string | null
  imagePath: string | null
  thumbnailPath: string | null
  imageWidth: number | null
  imageHeight: number | null
  sourceApp?: string | null
}

/**
 * 同日去重查询：同 hash 当天（本地日期）是否已有记录
 * date(created_at/1000,'unixepoch','localtime') → 毫秒时间戳转本地日期
 */
export function findSameDayClip(contentHash: string): { id: number } | undefined {
  return getDb()
    .prepare(
      `SELECT id FROM clip_history
       WHERE content_hash = ?
         AND date(created_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')
       LIMIT 1`
    )
    .get(contentHash) as { id: number } | undefined
}

/** 插入新记录，返回完整行 */
export function insertClip(input: NewClipInput): ClipRecord {
  const now = Date.now()
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO clip_history
        (content_type, text_content, image_path, thumbnail_path,
         image_width, image_height, content_hash, is_favorite,
         source_app, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(
      input.contentType,
      input.textContent,
      input.imagePath,
      input.thumbnailPath,
      input.imageWidth,
      input.imageHeight,
      input.contentHash,
      input.sourceApp ?? null,
      now,
      now
    )
  const record = getClipById(Number(info.lastInsertRowid))
  if (!record) throw new Error('插入剪贴记录后读取失败')
  return record
}

/** 按 id 查询 */
export function getClipById(id: number): ClipRecord | undefined {
  return getDb().prepare('SELECT * FROM clip_history WHERE id = ?').get(id) as
    | ClipRecord
    | undefined
}

/** 同日去重命中：刷新时间戳（created_at=now → 排序置顶） */
export function touchClip(id: number): ClipRecord | undefined {
  const now = Date.now()
  getDb()
    .prepare('UPDATE clip_history SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id)
  return getClipById(id)
}

/** 倒序查询历史（最新在前；created_at 相同时按 id 倒序兜底） */
export function listClips(limit = 100): ClipRecord[] {
  return getDb()
    .prepare('SELECT * FROM clip_history ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as ClipRecord[]
}

/**
 * 删除单条历史记录（含对应图片文件）。
 * 返回是否删除成功。
 */
export function deleteClip(id: number): boolean {
  const record = getClipById(id)
  const info = getDb().prepare('DELETE FROM clip_history WHERE id = ?').run(id)
  if (info.changes > 0 && record) {
    // 先删记录、后删文件，防止记录删除异常时误删文件
    deleteImageFiles(record.image_path, record.thumbnail_path)
  }
  return info.changes > 0
}

/**
 * 清空指定本地日期（yyyy-MM-dd）的非收藏历史。
 * 收藏记录（is_favorite=1）受保护保留，与自动过期清理语义一致。
 * 返回删除条数。
 */
export function clearClipsByDate(dateStr: string): number {
  const rows = getDb()
    .prepare(
      `SELECT * FROM clip_history
       WHERE date(created_at / 1000, 'unixepoch', 'localtime') = ? AND is_favorite = 0`
    )
    .all(dateStr) as ClipRecord[]
  const info = getDb()
    .prepare(
      `DELETE FROM clip_history
       WHERE date(created_at / 1000, 'unixepoch', 'localtime') = ? AND is_favorite = 0`
    )
    .run(dateStr)
  for (const r of rows) {
    deleteImageFiles(r.image_path, r.thumbnail_path)
  }
  return info.changes
}

// ── 阶段 6：每日记录回溯 ─────────────────────────────────

/**
 * 查询指定本地日期（yyyy-MM-dd）的全部记录（倒序，最新在前）。
 * 含收藏记录（导出 / 按日期查看时应完整呈现）。
 */
export function listClipsByDate(dateStr: string): ClipRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM clip_history
       WHERE date(created_at / 1000, 'unixepoch', 'localtime') = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(dateStr) as ClipRecord[]
}

/** 存在剪贴记录的本地日期列表（倒序，最新在前）——日期筛选下拉用 */
export function getClipDates(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT date(created_at / 1000, 'unixepoch', 'localtime') AS d
         FROM clip_history
         ORDER BY d DESC`
      )
      .all() as { d: string }[]
  ).map((r) => r.d)
}

/**
 * 过期清理（保留最近 days 天，含今天；共 days 个日历日）。
 * 仅删除 is_favorite=0 的记录；收藏记录受保护保留。
 * 例：days=7，今天 9/14 → 保留 9/8~9/14，删除 9/7 及更早。
 * 删除前收集图片路径，事务删记录后删文件。
 * 返回删除条数。
 */
export function clearClipsOlderThan(days: number): number {
  const db = getDb()
  // cutoffDate = 今天 - (days-1) 天；created_at 日期 < cutoffDate 即过期
  const daysBefore = `-${Math.max(1, days) - 1} day`
  const rows = db
    .prepare(
      `SELECT * FROM clip_history
       WHERE is_favorite = 0
         AND date(created_at / 1000, 'unixepoch', 'localtime') < date('now', 'localtime', ?)`
    )
    .all(daysBefore) as ClipRecord[]
  const info = db
    .prepare(
      `DELETE FROM clip_history
       WHERE is_favorite = 0
         AND date(created_at / 1000, 'unixepoch', 'localtime') < date('now', 'localtime', ?)`
    )
    .run(daysBefore)
  for (const r of rows) {
    deleteImageFiles(r.image_path, r.thumbnail_path)
  }
  return info.changes
}
