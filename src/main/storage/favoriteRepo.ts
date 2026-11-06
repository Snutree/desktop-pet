/**
 * 收藏数据访问层（v4：目录制收藏）
 *
 * 设计要点：
 *  - favorites 表是"共享内容实体"（一份内容只有一个记录，编辑全局生效）
 *  - favorite_categories 收藏目录；favorite_category_map 多对多关联
 *  - 保存到目录：内容已收藏 → 补关联；未收藏 → 新建收藏 + 关联
 *  - 从目录移除：仅删关联；收藏不再属于任何目录时删除本体 + 回置历史标记
 *  - 复制：按收藏 id 直接取内容写入系统剪贴板（修复收藏复制失效 bug）
 */
import fs from 'node:fs'
import { clipboard, nativeImage } from 'electron'
import { getDb } from './db'
import { getClipById } from './historyRepo'
import { saveFavoriteImage, deleteImageFiles, resolveImage } from './imageStore'
import { hashText } from '../clipboard/hash'
import type { FavoriteCategory, FavoriteRecord, FavoriteWithCategories } from '../../shared/types'

// ── 目录 ───────────────────────────────────────────────────

/** 目录列表（默认目录在前，其余按创建时间倒序） */
export function listCategories(): FavoriteCategory[] {
  return getDb()
    .prepare(
      'SELECT * FROM favorite_categories ORDER BY is_default DESC, created_at ASC, id ASC'
    )
    .all() as FavoriteCategory[]
}

/** 新建目录；重名返回 null */
export function addCategory(name: string): FavoriteCategory | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const db = getDb()
  const dup = db.prepare('SELECT id FROM favorite_categories WHERE name = ?').get(trimmed)
  if (dup) return null
  const info = db
    .prepare('INSERT INTO favorite_categories (name, is_default, created_at) VALUES (?, 0, ?)')
    .run(trimmed, Date.now())
  return (
    (db.prepare('SELECT * FROM favorite_categories WHERE id = ?').get(Number(info.lastInsertRowid)) as
      | FavoriteCategory
      | undefined) ?? null
  )
}

/** 删除目录（默认目录不可删）。目录内收藏不删除，仅解除关联 */
export function removeCategory(id: number): boolean {
  const db = getDb()
  const cat = db.prepare('SELECT * FROM favorite_categories WHERE id = ?').get(id) as
    | FavoriteCategory
    | undefined
  if (!cat || cat.is_default === 1) return false
  const tx = db.transaction((): void => {
    db.prepare('DELETE FROM favorite_categories WHERE id = ?').run(id) // map 级联删除
  })
  tx()
  return true
}

/** 收藏所属目录 id 列表 */
export function getFavoriteCategoryIds(favoriteId: number): number[] {
  const rows = getDb()
    .prepare('SELECT category_id FROM favorite_category_map WHERE favorite_id = ?')
    .all(favoriteId) as { category_id: number }[]
  return rows.map((r) => r.category_id)
}

// ── 收藏查询 ───────────────────────────────────────────────

/** 全部收藏（倒序，含所属目录 id） */
export function listFavorites(): FavoriteWithCategories[] {
  const rows = getDb()
    .prepare('SELECT * FROM favorites ORDER BY created_at DESC, id DESC')
    .all() as FavoriteRecord[]
  return rows.map((r) => ({ ...r, categoryIds: getFavoriteCategoryIds(r.id) }))
}

/** 按目录查收藏（倒序，含所属目录 id） */
export function listFavoritesByCategory(categoryId: number): FavoriteWithCategories[] {
  const rows = getDb()
    .prepare(
      `SELECT f.* FROM favorites f
       JOIN favorite_category_map m ON m.favorite_id = f.id
       WHERE m.category_id = ?
       ORDER BY f.created_at DESC, f.id DESC`
    )
    .all(categoryId) as FavoriteRecord[]
  return rows.map((r) => ({ ...r, categoryIds: getFavoriteCategoryIds(r.id) }))
}

/** 按 id 查询收藏 */
export function getFavoriteById(id: number): FavoriteRecord | undefined {
  return getDb().prepare('SELECT * FROM favorites WHERE id = ?').get(id) as
    | FavoriteRecord
    | undefined
}

/** 按来源历史记录 id 查询收藏 */
export function findFavoriteByHistory(historyId: number): FavoriteRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM favorites WHERE source_history_id = ?')
    .get(historyId) as FavoriteRecord | undefined
}

/** 按内容指纹查收藏（同一内容可能来自多条历史） */
function findFavoriteByHash(contentHash: string): FavoriteRecord | undefined {
  return getDb().prepare('SELECT * FROM favorites WHERE content_hash = ?').get(contentHash) as
    | FavoriteRecord
    | undefined
}

// ── 保存 / 移除 ────────────────────────────────────────────

/**
 * 将历史记录保存到指定目录（可多选）。
 *  - 已收藏（同来源或同内容指纹）→ 只补目录关联
 *  - 未收藏 → 新建收藏（图片复制独立副本）并关联所选目录
 * 返回 { favoriteId, categoryIds }；历史不存在返回 null
 */
