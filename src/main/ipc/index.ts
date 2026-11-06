/**
 * IPC 层（阶段 3）
 *  - 统一注册主进程 handler（白名单 API）
 *  - 广播辅助函数：主进程 → 所有渲染窗口推送事件
 */
import { ipcMain, BrowserWindow, dialog, app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getDbStatus, getDataRoot, getDbPath } from '../storage/db'
import { getLogPath } from '../log'
import { showTestNotification } from '../notify/desktop'
import { getVaultState } from '../vault/service'
import {
  listClips,
  deleteClip,
  clearClipsByDate,
  listClipsByDate,
  getClipDates
} from '../storage/historyRepo'
import { getSetting, setSetting, getAllSettings } from '../storage/settings'
import { runRetentionCleanup } from '../cleanup/scheduler'
import { exportByDate } from '../export/exporter'
import { updateHotkey, type HotkeyKind } from '../hotkeys'
import { setAutoStart } from '../system/autoStart'
import { copyClipToClipboard } from '../clipboard/actions'
import {
  listFavorites,
  listFavoritesByCategory,
  listCategories,
  addCategory,
  removeCategory,
  saveFavoriteToCategories,
  removeFavoriteFromCategory,
  removeFavorite,
  updateFavorite,
  findFavoriteByHistory,
  copyFavoriteToClipboard
} from '../storage/favoriteRepo'
import { triggerScreenshot, confirmScreenshot, cancelScreenshot } from '../screenshot/capture'
import {
  listTaskStatuses,
  addTaskStatus,
  updateTaskStatus,
  removeTaskStatus,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  setTaskStatus,
  listTaskLogs,
  addTaskLog
} from '../storage/taskRepo'
import type { TaskInput } from '../../shared/types'
import type { ScreenshotRegion } from '../../shared/types'

