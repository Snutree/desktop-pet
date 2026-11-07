/**
 * 密码本主进程服务（集成进 desktop-pet）
 *
 * - 单例 Vault 管理：创建 / 解锁 / 锁定 / 改密 / 备份
 * - 与独立版 PasswordVault 的 vault.pvlt 字节级兼容，可直接解锁旧库
 * - 默认库路径：userData/vault.pvlt；支持从任意位置打开/新建库文件（换机用）
 *   旧版曾硬编码开发机路径 F:\...\password_program\dist\vault.pvlt，v1 已移除
 * - 复制密码 30 秒自动清空剪贴板（仅当剪贴板内容未被用户改写时）
 * - 闲置自动锁定（可配置，默认关闭；锁定后广播 vault:locked）
 */
import { app, clipboard, dialog, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Vault, VaultError } from './vault'
import {
  searchEntries,
  listCategories,
  getEntry,
  addEntry,
  updateEntry,
  deleteEntry,
  countEntries,
  renameCategory,
  deleteCategory,
  type VaultEntry
} from './database'
import { generatePassword, type GenerateOptions } from './generator'

// ── 库文件定位 ─────────────────────────────────────────────

/** 新默认库路径：userData/vault.pvlt */
function defaultVaultPath(): string {
  return path.join(app.getPath('userData'), 'vault.pvlt')
}

/**
 * 解析实际使用的库路径：优先设置记忆 → 新默认路径。
 * （旧版曾硬编码开发机绝对路径 F:\GitHub\...\vault.pvlt，v1 已移除：
 *  换机/分发后那条路径不存在，只会让用户误以为"库丢了"。）
 */
function resolveVaultPath(): string {
  const remembered = getSettings().vaultPath
  if (remembered && fs.existsSync(remembered)) return remembered
  return defaultVaultPath()
}

/**
 * 新建库时的目标路径：尊重用户"新建到指定位置"的选择（文件尚未存在），
 * 否则回落到默认位置。
 */
function preferredVaultPath(): string {
  return getSettings().vaultPath || defaultVaultPath()
}

// ── 设置存储（userData/vault-settings.json） ─────────────────

interface VaultSettings {
  vaultPath: string
  autoLockMinutes: number // 0 = 不自动锁定
}

const SETTINGS_FILE = (): string => path.join(app.getPath('userData'), 'vault-settings.json')

function getSettings(): VaultSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE(), 'utf8')
    const obj = JSON.parse(raw) as Partial<VaultSettings>
    return {
      vaultPath: typeof obj.vaultPath === 'string' ? obj.vaultPath : '',
      // v1 起默认闲置 5 分钟自动锁定（老用户已显式设置的值保持不变）
      autoLockMinutes: typeof obj.autoLockMinutes === 'number' ? obj.autoLockMinutes : 5
    }
  } catch {
    return { vaultPath: '', autoLockMinutes: 5 }
  }
}

function saveSettings(patch: Partial<VaultSettings>): void {
  const next = { ...getSettings(), ...patch }
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2), { mode: 0o600 })
}

// ── 复制密码 30 秒自动清空 ─────────────────────────────────

let autoClearTimer: NodeJS.Timeout | null = null
let lastCopiedText: string | null = null

export function copyWithAutoClear(text: string): void {
  clipboard.writeText(text)
  lastCopiedText = text
  if (autoClearTimer) clearTimeout(autoClearTimer)
  autoClearTimer = setTimeout(() => {
    if (lastCopiedText !== null && clipboard.readText() === lastCopiedText) {
      clipboard.clear()
    }
    lastCopiedText = null
    autoClearTimer = null
  }, 30_000)
}

// ── 闲置自动锁定 ───────────────────────────────────────────

let lastActivity = Date.now()
let lockTimer: NodeJS.Timeout | null = null

function touchActivity(): void {
  lastActivity = Date.now()
}

function startAutoLockWatcher(): void {
  if (lockTimer) return
  lockTimer = setInterval(() => {
    const minutes = getSettings().autoLockMinutes
    if (minutes <= 0 || !vault.isUnlocked) return
    if (Date.now() - lastActivity > minutes * 60_000) {
      console.log('[vault] 闲置超时，自动锁定')
      vault.lock()
      broadcastToVaultWindows('vault:locked', { reason: 'idle' })
    }
  }, 10_000)
}

function stopAutoLockWatcher(): void {
  if (lockTimer) {
    clearInterval(lockTimer)
    lockTimer = null
  }
}

// ── 单例与状态 ─────────────────────────────────────────────

export const vault = new Vault()

export interface VaultState {
  exists: boolean
  unlocked: boolean
  path: string
  entryCount: number
  autoLockMinutes: number
}

export function getVaultState(): VaultState {
  return {
    exists: fs.existsSync(vault.path ?? resolveVaultPath()),
    unlocked: vault.isUnlocked,
    path: vault.path ?? resolveVaultPath(),
    entryCount: vault.isUnlocked ? countEntries(vault.conn) : 0,
    autoLockMinutes: getSettings().autoLockMinutes
  }
}

// ── IPC 注册 ───────────────────────────────────────────────

function broadcastToVaultWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.getURL().includes('vault')) {
      win.webContents.send(channel, payload)
    }
  }
}

