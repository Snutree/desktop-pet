/**
 * 控制板窗口（v0.3）
 *
 * 一个常驻主窗口承载全部功能：剪贴板 / 密码本 / 消息中心 / API 配置 / 设置。
 * 关闭 = 隐藏（秒开）；宠物右键菜单 / 托盘 / 热键 Ctrl+Shift+V 呼出。
 */
import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { PanelTab } from '../../shared/datahub'

let panelWin: BrowserWindow | null = null
let appQuitting = false

/** 打开控制板；可选跳转到指定页签 */
export function openPanel(tab?: PanelTab): void {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.show()
    panelWin.focus()
    if (tab) panelWin.webContents.send('panel:switch-tab', tab)
    return
  }
  panelWin = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: '灵犀 · 控制板',
    icon: path.join(__dirname, '../../resources/icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  panelWin.on('ready-to-show', () => {
    panelWin?.show()
  })

  // 关闭 = 隐藏（常驻秒开）
  panelWin.on('close', (event) => {
    if (!appQuitting) {
      event.preventDefault()
      panelWin?.hide()
    }
  })

  panelWin.on('closed', () => {
    panelWin = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void panelWin
      .loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`)
      .then(() => sendInitialTab(panelWin, tab))
  } else {
    void panelWin
      .loadFile(path.join(__dirname, '../renderer/panel.html'))
      .then(() => sendInitialTab(panelWin, tab))
  }
}

/** 首次创建窗口时也要应用目标页签（托盘/宠物菜单"打开消息中心"用） */
function sendInitialTab(win: BrowserWindow | null, tab?: PanelTab): void {
  if (!win || win.isDestroyed() || !tab) return
  win.webContents.send('panel:switch-tab', tab)
}

/** 显示 ↔ 隐藏 */
export function togglePanel(): void {
  if (!panelWin || panelWin.isDestroyed()) {
    openPanel()
    return
  }
  if (panelWin.isVisible() && !panelWin.isMinimized()) {
    panelWin.hide()
  } else {
    panelWin.show()
    panelWin.focus()
  }
}

export function getPanelWindow(): BrowserWindow | null {
  return panelWin && !panelWin.isDestroyed() ? panelWin : null
}

export function isPanelWindowVisible(): boolean {
  return !!panelWin && !panelWin.isDestroyed() && panelWin.isVisible()
}

/** 应用退出标记（由主入口注入，允许真正关闭） */
export function setPanelQuitting(quitting: boolean): void {
  appQuitting = quitting
  if (quitting && panelWin && !panelWin.isDestroyed()) {
    panelWin.destroy()
    panelWin = null
  }
}
