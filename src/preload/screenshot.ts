/**
 * 截图框选窗口专用 preload（阶段 5）
 *
 * 只暴露框选所需的 3 个能力：
 *  - onInit：主进程推送初始化数据（全屏截图 dataURL + 显示尺寸 + scaleFactor）
 *  - confirm：把框选区域（物理像素）发给主进程做裁剪
 *  - cancel：取消截图
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ScreenshotInitPayload, ScreenshotRegion } from '../shared/types'

const api = {
  /** 订阅初始化数据（页面 ready 后主进程推送） */
  onInit: (callback: (payload: ScreenshotInitPayload) => void): void => {
    ipcRenderer.on('screenshot:init', (_event: IpcRendererEvent, payload: ScreenshotInitPayload) => {
      callback(payload)
    })
  },
  /** 确认框选区域 → 主进程裁剪并写入剪贴板 */
  confirm: (region: ScreenshotRegion): void => {
    ipcRenderer.send('screenshot:confirm', region)
  },
  /** 取消截图 */
  cancel: (): void => {
    ipcRenderer.send('screenshot:cancel')
  }
}

contextBridge.exposeInMainWorld('screenshotApi', api)

export type ScreenshotApi = typeof api
