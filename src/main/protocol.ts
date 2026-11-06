/**
 * 自定义图片协议 clipimg://（阶段 2）
 *
 * 渲染进程通过 clipimg://local/<相对路径> 加载本地图片，
 * 避免 file:// 直读（更安全、不受 webSecurity 限制）。
 * 用法示例：<img src="clipimg://local/thumbnails/xxx.png" />
 *
 * 注意：registerSchemesAsPrivileged 必须在 app ready 前调用，
 * 因此本模块在 import 时即执行注册。
 */
import { protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { resolveImage } from './storage/imageStore'

const SCHEME = 'clipimg'

// 特权 scheme 注册（app ready 前必须完成）
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/** 在 app ready 后调用：接管 clipimg:// 请求，读取本地图片文件 */
export function registerImageProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
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
}