/** 注册全部 IPC handler（app ready 后调用一次） */
export function registerIpcHandlers(): void {
  // 阶段 1：数据库状态（验证用）
  ipcMain.handle('app:getDbStatus', () => getDbStatus())

  // 阶段 2：剪贴历史倒序查询（最新在前）
  ipcMain.handle('clipboard:list', (_event, limit?: number) => listClips(limit ?? 100))

  // 阶段 3：复制 / 删除 / 清空当日
  ipcMain.handle('clipboard:copy', (_event, id: number) => copyClipToClipboard(id))
  ipcMain.handle('clipboard:delete', (_event, id: number) => deleteClip(id))
  ipcMain.handle('clipboard:clearByDate', (_event, date: string) => clearClipsByDate(date))

  // 阶段 4：收藏（v4 目录制）
  ipcMain.handle('favorite:list', () => listFavorites())
  ipcMain.handle('favorite:listByCategory', (_event, categoryId: number) =>
    listFavoritesByCategory(categoryId)
  )
  ipcMain.handle('favorite:categories:list', () => listCategories())
  ipcMain.handle('favorite:categories:add', (_event, name: string) => addCategory(name))
  ipcMain.handle('favorite:categories:remove', (_event, id: number) => removeCategory(id))
  ipcMain.handle('favorite:save', (_event, historyId: number, categoryIds: number[]) => {
    try {
      const res = saveFavoriteToCategories(historyId, categoryIds)
      console.log(
        '[favorite:save]',
        historyId,
        JSON.stringify(categoryIds),
        '=>',
        res ? JSON.stringify(res) : 'NULL'
      )
      return res
    } catch (e) {
      console.log('[favorite:save] ERR', historyId, String(e))
      throw e
    }
  })
  ipcMain.handle('favorite:removeFromCategory', (_event, favoriteId: number, categoryId: number) =>
    removeFavoriteFromCategory(favoriteId, categoryId)
  )
  ipcMain.handle('favorite:copy', (_event, id: number) => copyFavoriteToClipboard(id))
  ipcMain.handle('favorite:remove', (_event, id: number) => removeFavorite(id))
  ipcMain.handle('favorite:update', (_event, id: number, patch: { text?: string; note?: string }) =>
    updateFavorite(id, patch)
  )
  ipcMain.handle('favorite:findByHistory', (_event, historyId: number) =>
    findFavoriteByHistory(historyId)
  )

  // 阶段 5：截图（capture 由快捷键或 UI 触发；confirm/cancel 由框选窗口 preload 触发）
  ipcMain.handle('screenshot:capture', () => triggerScreenshot())
  ipcMain.on('screenshot:confirm', (_event, region: ScreenshotRegion) => confirmScreenshot(region))
  ipcMain.on('screenshot:cancel', () => cancelScreenshot())

  // 阶段 6：每日记录回溯
  ipcMain.handle('clipboard:dates', () => getClipDates())
  ipcMain.handle('clipboard:listByDate', (_event, date: string) => listClipsByDate(date))
  ipcMain.handle('clipboard:retentionCleanup', () => runRetentionCleanup())
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    return true
  })
  // 导出：弹目录选择框（主进程侧），按格式生成 HTML/PDF，取消返回 null
  ipcMain.handle(
    'export:byDate',
    async (event, date: string, format: 'html' | 'pdf' = 'html') => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: `导出 ${date} 的剪贴记录（${format === 'pdf' ? 'PDF' : 'HTML'}）`,
        properties: ['openDirectory', 'createDirectory']
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return exportByDate(date, result.filePaths[0], format)
    }
  )

  // 阶段 7：设置页 / 托盘相关
  ipcMain.handle('settings:getAll', () => getAllSettings())

  // ── v1：应用信息 / 数据目录 / 通知测试 ──
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    clipboardDataPath: getDataRoot(),
    dbPath: getDbPath(),
    logPath: getLogPath()
  }))

  /** 打开数据目录（设置页"数据与备份"用）：target 白名单，避免任意路径读取 */
  ipcMain.handle('app:openPath', async (_event, target: 'clipboard' | 'userData' | 'logs' | 'vault') => {
    let dir: string | null = null
    if (target === 'clipboard') dir = getDataRoot()
    else if (target === 'userData') dir = app.getPath('userData')
    else if (target === 'logs') dir = path.dirname(getLogPath() || path.join(app.getPath('userData'), 'logs'))
    else if (target === 'vault') {
      const vaultPath = getVaultState().path
      dir = vaultPath ? path.dirname(vaultPath) : null
    }
    if (!dir) return { ok: false, error: '路径不存在' }
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* 目录已存在或无权限时交给 openPath 报错 */
    }
    const err = await shell.openPath(dir)
    return err ? { ok: false, error: err } : { ok: true }
  })

  /** 设置页"测试通知"：验证系统通知是否可用 */
  ipcMain.handle('notify:test', () => ({ ok: showTestNotification() }))

  ipcMain.handle('hotkey:update', (_event, kind: HotkeyKind, accelerator: string) =>
    updateHotkey(kind, accelerator)
  )
  ipcMain.handle('app:setAutoStart', (_event, enabled: boolean) => {
    setAutoStart(enabled)
    return true
  })
  // 通用目录选择（设置页"截图保存路径"用），取消返回 null
  ipcMain.handle('dialog:chooseDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 阶段 8：任务追踪
  ipcMain.handle('task:statuses:list', () => listTaskStatuses())
  ipcMain.handle('task:statuses:add', (_event, name: string, color: string) =>
    addTaskStatus(name, color)
  )
  ipcMain.handle(
    'task:statuses:update',
    (_event, id: number, patch: { name?: string; color?: string; sort_order?: number }) =>
      updateTaskStatus(id, patch)
  )
  ipcMain.handle('task:statuses:remove', (_event, id: number) => removeTaskStatus(id))
  ipcMain.handle('task:list', () => listTasks())
  ipcMain.handle('task:create', (_event, input: TaskInput) => createTask(input))
  ipcMain.handle('task:update', (_event, id: number, patch: Partial<TaskInput>) =>
    updateTask(id, patch)
  )
  ipcMain.handle('task:delete', (_event, id: number) => deleteTask(id))
  ipcMain.handle('task:setStatus', (_event, id: number, statusId: number, note?: string) =>
    setTaskStatus(id, statusId, note)
  )
  ipcMain.handle('task:logs', (_event, taskId: number) => listTaskLogs(taskId))
  ipcMain.handle('task:addLog', (_event, taskId: number, note: string) => addTaskLog(taskId, note))
}

/** 向所有渲染窗口广播事件（如 clipboard:new 实时推送） */
export function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}
