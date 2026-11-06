/**
 * 截图控制器（阶段 5）
 *
 * 截图流程：
 *  1. triggerScreenshot（快捷键 / IPC 触发）→ 隐藏主窗口 → desktopCapturer 捕获主屏全图（物理像素）
 *  2. 创建全屏透明置顶"框选窗口"，把全屏图以 dataURL 推给页面做遮罩 + 拖拽框选
 *  3. 用户确认 → confirmScreenshot：按物理像素 nativeImage.crop → clipboard.writeImage
 *  4. 剪贴板监听器（阶段 2）自动捕获该图片入库并广播，无需额外入库逻辑
 *
 * 高 DPI 说明：desktopCapturer 的 thumbnailSize 传物理像素（逻辑 × scaleFactor），
 * 框选窗口内坐标是 CSS（逻辑）像素，页面已统一换算为物理像素回传，此处直接 crop。
 *
 * 技术限制说明：
 *  - Windows 无屏幕捕获权限弹窗；desktopCapturer 直接可截
 *  - 多显示器：当前只支持主显示器，扩展方案见 README（遍历 screen.getAllDisplays）
 *  - 快捷键冲突：globalShortcut.register 返回 false 表示被占用（见 hotkeys 模块）
 */
import { app, BrowserWindow, clipboard, desktopCapturer, nativeImage, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSetting } from '../storage/settings'
import type { ScreenshotRegion } from '../../shared/types'

/** 主窗口获取器：恢复显示时用（由 main/index.ts 注入，避免循环依赖） */
let getMainWindowRef: (() => BrowserWindow | null) | null = null

let overlayWindow: BrowserWindow | null = null
let fullImage: Electron.NativeImage | null = null
let scaleFactor = 1
let restoreMainWindow = false
let busy = false

/** 注入主窗口获取器（main/index.ts 创建主窗口后调用） */
export function setMainWindowGetter(getter: () => BrowserWindow | null): void {
  getMainWindowRef = getter
}

/** 是否正在截图流程中 */
export function isScreenshotBusy(): boolean {
  return busy
}

/**
 * 触发一次截图。返回是否成功进入框选流程。
 */
export async function triggerScreenshot(): Promise<boolean> {
  if (busy) return false
  busy = true
  try {
    // 1) 隐藏主窗口（若可见），避免截到自己；等待隐藏完成
    const main = getMainWindowRef?.()
    restoreMainWindow = !!(main && !main.isDestroyed() && main.isVisible())
    if (main && !main.isDestroyed()) main.hide()
    await new Promise((r) => setTimeout(r, 320))

    // 2) 捕获主显示器全屏（物理像素）；getSources 偶发挂起，加超时兜底
    const display = screen.getPrimaryDisplay()
    const sf = display.scaleFactor
    const physW = Math.round(display.size.width * sf)
    const physH = Math.round(display.size.height * sf)

    const sources = await Promise.race([
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: physW, height: physH }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('屏幕捕获超时（15s）')), 15000)
      )
    ])
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) throw new Error('未找到屏幕捕获源')

    fullImage = source.thumbnail
    scaleFactor = sf

    // 3) 创建并显示框选窗口
    await createOverlay(display, fullImage.toDataURL(), sf)
    return true
  } catch (err) {
    console.error('[screenshot] 截图启动失败：', err)
    closeOverlay()
    return false
  }
}

