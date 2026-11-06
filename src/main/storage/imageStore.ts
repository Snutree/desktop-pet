/**
 * 图片文件存储（阶段 2）
 *
 * 设计要点：
 *  - 图片字节不存数据库，DB 仅存相对路径（索引）
 *  - 历史图片按日期分目录：images/history/yyyy/MM/dd/{uuid}.png
 *  - 入库同时生成最长边 256px 的缩略图（列表用），原图点击查看
 *  - 所有相对路径统一用正斜杠存储，便于跨平台
 */
import { app, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

/** 图片存储根目录：%APPDATA%/clipboard-plus/clipboard/images（与独立版共用） */
const IMAGE_ROOT = (): string => path.join(app.getPath('appData'), 'clipboard-plus', 'clipboard', 'images')

/** 日期相对目录：yyyy/MM/dd（与 kind 拼接为 kind/yyyy/MM/dd） */
function dateRelativeDir(date: Date): string {
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return path.join(y, m, d)
}

export interface SavedImage {
  /** 相对 IMAGE_ROOT 的路径（正斜杠，存 DB） */
  imagePath: string
  /** 缩略图相对路径 */
  thumbnailPath: string
  width: number
  height: number
}

/**
 * 保存图片：原图落盘到 <kind>/yyyy/MM/dd/{uuid}.png + 缩略图生成
 * kind：'history' 历史图片 / 'favorites' 收藏独立副本
 */
export function saveImage(pngBuffer: Buffer, kind: 'history' | 'favorites'): SavedImage {
  const root = IMAGE_ROOT()

  // 1) 原图：<kind>/yyyy/MM/dd/{uuid}.png
  const relDir = path.join(kind, dateRelativeDir(new Date()))
  fs.mkdirSync(path.join(root, relDir), { recursive: true })
  const imageName = `${randomUUID()}.png`
  const imagePath = path.join(relDir, imageName).replaceAll('\\', '/')
  fs.writeFileSync(path.join(root, imagePath), pngBuffer)

  // 2) 尺寸 + 缩略图（最长边 256px，保持宽高比）
  const image = nativeImage.createFromBuffer(pngBuffer)
  const { width, height } = image.getSize()
  const thumbWidth = width > 0 ? Math.min(256, width) : 256
  const thumb = image.resize({ width: thumbWidth })

  const thumbDir = 'thumbnails'
  fs.mkdirSync(path.join(root, thumbDir), { recursive: true })
  const thumbName = `${randomUUID()}.png`
  const thumbnailPath = path.join(thumbDir, thumbName).replaceAll('\\', '/')
  fs.writeFileSync(path.join(root, thumbnailPath), thumb.toPNG())

  return { imagePath, thumbnailPath, width, height }
}

/** 保存历史图片 */
export function saveHistoryImage(pngBuffer: Buffer): SavedImage {
  return saveImage(pngBuffer, 'history')
}

/** 保存收藏图片（独立副本，不随历史清理删除） */
export function saveFavoriteImage(pngBuffer: Buffer): SavedImage {
  return saveImage(pngBuffer, 'favorites')
}

/**
 * 删除记录对应的图片文件（原图 + 缩略图）
 * 先删数据库记录、后删文件；文件不存在时静默忽略
 */
export function deleteImageFiles(imagePath: string | null, thumbnailPath: string | null): void {
  for (const rel of [imagePath, thumbnailPath]) {
    if (!rel) continue
    try {
      const abs = resolveImage(rel)
      if (fs.existsSync(abs)) fs.unlinkSync(abs)
    } catch (err) {
      console.warn('[imageStore] 删除图片文件失败：', err)
    }
  }
}

/**
 * 相对路径 → 绝对路径（供 clipimg:// 协议读取）
 * 防目录穿越：归一化后必须仍位于 IMAGE_ROOT 之内
 */
export function resolveImage(relativePath: string): string {
  const root = path.normalize(IMAGE_ROOT())
  const abs = path.normalize(path.join(root, relativePath))
  if (!abs.startsWith(root + path.sep)) {
    throw new Error(`非法图片路径：${relativePath}`)
  }
  return abs
}
