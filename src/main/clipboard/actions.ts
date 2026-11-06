/**
 * 剪贴板写入动作（阶段 3）
 *
 * 将历史记录重新写入系统剪贴板（【复制】按钮）。
 * 写入后监听模块会自动感知内容变化并执行同日去重 → 该条刷新时间置顶，
 * 符合"重新复制后置顶"的预期行为。
 */
import { clipboard, nativeImage } from 'electron'
import { getClipById } from '../storage/historyRepo'
import { resolveImage } from '../storage/imageStore'

/** 按 id 将历史记录写回系统剪贴板；返回是否成功 */
export function copyClipToClipboard(id: number): boolean {
  const record = getClipById(id)
  if (!record) return false
  try {
    if (record.content_type === 'text' && record.text_content != null) {
      clipboard.writeText(record.text_content)
      return true
    }
    if (record.content_type === 'image' && record.image_path) {
      const image = nativeImage.createFromPath(resolveImage(record.image_path))
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    }
    return false
  } catch (err) {
    console.error('[clipboard] 写回剪贴板失败：', err)
    return false
  }
}