export function registerVaultIpcHandlers(): void {
  ipcMain.handle('vault:getState', () => getVaultState())

  ipcMain.handle('vault:create', async (_e, password: string) => {
    try {
      const p = preferredVaultPath()
      fs.mkdirSync(path.dirname(p), { recursive: true })
      await vault.create(p, password)
      saveSettings({ vaultPath: p })
      touchActivity()
      return { ok: true, path: p }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('vault:unlock', async (_e, password: string) => {
    try {
      if (!vault.path) {
        const p = resolveVaultPath()
        if (!fs.existsSync(p)) return { ok: false, error: '保险库文件不存在' }
        vault.open(p)
      }
      const ok = await vault.unlock(password)
      touchActivity()
      if (ok) saveSettings({ vaultPath: vault.path! })
      return { ok, error: ok ? undefined : '主密码错误' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('vault:lock', () => {
    vault.lock()
    return { ok: true }
  })

  // 交互心跳：刷新闲置计时（自动锁定用）
  ipcMain.on('vault:activity', () => touchActivity())

  ipcMain.handle('vault:search', (_e, keyword: string, category: string | null) => {
    if (!vault.isUnlocked) return []
    touchActivity()
    return searchEntries(vault.conn, keyword ?? '', category)
  })

  ipcMain.handle('vault:categories', () => {
    if (!vault.isUnlocked) return []
    touchActivity()
    const rows = listCategories(vault.conn)
    return [{ category: '全部', count: countEntries(vault.conn) }, ...rows]
  })

  ipcMain.handle('vault:get', (_e, id: number) => {
    if (!vault.isUnlocked) return null
    touchActivity()
    return getEntry(vault.conn, id) ?? null
  })

  // 分类重命名 / 删除（删除时条目迁移到「未分类」）
  ipcMain.handle('vault:renameCategory', (_e, oldName: string, newName: string) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    const result = renameCategory(vault.conn, oldName ?? '', newName ?? '')
    if (result.ok) vault.save()
    return result
  })
  ipcMain.handle('vault:deleteCategory', (_e, name: string) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    const result = deleteCategory(vault.conn, name ?? '')
    if (result.ok) vault.save()
    return result
  })

  ipcMain.handle('vault:add', (_e, data: Partial<VaultEntry>) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    const id = addEntry(vault.conn, data)
    vault.save()
    return { ok: true, id }
  })

  ipcMain.handle('vault:update', (_e, id: number, data: Partial<VaultEntry>) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    updateEntry(vault.conn, id, data)
    vault.save()
    return { ok: true }
  })

  ipcMain.handle('vault:delete', (_e, id: number) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    deleteEntry(vault.conn, id)
    vault.save()
    return { ok: true }
  })

  ipcMain.handle('vault:generate', (_e, opts: GenerateOptions) => {
    try {
      return { ok: true, password: generatePassword(opts) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 复制账号/密码（30 秒自动清空）
  ipcMain.handle('vault:copy', (_e, id: number, field: 'account' | 'password') => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    const entry = getEntry(vault.conn, id)
    if (!entry) return { ok: false, error: '条目不存在' }
    const text = entry[field] ?? ''
    if (!text) return { ok: false, error: field === 'account' ? '账号为空' : '密码为空' }
    copyWithAutoClear(text)
    return { ok: true }
  })

  ipcMain.handle('vault:changePassword', async (_e, oldPassword: string, newPassword: string) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    try {
      await vault.changePassword(oldPassword, newPassword)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 导出备份（弹目录选择）
  ipcMain.handle('vault:exportBackup', async (event) => {
    if (!vault.isUnlocked) return { ok: false, error: '未解锁' }
    touchActivity()
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: '导出加密备份',
      defaultPath: `vault-backup-${new Date().toISOString().slice(0, 10)}.pvlt`,
      filters: [{ name: '密码库文件', extensions: ['pvlt'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      vault.exportBackup(result.filePath)
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 打开其他保险库（弹文件选择；解锁由前端继续）
  ipcMain.handle('vault:openFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '打开保险库文件',
      properties: ['openFile'],
      filters: [{ name: '密码库文件', extensions: ['pvlt'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      vault.open(result.filePaths[0])
      saveSettings({ vaultPath: result.filePaths[0] })
      return { ok: true, path: result.filePaths[0] }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 新建保险库（弹保存位置；创建由前端继续）
  ipcMain.handle('vault:createFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: '新建保险库',
      defaultPath: 'vault.pvlt',
      filters: [{ name: '密码库文件', extensions: ['pvlt'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      fs.mkdirSync(path.dirname(result.filePath), { recursive: true })
      saveSettings({ vaultPath: result.filePath })
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('vault:getSettings', () => getSettings())
  ipcMain.handle('vault:setAutoLock', (_e, minutes: number) => {
    saveSettings({ autoLockMinutes: Math.max(0, Math.floor(minutes)) })
    return { ok: true }
  })
}

// ── 生命周期 ───────────────────────────────────────────────

export function initVaultService(): void {
  // 启动时清理异常退出/断电可能残留的明文工作库（userData/vault-work）
  Vault.cleanup()

  // 打开默认库（仅读文件头，不派生密钥 → 秒开）
  const p = resolveVaultPath()
  if (fs.existsSync(p)) {
    try {
      vault.open(p)
      console.log(`[vault] 已打开保险库：${p}`)
    } catch (err) {
      console.warn('[vault] 打开保险库失败：', err)
    }
  }
  registerVaultIpcHandlers()
  startAutoLockWatcher()
}

export function disposeVaultService(): void {
  stopAutoLockWatcher()
  vault.lock()
  Vault.cleanup()
}
