/**
 * 桌面宠物主进程入口（v0.3：控制板）
 *
 * 架构：一个 Electron 主进程常驻 ——
 *  - 宠物窗口（透明置顶、拖拽、点击特效、消息气泡）
 *  - 控制板窗口（侧栏 + 剪贴板/密码本/消息中心/API 配置/设置）
 *  - DataHub（本地 Webhook 接收第三方消息 → 控制板 + 宠物气泡）
 *
 * 所有窗口关闭 = 隐藏常驻；仅托盘"退出"真正退出进程。
 *
 * v1 闭环：
 *  - 开发版与打包版使用不同 userData（否则单实例锁互相踢、日志/配置混在一起）
 *  - 开机自启默认关闭，只在打包版写注册表，首启由控制板引导提示
 *  - 主进程日志落盘 + 全局异常兜底 + 启动失败弹错误框
 */
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { createPetWindow, getPetWindow, destroyPetWindow } from './pet-window'
import { createTray } from './tray'
import { openPanel, togglePanel, getPanelWindow, setPanelQuitting } from './panel/panel-window'
import { initDatabase, closeDatabase, vacuumDatabase } from './storage/db'
import { registerImageProtocol } from './protocol'
import { registerIpcHandlers, broadcastToRenderers } from './ipc'
import { startClipboardMonitor, stopClipboardMonitor } from './clipboard/monitor'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys'
import { triggerScreenshot, setMainWindowGetter, disposeScreenshot } from './screenshot/capture'
import { startCleanupScheduler, stopCleanupScheduler } from './cleanup/scheduler'
import { applyAutoStart } from './system/autoStart'
import { initVaultService, disposeVaultService } from './vault/service'
import { initDataHub, disposeDataHub } from './datahub'
import { getSetting, setSetting } from './storage/settings'
import { initLogger, installGlobalErrorHandlers, log } from './log'

// ── 0) 开发版 / 打包版使用不同 userData ─────────────────────
// 必须在 requestSingleInstanceLock 之前设置：单实例锁文件位于 userData 目录。
// 打包版保持 desktop-pet（沿用现有数据，不做迁移）；开发版用 desktop-pet-dev。
if (!app.isPackaged) {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'desktop-pet-dev'))
  } catch (err) {
    console.error('[main] 设置开发版 userData 失败：', err)
  }
}

// ── 1) 日志 / 全局异常（尽早）─────────────────────────────
initLogger()
installGlobalErrorHandlers()

// Windows 通知归属（Toast 显示为"灵犀"而不是 Electron；需与打包 appId 一致）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.heguangchen.deskpet')
}

// ── 2) 单实例锁：避免启动多个实例 ─────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    openPanel()
  })

  app
    .whenReady()
    .then(() => bootstrap())
    .catch((err) => {
      console.error('[main] 启动失败：', err)
      try {
        dialog.showErrorBox(
          '灵犀启动失败',
          `应用初始化时出错，请把日志（userData/logs/main.log）发给开发者。\n\n${String(
            err instanceof Error ? err.stack ?? err.message : err
          )}`
        )
      } catch {
        /* ignore */
      }
      app.quit()
    })

  // 桌宠常驻：所有窗口关闭不退出（托盘存活）
  app.on('window-all-closed', () => {
    // 常驻
  })

  // 退出标记：允许窗口真正关闭
  app.on('before-quit', () => {
    setPanelQuitting(true)
  })

  app.on('will-quit', () => {
    stopClipboardMonitor()
    unregisterGlobalHotkeys()
    disposeScreenshot()
    stopCleanupScheduler()
    closeDatabase()
    disposeVaultService()
    disposeDataHub()
  })
}

async function bootstrap(): Promise<void> {
  // 关闭系统菜单栏（无框窗口不需要）
  Menu.setApplicationMenu(null)
  console.log(`[main] 启动 v${app.getVersion()} · packaged=${app.isPackaged} · userData=${app.getPath('userData')}`)

  // ── 1) 剪贴板模块（常驻监听）────────────────────
  initDatabase()
  console.log('[main] 剪贴板数据库初始化完成（与独立版共用 %APPDATA%/clipboard-plus）')

  registerImageProtocol()
  registerIpcHandlers()

  // 截图流程需要隐藏/恢复"主窗口"——控制板窗口
  setMainWindowGetter(() => getPanelWindow())

  registerGlobalHotkeys({
    onScreenshot: () => {
      void triggerScreenshot()
    },
    onTogglePanel: togglePanel
  })

  startCleanupScheduler()

  // 数据库瘦身：启动 5 秒后低频执行一次（回收删除留下的空闲页，内容不变）
  setTimeout(() => vacuumDatabase(), 5000)

  startClipboardMonitor((record) => {
    broadcastToRenderers('clipboard:new', record)
  })
  console.log('[main] 剪贴板监听已启动（250ms 轮询 · 同日去重）')

  applyAutoStart()

  // ── 2) 密码本模块（常驻，vault.pvlt 兼容）────────
  initVaultService()
  console.log('[main] 密码本服务已就绪（常驻 · 秒开）')

  // ── 3) DataHub：第三方消息中枢 ───────────────────
  initDataHub()

  // ── 4) 宠物窗口（可选：设置 pet.enabled，默认隐藏）+ 托盘 ──
  // 桌宠为可选项：仅设置显式为 'true' 时创建并显示，默认隐藏
  const petEnabled = getSetting('pet.enabled') === 'true'
  if (petEnabled) createPetWindow()
  createTray()

  // 桌宠开关：设置页调用 → 写设置 + 创建/销毁窗口
  ipcMain.handle('pet:getEnabled', () => getSetting('pet.enabled') === 'true')
  ipcMain.handle('pet:setEnabled', (_event, enabled: boolean) => {
    setSetting('pet.enabled', String(enabled))
    if (enabled) {
      if (!getPetWindow()) createPetWindow()
    } else {
      destroyPetWindow()
    }
    return true
  })

  // 宠物右键菜单 → 控制板各页
  ipcMain.on(IpcChannels.PetContextMenu, (event) => {
    const menu = Menu.buildFromTemplate([
      { label: '打开控制板 · 剪贴板', click: () => openPanel('clipboard') },
      { label: '打开控制板 · 密码本', click: () => openPanel('vault') },
      { label: '打开控制板 · 消息中心', click: () => openPanel('messages') },
      { label: '打开控制板 · 任务追踪', click: () => openPanel('tasks') },
      { label: '打开控制板 · 启动中心', click: () => openPanel('launcher') },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
    const owner = BrowserWindow.fromWebContents(event.sender)
    menu.popup(owner ? { window: owner } : {})
  })

  // 宠物菜单直通：打开控制板对应页
  ipcMain.on(IpcChannels.PetOpenClipboard, () => openPanel('clipboard'))
  ipcMain.on(IpcChannels.PetOpenVault, () => openPanel('vault'))
  ipcMain.on(IpcChannels.PetQuit, () => app.quit())

  app.on('activate', () => {
    openPanel()
  })

  // ── 5) 首启引导：显示控制板，提示"可在设置中开启开机自启"（不替用户做决定）──
  const onboardingDone = getSetting('onboarding.done') === 'true'
  if (!onboardingDone) {
    log('log', '[main] 首次启动：打开控制板并显示引导')
    openPanel()
  }
}