export function saveFavoriteToCategories(
  historyId: number,
  categoryIds: number[]
): { favoriteId: number; categoryIds: number[] } | null {
  const db = getDb()
  const history = getClipById(historyId)
  if (!history) return null

  const ids = [...new Set(categoryIds)].filter((id) => id > 0)
  const existing =
    findFavoriteByHistory(historyId) ?? findFavoriteByHash(history.content_hash)

  const now = Date.now()
  const tx = db.transaction((): { favoriteId: number; categoryIds: number[] } => {
    let favoriteId: number
    if (existing) {
      favoriteId = existing.id
    } else {
      // 图片收藏：先把文件复制到 favorites/ 目录（独立副本，历史清理不误删）
      let imagePath: string | null = null
      let thumbnailPath: string | null = null
      if (history.content_type === 'image' && history.image_path) {
        const abs = resolveImage(history.image_path)
        if (!fs.existsSync(abs)) {
          throw new Error('图片源文件已丢失（可能已被清理），无法保存该图片')
        }
        const png = fs.readFileSync(abs)
        const saved = saveFavoriteImage(png)
        imagePath = saved.imagePath
        thumbnailPath = saved.thumbnailPath
      }
      const info = db
        .prepare(
          `INSERT INTO favorites
            (content_type, text_content, image_path, thumbnail_path, note,
             content_hash, source_history_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          history.content_type,
          history.text_content,
          imagePath,
          thumbnailPath,
          history.content_hash,
          historyId,
          now,
          now
        )
      favoriteId = Number(info.lastInsertRowid)
    }
    // 建立目录关联
    for (const cid of ids) {
      db.prepare(
        'INSERT OR IGNORE INTO favorite_category_map (favorite_id, category_id) VALUES (?, ?)'
      ).run(favoriteId, cid)
    }
    // 同步历史收藏保护标记
    db.prepare('UPDATE clip_history SET is_favorite = 1, updated_at = ? WHERE id = ?').run(
      now,
      historyId
    )
    return { favoriteId, categoryIds: ids }
  })

  return tx()
}

/**
 * 从目录移除收藏：仅删关联。
 * 收藏不再属于任何目录时删除本体 + 回置历史标记 + 删图片文件（无孤儿）。
 */
export function removeFavoriteFromCategory(favoriteId: number, categoryId: number): boolean {
  const db = getDb()
  const favorite = getFavoriteById(favoriteId)
  if (!favorite) return false

  const tx = db.transaction((): { gone: boolean } => {
    db.prepare(
      'DELETE FROM favorite_category_map WHERE favorite_id = ? AND category_id = ?'
    ).run(favoriteId, categoryId)
    const rest = db
      .prepare('SELECT COUNT(*) AS c FROM favorite_category_map WHERE favorite_id = ?')
      .get(favoriteId) as { c: number }
    if (rest.c > 0) return { gone: false }
    db.prepare('DELETE FROM favorites WHERE id = ?').run(favoriteId)
    if (favorite.source_history_id != null) {
      db.prepare('UPDATE clip_history SET is_favorite = 0, updated_at = ? WHERE id = ?').run(
        Date.now(),
        favorite.source_history_id
      )
    }
    return { gone: true }
  })

  const { gone } = tx()
  if (gone) {
    deleteImageFiles(favorite.image_path, favorite.thumbnail_path)
  }
  return true
}

/** 删除整条收藏（同时解除全部目录关联 + 回置历史标记） */
export function removeFavorite(id: number): boolean {
  const db = getDb()
  const favorite = getFavoriteById(id)
  if (!favorite) return false

  const tx = db.transaction((): boolean => {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(id) // map 级联删除
    if (favorite.source_history_id != null) {
      db.prepare('UPDATE clip_history SET is_favorite = 0, updated_at = ? WHERE id = ?').run(
        Date.now(),
        favorite.source_history_id
      )
    }
    return true
  })

  const ok = tx()
  if (ok) {
    deleteImageFiles(favorite.image_path, favorite.thumbnail_path)
  }
  return ok
}

// ── 编辑 ───────────────────────────────────────────────────

/**
 * 编辑收藏（共享内容：全局生效）：
 *  - 文本收藏可修改内容 text（重算指纹，与历史解耦）
 *  - 文本 / 图片收藏均可修改备注 note
 */
export function updateFavorite(
  id: number,
  patch: { text?: string; note?: string }
): FavoriteRecord | null {
  const db = getDb()
  const favorite = getFavoriteById(id)
  if (!favorite) return null

  const now = Date.now()
  if (favorite.content_type === 'text' && typeof patch.text === 'string') {
    db.prepare(
      'UPDATE favorites SET text_content = ?, content_hash = ?, updated_at = ? WHERE id = ?'
    ).run(patch.text, hashText(patch.text), now, id)
  }
  if (typeof patch.note === 'string') {
    db.prepare('UPDATE favorites SET note = ?, updated_at = ? WHERE id = ?').run(patch.note, now, id)
  }
  return getFavoriteById(id) ?? null
}

// ── 复制 ───────────────────────────────────────────────────

/**
 * 将收藏内容写回系统剪贴板（按 favorites 表 id 直接取内容，修复
 * 原实现误用历史 id 导致复制失败的问题）。返回是否成功。
 */
export function copyFavoriteToClipboard(id: number): boolean {
  const favorite = getFavoriteById(id)
  if (!favorite) return false
  try {
    if (favorite.content_type === 'text' && favorite.text_content != null) {
      clipboard.writeText(favorite.text_content)
      return true
    }
    if (favorite.content_type === 'image' && favorite.image_path) {
      const image = nativeImage.createFromPath(resolveImage(favorite.image_path))
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    }
    return false
  } catch (err) {
    console.error('[favorite] 写回剪贴板失败：', err)
    return false
  }
}
