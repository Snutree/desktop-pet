/**
 * 启动项图标提取（v1.1）
 *
 * 用 Electron app.getFileIcon 取系统图标，缓存为 PNG 到 userData/launcher-icons，
 * 渲染层通过 lxicon://local/<文件名> 加载（见 main/protocol.ts）。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ICON_DIR_NAME = 'launcher-icons'

export function getIconDir(): string {
  return path.join(app.getPath('userData'), ICON_DIR_NAME)
}

/** 取图标文件名（不带目录，供 lxicon 协议使用）；失败返回 null */
export async function getOrCreateIcon(filePath: string): Promise<string | null> {
  try {
    const dir = getIconDir()
    fs.mkdirSync(dir, { recursive: true })
    const stat = fs.statSync(filePath)
    const key = createHash('sha1')
      .update(`${filePath}:${stat.mtimeMs}:${stat.size}`)
      .digest('hex')
      .slice(0, 16)
    const name = `${key}.png`
    const target = path.join(dir, name)
    if (fs.existsSync(target)) return name
    const image = await app.getFileIcon(filePath, { size: 'normal' })
    if (image.isEmpty()) return null
    fs.writeFileSync(target, image.toPNG())
    return name
  } catch (err) {
    console.warn('[launcher] 提取图标失败：', err)
    return null
  }
}