/** 创建全屏透明置顶框选窗口并推送初始化数据 */
function createOverlay(
  display: Electron.Display,
  imageDataUrl: string,
  sf: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    overlayWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/screenshot.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.on('closed', () => {
      overlayWindow = null
    })

    // 兜底：页面加载失败 / 渲染进程退出 / 超时 → 关闭遮罩并恢复主窗口，绝不留下"卡死"状态
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      closeOverlay()
      reject(new Error('框选窗口加载超时（8s）'))
    }, 8000)
    const failSafe = (reason: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      closeOverlay()
      reject(new Error(reason))
    }
    overlayWindow.webContents.on('did-fail-load', () => failSafe('框选页面加载失败'))
    overlayWindow.webContents.on('render-process-gone', () => failSafe('框选窗口渲染进程异常退出'))

    const loaded = process.env.ELECTRON_RENDERER_URL
      ? overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/screenshot.html`)
      : overlayWindow.loadFile(path.join(__dirname, '../renderer/screenshot.html'))

    loaded
      .then(() => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (!overlayWindow || overlayWindow.isDestroyed()) {
          reject(new Error('框选窗口已关闭'))
          return
        }
        // 页面与 preload 就绪后推送截图数据
        overlayWindow.webContents.send('screenshot:init', {
          imageDataUrl,
          displayWidth: display.bounds.width,
          displayHeight: display.bounds.height,
          scaleFactor: sf
        })
        overlayWindow.show()
        overlayWindow.focus()
        resolve()
      })
      .catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        closeOverlay()
        reject(err)
      })
  })
}

/**
 * 截图另存（异步）：
 *  - 先关窗恢复界面，再延迟执行 PNG 编码与写盘
 *  - 原因：nativeImage.toPNG() 是同步编码，大选区可能耗时 1~3 秒；
 *    若在关窗前执行会冻结主进程 → 框选窗口/界面"卡死无响应"
 *  - 延迟到交互完成后执行，即便编码仍短暂占用主进程，用户感知为"截图已完成"
 */
async function saveScreenshotAsync(
  image: Electron.NativeImage,
  saveDir: string
): Promise<void> {
  try {
    await fs.promises.mkdir(saveDir, { recursive: true })
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const name = `截图-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours()
    )}${p(d.getMinutes())}${p(d.getSeconds())}.png`
    const buf = image.toPNG()
    await fs.promises.writeFile(path.join(saveDir, name), buf)
    console.log(`[screenshot] 已另存：${path.join(saveDir, name)}`)
  } catch (err) {
    console.warn('[screenshot] 另存失败：', err)
  }
}

/**
 * 框选确认（IPC：screenshot:confirm 由框选窗口 preload 触发）
 *  region 已是物理像素（页面侧 × scaleFactor 换算过），直接 crop
 */
export function confirmScreenshot(region: ScreenshotRegion): void {
  let cropped: Electron.NativeImage | null = null
  try {
    if (!fullImage) {
      closeOverlay()
      return
    }
    cropped = fullImage.crop({
      x: Math.max(0, Math.round(region.x)),
      y: Math.max(0, Math.round(region.y)),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height))
    })
    if (cropped.isEmpty()) {
      console.warn('[screenshot] 裁剪结果为空，已取消')
      closeOverlay()
      return
    }
    // 写入系统剪贴板 → 监听器（阶段 2）自动同日去重 + 入库 + 广播
    clipboard.writeImage(cropped)

    console.log(
      `[screenshot] 已截图 ${Math.round(region.width / scaleFactor)}×${Math.round(
        region.height / scaleFactor
      )}px → 剪贴板（监听器将自动入库）`
    )
  } catch (err) {
    console.error('[screenshot] 裁剪失败：', err)
  } finally {
    // 先关闭框选窗口、恢复主窗口，再异步另存（避免同步编码卡死界面）
    closeOverlay()
    const saveDir = getSetting('screenshot_dir')
    if (saveDir && cropped) {
      void saveScreenshotAsync(cropped, saveDir)
    }
  }
}

/** 取消截图（IPC：screenshot:cancel） */
export function cancelScreenshot(): void {
  console.log('[screenshot] 已取消')
  closeOverlay()
}

/** 关闭框选窗口并恢复主窗口显示 */
function closeOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
  overlayWindow = null
  fullImage = null
  restoreMain()
  busy = false
}

/** 截图前主窗口处于显示状态 → 恢复显示 */
function restoreMain(): void {
  if (restoreMainWindow) {
    const main = getMainWindowRef?.()
    if (main && !main.isDestroyed()) {
      main.show()
      main.focus()
    }
  }
  restoreMainWindow = false
}

/** 应用退出前清理 */
export function disposeScreenshot(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
  overlayWindow = null
  fullImage = null
  busy = false
}
