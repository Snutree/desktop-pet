import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getPetWindow, createPetWindow } from './pet-window'
import { openPanel, togglePanel, isPanelWindowVisible } from './panel/panel-window'
import { getSetting, setSetting } from './storage/settings'

let tray: Tray | null = null
let unreadCount = 0

export function createTray(): Tray {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  // 保留 initDataHub 可能已经算好的未读数（DataHub 先于托盘初始化）
  setUnreadCount(unreadCount)

  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏宠物', click: () => togglePet() },
    { type: 'separator' },
    {
      label: '打开控制板（Ctrl+Shift+V）',
      click: () => togglePanel()
    },
    {
      label: '控制板 · 消息中心',
      click: () => openPanel('messages')
    },
    {
      label: '控制板 · API 配置',
      click: () => openPanel('api')
    },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => togglePanel())
  return tray
}

/** 刷新托盘提示（未读数） */
export function setUnreadCount(count: number): void {
  unreadCount = Math.max(0, count)
  if (!tray || tray.isDestroyed()) return
  tray.setToolTip(unreadCount > 0 ? `灵犀 · ${unreadCount} 条未读消息` : '灵犀 · 控制板')
}

export function getUnreadCount(): number {
  return unreadCount
}

/**
 * 托盘"显示 / 隐藏宠物"：
 * 宠物窗口不存在时先创建（并记住开启状态），避免开关点了没反应
 */
function togglePet(): void {
  const win = getPetWindow()
  if (!win || win.isDestroyed()) {
    if (getSetting('pet.enabled') !== 'true') setSetting('pet.enabled', 'true')
    createPetWindow()
    return
  }
  if (win.isVisible()) win.hide()
  else win.show()
}

function quitApp(): void {
  // 触发 before-quit → 窗口真正关闭 → will-quit 清理
  app.quit()
}

export { isPanelWindowVisible }
