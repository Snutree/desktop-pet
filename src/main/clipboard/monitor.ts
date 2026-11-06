/**
 * 剪贴板监听模块（阶段 2）
 *
 * 实现要点：
 *  - Electron 无原生剪贴板事件，采用 250ms 轮询 + 内容签名快速比较：
 *    签名未变 → 跳过（零开销路径）；签名变化 → 全量处理
 *  - 类型识别：优先图片（剪贴板同时含图与文本时按图片处理），其次文本
 *  - 同日去重：同 hash 当天已存在 → 仅刷新 created_at（列表置顶），不新增
 *  - 图片：落盘 images/history/yyyy/MM/dd/{uuid}.png + 生成缩略图，DB 只存索引
 *  - 密码类内容不过滤（需求确认），一律正常捕获
 */
import { clipboard } from 'electron'
import { hashText, hashImage } from './hash'
import { saveHistoryImage } from '../storage/imageStore'
import {
  findSameDayClip,
  insertClip,
  touchClip,
  type ClipRecord,
  type NewClipInput
} from '../storage/historyRepo'

/** 轮询间隔：250ms 对 CPU/内存占用可忽略（未变化时仅做轻量签名比较） */
const POLL_INTERVAL_MS = 250
const EMPTY_SIGNATURE = ''

let timer: NodeJS.Timeout | null = null
let lastSignature = EMPTY_SIGNATURE
/** 内容变化回调（模块级存储，供各处理函数调用） */
let changeHandler: ClipChangeHandler | null = null

/** 内容变化回调：总是携带最终入库记录（新增或刷新置顶） */
export type ClipChangeHandler = (record: ClipRecord) => void

/** 启动监听（幂等）：立即捕获一次当前剪贴板，随后每 250ms 轮询 */
export function startClipboardMonitor(onChange: ClipChangeHandler): void {
  if (timer) return
  changeHandler = onChange
  timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()
}

/** 停止监听 */
export function stopClipboardMonitor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  changeHandler = null
  lastSignature = EMPTY_SIGNATURE
}

/**
 * 轻量内容签名（快速比较用）：
 *  - 文本：内容本身
 *  - 图片：尺寸 + 原始像素 buffer 长度 + 前 48 字节（避免每 250ms 全量 toPNG 编码）
 */
function currentSignature(): string {
  try {
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const size = image.getSize()
      const buf = image.getBitmap()
      return `img:${size.width}x${size.height}:${buf.length}:${buf.subarray(0, 48).toString('hex')}`
    }
    const text = clipboard.readText()
    return text ? `text:${text}` : EMPTY_SIGNATURE
  } catch {
    return EMPTY_SIGNATURE
  }
}

/** 单次轮询：签名变化才进入处理流程 */
function tick(): void {
  const signature = currentSignature()
  if (!signature || signature === lastSignature) return
  lastSignature = signature

  try {
    // 类型识别：剪贴板同时有图片和文本时优先图片
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      handleImage(image.toPNG())
      return
    }
    const text = clipboard.readText()
    if (text) handleText(text)
  } catch (err) {
    console.error('[clipboard] 捕获/入库失败：', err)
  }
}

/** 文本内容处理 */
function handleText(text: string): void {
  if (!text.trim()) return // 纯空白内容不入库
  const record = upsert({
    contentType: 'text',
    contentHash: hashText(text),
    textContent: text,
    imagePath: null,
    thumbnailPath: null,
    imageWidth: null,
    imageHeight: null
  })
  changeHandler?.(record)
}

/** 图片内容处理：同日去重命中则直接置顶；否则落盘 + 缩略图 + 入库 */
function handleImage(pngBuffer: Buffer): void {
  if (!pngBuffer || pngBuffer.length === 0) return
  const hash = hashImage(pngBuffer)

  const existing = findSameDayClip(hash)
  if (existing) {
    const record = touchClip(existing.id)
    if (record) changeHandler?.(record)
    return
  }

  const saved = saveHistoryImage(pngBuffer)
  const record = insertClip({
    contentType: 'image',
    contentHash: hash,
    textContent: null,
    imagePath: saved.imagePath,
    thumbnailPath: saved.thumbnailPath,
    imageWidth: saved.width,
    imageHeight: saved.height
  })
  changeHandler?.(record)
}

/**
 * 同日去重 + 入库统一入口：
 *  同 hash 当天已存在 → 刷新 created_at 置顶（不新增）
 *  不存在 → 插入新记录（跨日复制相同内容视为新记录）
 */
function upsert(input: NewClipInput): ClipRecord {
  const existing = findSameDayClip(input.contentHash)
  if (existing) {
    const record = touchClip(existing.id)
    if (record) return record
  }
  return insertClip(input)
}
