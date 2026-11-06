/**
 * 剪贴板内容指纹（去重键）
 *
 * 去重策略（需求确认）：同一种内容一天内只留一条。
 *  - 文本指纹：sha256(utf8 文本)
 *  - 图片指纹：sha256(PNG buffer)
 * 同日命中相同指纹 → 刷新该记录时间并置顶；跨日 → 新增记录。
 */
import { createHash } from 'node:crypto'

/** 文本内容指纹 */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 图片内容指纹（基于 PNG 编码 buffer，同像素内容结果确定） */
export function hashImage(pngBuffer: Buffer): string {
  return createHash('sha256').update(pngBuffer).digest('hex')
}
