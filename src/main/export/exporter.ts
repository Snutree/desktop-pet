/**
 * 按日期导出（阶段 8：HTML 单文件；本轮扩展 PDF）
 *
 * 支持两种格式（导出时可切换，设置页可配默认）：
 *  - html：单文件「剪贴记录-yyyy-MM-dd.html」，图片 base64 内嵌，自包含可分享
 *  - pdf： 先生成同一份 HTML，再用隐藏 BrowserWindow 的 printToPDF 输出
 *    「剪贴记录-yyyy-MM-dd.pdf」—— 零新依赖、样式与 HTML 完全一致
 *
 * 内容规格（两种格式共用）：
 *  - 记录按时间倒序；文本全文内嵌（HTML 转义防 XSS）；图片 base64 内嵌
 *  - 类型徽标 / 收藏标记 / 尺寸信息；卡片 break-inside: avoid 避免跨页截断
 *
 * 保护策略：
 *  - 所有动态文本经 esc() 转义（剪贴内容可能含 <script> 等）
 *  - 单张图片 > 10MB 不内嵌，改为显示路径提示
 *  - 图片文件缺失时显示占位说明，不影响其他记录导出
 *
 * 说明：导出为本地只读操作，不改动数据库与图片原件。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BrowserWindow } from 'electron'
import { listClipsByDate } from '../storage/historyRepo'
import { resolveImage } from '../storage/imageStore'
import type { ClipRecord } from '../../shared/types'

export type ExportFormat = 'html' | 'pdf'

export interface ExportResult {
  /** 导出目录（绝对路径） */
  dir: string
  /** 导出的文件绝对路径（HTML 或 PDF） */
  file: string
  /** 实际导出格式 */
  format: ExportFormat
  /** 内嵌图片数量 */
  imageCount: number
  /** 导出记录总数 */
  recordCount: number
}

/** 单张图片内嵌上限：10MB（base64 后约 13.4MB），超出改为路径提示 */
const MAX_EMBED_BYTES = 10 * 1024 * 1024

/** HTML 转义（防 XSS：剪贴内容不可信） */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 时间 HH:mm:ss */
function timeStr(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 按扩展名推断 MIME，默认 image/png */
function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  }
  return map[ext] ?? 'image/png'
}

/** 单条记录渲染为 HTML 卡片（时间倒序，与面板一致） */
function renderRecord(r: ClipRecord): string {
  const isText = r.content_type === 'text'
  const size =
    r.image_width && r.image_height ? ` ${r.image_width}×${r.image_height}` : ''
  const typeBadge = isText
    ? '<span style="display:inline-block;font-size:11px;border-radius:6px;padding:2px 8px;background:rgba(139,200,234,0.25);color:#1a5c7a;">文本</span>'
    : '<span style="display:inline-block;font-size:11px;border-radius:6px;padding:2px 8px;background:rgba(148,216,195,0.3);color:#1a6b52;">图片</span>'
  const favBadge =
    r.is_favorite === 1
      ? '<span style="display:inline-block;font-size:11px;border-radius:6px;padding:2px 8px;background:rgba(228,212,143,0.35);color:#7a6420;">★ 收藏</span>'
      : ''

  let body: string
  if (isText) {
    // 全文内嵌：white-space:pre-wrap 保留换行
    body = `<div style="font-size:13px;line-height:1.7;color:#1a1b1c;white-space:pre-wrap;word-break:break-word;user-select:text;">${esc(r.text_content ?? '')}</div>`
  } else if (r.image_path) {
    const src = resolveImage(r.image_path)
    try {
      const stat = fs.statSync(src)
      if (stat.size > MAX_EMBED_BYTES) {
        body = `<div style="font-size:12px;color:#b02a2a;">图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB）未内嵌，原始文件：${esc(path.basename(r.image_path))}${size}</div>`
      } else {
        const b64 = fs.readFileSync(src).toString('base64')
        const mime = mimeOf(src)
        body = `<img src="data:${mime};base64,${b64}" alt="剪贴板图片" style="max-width:100%;height:auto;border-radius:8px;display:block;" />`
      }
    } catch {
      body = '<div style="font-size:12px;color:#b02a2a;">（图片文件缺失）</div>'
    }
  } else {
    body = '<div style="font-size:12px;color:#b02a2a;">（图片文件缺失）</div>'
  }

  return `
    <div style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;padding:12px 16px;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        ${typeBadge}${favBadge}
        <span style="font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums;">${esc(timeStr(r.created_at))}</span>
        ${!isText && size ? `<span style="font-size:11px;color:#9ca3af;">${esc(size.trim())}</span>` : ''}
      </div>
      ${body}
    </div>`
}

/** 组装完整 HTML（HTML 导出直接写盘；PDF 导出以此为中间文件） */
function buildHtml(dateStr: string, records: ClipRecord[]): string {
  const textCount = records.filter((r) => r.content_type === 'text').length
  const imageCount = records.filter((r) => r.content_type === 'image').length

  const cards =
    records.length === 0
      ? '<div style="text-align:center;color:#6b7280;padding:48px 0;font-size:14px;">当日暂无剪贴记录</div>'
      : records.map(renderRecord).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>剪贴记录 - ${esc(dateStr)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f3ee;font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:760px;margin:0 auto;padding:24px 20px 48px;">
    <h1 style="font-size:20px;margin:0 0 4px;color:#1a1b1c;">ClipboardPlus 剪贴记录</h1>
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px;">
      ${esc(dateStr)} · 共 ${records.length} 条（文本 ${textCount} / 图片 ${imageCount}）
    </div>
    ${cards}
    <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:24px;">
      由 ClipboardPlus 导出 · 本地生成 · 图片已内嵌
    </div>
  </div>
</body>
</html>
`
}

/**
 * PDF 生成：把 HTML 写入临时文件，用隐藏 BrowserWindow 的 printToPDF 打印。
 * 零依赖、样式与 HTML 完全一致；图片（base64）随页面渲染进 PDF。
 */
async function htmlToPdf(html: string, pdfFile: string): Promise<void> {
  // 临时文件放系统 tmp（导出目录内也可，但避免给用户目录留垃圾）
  const tmpHtml = path.join(os.tmpdir(), `clipboard-plus-export-${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf8')

  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: false }
    })
    await win.loadFile(tmpHtml)
    const pdfBuf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    })
    await fs.promises.writeFile(pdfFile, pdfBuf)
  } finally {
    win?.destroy()
    fs.rmSync(tmpHtml, { force: true })
  }
}

/**
 * 导出指定本地日期（yyyy-MM-dd）的全部记录。
 * format: 'html' | 'pdf'（默认 html）。返回导出摘要；无记录时也会生成文件。
 */
export async function exportByDate(
  dateStr: string,
  targetDir: string,
  format: ExportFormat = 'html'
): Promise<ExportResult> {
  const records = listClipsByDate(dateStr)
  const imageCount = records.filter((r) => r.content_type === 'image').length
  fs.mkdirSync(targetDir, { recursive: true })

  const html = buildHtml(dateStr, records)
  const baseName = `剪贴记录-${dateStr}`

  if (format === 'pdf') {
    const pdfFile = path.join(targetDir, `${baseName}.pdf`)
    await htmlToPdf(html, pdfFile)
    return { dir: targetDir, file: pdfFile, format: 'pdf', imageCount, recordCount: records.length }
  }

  const htmlFile = path.join(targetDir, `${baseName}.html`)
  fs.writeFileSync(htmlFile, html, 'utf8')
  return { dir: targetDir, file: htmlFile, format: 'html', imageCount, recordCount: records.length }
}
