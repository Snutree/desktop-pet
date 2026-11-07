/**
 * 自定义图片协议（阶段 2 / v1.1）
 *
 *  - clipimg://local/<相对路径>：剪贴板图片/缩略图（clipboard-plus 数据目录）
 *  - lxicon://local/<文件名>：启动中心图标（userData/launcher-icons）
 *
 * 渲染进程通过自定义协议加载本地图片，避免 file:// 直读（更安全、不受 webSecurity 限制）。
 * 注意：registerSchemesAsPrivileged 必须在 app ready 前调用，因此本模块在 import 时即执行注册。
 */
import { protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { resolveImage } from './storage/imageStore'
import { getIconDir } from './launcher/icon'

const IMAGE_SCHEME = 'clipimg'
const ICON_SCHEME = 'lxicon'

// 特权 scheme 注册（app ready 前必须完成）
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: ICON_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/** 在 app ready 后调用：接管图片协议请求 */
export function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // clipimg://local/<相对路径> → pathname 形如 /thumbnails/xxx.png
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const absolute = resolveImage(relative)
      const data = await fs.promises.readFile(absolute)
      return new Response(data, {
        headers: { 'Content-Type': 'image/png' }
      })
    } catch (err) {
      console.error('[protocol] 读取图片失败：', err)
      return new Response('Not Found', { status: 404 })
    }
  })

  protocol.handle(ICON_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const root = path.normalize(getIconDir())
      const absolute = path.normalize(path.join(root, relative))
      if (!absolute.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.promises.readFile(absolute)
      return new Response(data, {
        headers: { 'Content-Type': 'image/png' }
      })
    } catch (err) {
      console.error('[protocol] 读取启动项图标失败：', err)
      return new Response('Not Found', { status: 404 })
    }
  })
}
