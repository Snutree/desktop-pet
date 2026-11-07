/**
 * 共享 API 定义（无 contextBridge 副作用）
 *
 * 各 preload 入口从这里 import 纯 api 对象，再各自 exposeInMainWorld。
 * 这样 panel.ts 复用剪贴板/密码本/宠物 api 时不会因 require 副作用
 * 二次绑定同一 key 而崩溃（Cannot bind an API on top of an existing property）。
 */
import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type PetBubblePayload } from '../shared/ipc'
import type { ClipRecord, FavoriteRecord, FavoriteWithCategories, AppSettings, AppInfo, TaskInput, TaskRecord, TaskStatus, TaskProgressLog, LauncherGroup, LauncherEntry, LauncherInput } from '../shared/types'
import type { GenerateOptions } from '../main/vault/generator'
import type { VaultEntry } from '../main/vault/database'
import type { DataSource, HubMessage, PanelTab } from '../shared/datahub'

// ── 剪贴板 ────────────────────────────────────────────────
export const clipboardPlusApi = {
  /** 查询数据库初始化状态（阶段 1 建表验证） */
  getDbStatus: (): Promise<{
    tables: { name: string }[]
    counts: Record<string, number>
    path: string
  }> => ipcRenderer.invoke('app:getDbStatus'),

  /** 倒序查询剪贴历史（最新在前） */
  listClips: (limit?: number): Promise<ClipRecord[]> =>
    ipcRenderer.invoke('clipboard:list', limit ?? 100),

  /** 将历史记录写回系统剪贴板 */
  copyClip: (id: number): Promise<boolean> => ipcRenderer.invoke('clipboard:copy', id),

  /** 删除单条历史记录 */
  deleteClip: (id: number): Promise<boolean> => ipcRenderer.invoke('clipboard:delete', id),

  /** 清空指定本地日期（yyyy-MM-dd）的非收藏历史，返回删除条数 */
  clearByDate: (date: string): Promise<number> => ipcRenderer.invoke('clipboard:clearByDate', date),

  /** 订阅剪贴板新记录（含同日去重后的置顶刷新），返回取消订阅函数 */
  onClipboardNew: (callback: (record: ClipRecord) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, record: ClipRecord): void => callback(record)
    ipcRenderer.on('clipboard:new', listener)
    return () => {
      ipcRenderer.removeListener('clipboard:new', listener)
    }
  },

  // ── 阶段 4：收藏（v4 目录制）─────────────────────────────
  /** 全部收藏（含所属目录 id） */
  listFavorites: (): Promise<FavoriteRecord[]> => ipcRenderer.invoke('favorite:list'),

  /** 按目录查收藏 */
  listFavoritesByCategory: (categoryId: number): Promise<FavoriteWithCategories[]> =>
    ipcRenderer.invoke('favorite:listByCategory', categoryId),

  /** 目录列表（默认目录在前） */
  listCategories: (): Promise<{ id: number; name: string; is_default: number; created_at: number }[]> =>
    ipcRenderer.invoke('favorite:categories:list'),

  /** 新建目录（重名返回 null） */
  addCategory: (name: string): Promise<{ id: number; name: string; is_default: number; created_at: number } | null> =>
    ipcRenderer.invoke('favorite:categories:add', name),

  /** 删除目录（默认目录不可删） */
  removeCategory: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('favorite:categories:remove', id),

  /** 重命名目录（默认目录也允许改名） */
  renameCategory: (id: number, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('favorite:categories:rename', id, name),

  /** 把收藏从当前目录移动到其他目录（可多选） */
  moveFavoriteToCategories: (
    favoriteId: number,
    fromCategoryId: number,
    targetCategoryIds: number[]
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('favorite:moveToCategories', favoriteId, fromCategoryId, targetCategoryIds),

  /** 目录内收藏拖拽排序 */
  reorderFavorites: (categoryId: number, orderedIds: number[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('favorite:reorder', categoryId, orderedIds),

  /** 将历史记录保存到多个目录；返回收藏 id 与生效目录 id */
  saveFavorite: (
    historyId: number,
    categoryIds: number[]
  ): Promise<{ favoriteId: number; categoryIds: number[] } | null> =>
    ipcRenderer.invoke('favorite:save', historyId, categoryIds),

  /** 从目录移除收藏（无目录归属时删除收藏本体） */
  removeFavoriteFromCategory: (favoriteId: number, categoryId: number): Promise<boolean> =>
    ipcRenderer.invoke('favorite:removeFromCategory', favoriteId, categoryId),

  /** 复制收藏内容到系统剪贴板（按收藏 id） */
  copyFavorite: (id: number): Promise<boolean> => ipcRenderer.invoke('favorite:copy', id),

  /** 删除整条收藏（解除全部目录关联） */
  removeFavorite: (id: number): Promise<boolean> => ipcRenderer.invoke('favorite:remove', id),

  /** 编辑收藏：文本改内容 / 通用改备注（共享内容，全局生效） */
  updateFavorite: (
    id: number,
    patch: { text?: string; note?: string }
  ): Promise<FavoriteRecord | null> => ipcRenderer.invoke('favorite:update', id, patch),

  /** 按来源历史 id 查收藏 */
  findFavoriteByHistory: (historyId: number): Promise<FavoriteRecord | null> =>
    ipcRenderer.invoke('favorite:findByHistory', historyId),

  // ── 阶段 5：截图 ──────────────────────────────────────
  /** 唤起框选截图（同全局快捷键 Ctrl+Shift+S） */
  captureScreenshot: (): Promise<boolean> => ipcRenderer.invoke('screenshot:capture'),

  // ── 阶段 6：每日记录回溯 ───────────────────────────────
  /** 有剪贴记录的本地日期列表（倒序） */
  listClipDates: (): Promise<string[]> => ipcRenderer.invoke('clipboard:dates'),

  /** 查询指定日期（yyyy-MM-dd）的全部记录（倒序） */
  listClipsByDate: (date: string): Promise<ClipRecord[]> =>
    ipcRenderer.invoke('clipboard:listByDate', date),

  /** 手动触发一次过期清理，返回删除条数 */
  runRetentionCleanup: (): Promise<number> => ipcRenderer.invoke('clipboard:retentionCleanup'),

  /** 读取设置值（settings 表原始 JSON 字符串，无则 null） */
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),

  /** 写入设置值 */
  setSetting: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:set', key, value),

  /** 导出指定日期记录：弹目录选择框，按格式生成 HTML/PDF 单文件（图片内嵌），取消返回 null */
  exportByDate: (
    date: string,
    format: 'html' | 'pdf'
  ): Promise<{
    dir: string
    file: string
    format: 'html' | 'pdf'
    imageCount: number
    recordCount: number
  } | null> => ipcRenderer.invoke('export:byDate', date, format),

  // ── 阶段 7：设置页 / 托盘 ─────────────────────────────
  /** 一次性读取全部设置 */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:getAll'),

  /** 更新快捷键（先试注册、冲突回滚），kind: 'screenshot' | 'panel' */
  updateHotkey: (
    kind: 'screenshot' | 'panel',
    accelerator: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hotkey:update', kind, accelerator),

  /** 设置开机自启（立即生效） */
  setAutoStart: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('app:setAutoStart', enabled),

  /** 选择目录（设置页截图保存路径用），取消返回 null */
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseDirectory')
}
export type ClipboardPlusApi = typeof clipboardPlusApi

// ── 密码本 ────────────────────────────────────────────────
export const vaultApiObj = {
  getState: (): Promise<{
    exists: boolean
    unlocked: boolean
    path: string
    entryCount: number
    autoLockMinutes: number
  }> => ipcRenderer.invoke('vault:getState'),

  create: (password: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('vault:create', password),

  unlock: (password: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vault:unlock', password),

  lock: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('vault:lock'),

  /** 交互心跳：刷新闲置锁定计时 */
  activity: (): void => {
    ipcRenderer.send('vault:activity')
  },

  search: (keyword: string, category: string | null): Promise<VaultEntry[]> =>
    ipcRenderer.invoke('vault:search', keyword, category),

  categories: (): Promise<{ category: string; count: number }[]> =>
    ipcRenderer.invoke('vault:categories'),

  /** 重命名分类（批量更新该分类下所有条目） */
  renameCategory: (
    oldName: string,
    newName: string
  ): Promise<{ ok: boolean; error?: string; updated?: number }> =>
    ipcRenderer.invoke('vault:renameCategory', oldName, newName),

  /** 删除分类（条目迁移到「未分类」） */
  deleteCategory: (
    name: string
  ): Promise<{ ok: boolean; error?: string; moved?: number }> =>
    ipcRenderer.invoke('vault:deleteCategory', name),

  get: (id: number): Promise<VaultEntry | null> => ipcRenderer.invoke('vault:get', id),

  add: (data: Partial<VaultEntry>): Promise<{ ok: boolean; id?: number; error?: string }> =>
    ipcRenderer.invoke('vault:add', data),

  update: (
    id: number,
    data: Partial<VaultEntry>
  ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('vault:update', id, data),

  delete: (id: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vault:delete', id),

  generate: (opts: GenerateOptions): Promise<{ ok: boolean; password?: string; error?: string }> =>
    ipcRenderer.invoke('vault:generate', opts),

  /** 复制账号/密码（30 秒自动清空剪贴板） */
  copy: (id: number, field: 'account' | 'password'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vault:copy', id, field),

  changePassword: (
    oldPassword: string,
    newPassword: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vault:changePassword', oldPassword, newPassword),

  exportBackup: (): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('vault:exportBackup'),

  openFile: (): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('vault:openFile'),

  createFile: (): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('vault:createFile'),

  getSettings: (): Promise<{ vaultPath: string; autoLockMinutes: number }> =>
    ipcRenderer.invoke('vault:getSettings'),

  setAutoLock: (minutes: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('vault:setAutoLock', minutes),

  /** 订阅自动锁定事件（回到登录界面） */
  onAutoLocked: (callback: (reason: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { reason: string }): void =>
      callback(payload.reason)
    ipcRenderer.on('vault:locked', listener)
    return () => {
      ipcRenderer.removeListener('vault:locked', listener)
    }
  }
}
export type VaultApi = typeof vaultApiObj

// ── 启动中心（v1.1） ──────────────────────────────────────
export const launcherApi = {
  listGroups: (): Promise<LauncherGroup[]> => ipcRenderer.invoke('launcher:groups:list'),
  addGroup: (name: string): Promise<{ ok: boolean; data?: LauncherGroup; error?: string }> =>
    ipcRenderer.invoke('launcher:groups:add', name),
  renameGroup: (id: number, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('launcher:groups:rename', id, name),
  deleteGroup: (
    id: number
  ): Promise<{ ok: boolean; error?: string; deletedItems?: number }> =>
    ipcRenderer.invoke('launcher:groups:delete', id),

  listEntries: (groupId?: number | null): Promise<LauncherEntry[]> =>
    ipcRenderer.invoke('launcher:entries:list', groupId ?? null),
  addEntry: (
    input: LauncherInput
  ): Promise<{ ok: boolean; data?: LauncherEntry; error?: string }> =>
    ipcRenderer.invoke('launcher:entries:add', input),
  updateEntry: (
    id: number,
    patch: Partial<LauncherInput>
  ): Promise<{ ok: boolean; data?: LauncherEntry; error?: string }> =>
    ipcRenderer.invoke('launcher:entries:update', id, patch),
  deleteEntry: (id: number): Promise<boolean> => ipcRenderer.invoke('launcher:entries:delete', id),
  reorderEntries: (groupId: number, orderedIds: number[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('launcher:entries:reorder', groupId, orderedIds),

  run: (id: number, forceAdmin = false): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('launcher:entries:run', id, forceAdmin),
  chooseFile: (): Promise<{
    ok?: boolean
    canceled?: boolean
    path?: string
    dir?: string
    name?: string
    ext?: string
  }> => ipcRenderer.invoke('launcher:chooseFile'),
  reveal: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('launcher:reveal', id)
}
export type LauncherApi = typeof launcherApi

// ── 宠物 ──────────────────────────────────────────────────
export const petApiObj = {
  /** 是否启用桌宠（设置 pet.enabled，默认隐藏） */
  getEnabled: (): Promise<boolean> => ipcRenderer.invoke('pet:getEnabled'),
  /** 设置页开关：启用则创建并显示桌宠窗口，关闭则销毁 */
  setEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('pet:setEnabled', enabled),
  /** 开始拖拽（传入按下时鼠标屏幕坐标） */
  dragStart(mouseX: number, mouseY: number): void {
    ipcRenderer.send(IpcChannels.PetDragStart, { mouseX, mouseY })
  },
  /** 结束拖拽 */
  dragEnd(): void {
    ipcRenderer.send(IpcChannels.PetDragEnd)
  },
  /** 弹出右键菜单 */
  showContextMenu(): void {
    ipcRenderer.send(IpcChannels.PetContextMenu)
  },
  /** 打开剪贴板面板 */
  openClipboard(): void {
    ipcRenderer.send(IpcChannels.PetOpenClipboard)
  },
  /** 打开密码本 */
  openVault(): void {
    ipcRenderer.send(IpcChannels.PetOpenVault)
  },
  /** 退出 */
  quit(): void {
    ipcRenderer.send(IpcChannels.PetQuit)
  },
  /** 订阅宠物气泡消息（后续数据源通知入口） */
  onBubble(callback: (payload: PetBubblePayload) => void): () => void {
    const listener = (_evt: unknown, payload: PetBubblePayload): void => callback(payload)
    ipcRenderer.on(IpcChannels.PetShowBubble, listener)
    return () => ipcRenderer.removeListener(IpcChannels.PetShowBubble, listener)
  }
}
export type PetApi = typeof petApiObj

// ── 控制板 / DataHub ──────────────────────────────────────
export const panelApi = {
  /** 控制板/DataHub 运行状态 */
  getStatus: (): Promise<{ port: number; running: boolean }> =>
    ipcRenderer.invoke('panel:getStatus'),
  // ── API 配置：连接器 CRUD ─────────────────────────
  listConnectors: (): Promise<DataSource[]> => ipcRenderer.invoke('panel:connectors:list'),
  addConnector: (data: Omit<DataSource, 'id' | 'createdAt'>): Promise<{
    ok: boolean
    data?: DataSource
    error?: string
  }> => ipcRenderer.invoke('panel:connectors:add', data),
  updateConnector: (id: string, patch: Partial<DataSource>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('panel:connectors:update', id, patch),
  deleteConnector: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('panel:connectors:delete', id),
  // ── 消息中心 ──────────────────────────────────────
  listMessages: (): Promise<HubMessage[]> => ipcRenderer.invoke('panel:messages:list'),
  markRead: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('panel:messages:markRead', id),
  markAllRead: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('panel:messages:markAllRead'),
  clearMessages: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('panel:messages:clear'),
  /** 测试推送一条示例消息（API 配置页/消息中心用） */
  pushTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('panel:messages:pushTest'),
  /** 订阅新消息（webhook 收到 → 实时刷新） */
  onMessageNew: (callback: (msg: HubMessage) => void): (() => void) => {
    const listener = (_e: unknown, msg: HubMessage): void => callback(msg)
    ipcRenderer.on('panel:message:new', listener)
    return () => {
      ipcRenderer.removeListener('panel:message:new', listener)
    }
  },
  /** 订阅连接器变更（配置页编辑后其它页刷新） */
  onConnectorsChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('panel:connectors:changed', listener)
    return () => {
      ipcRenderer.removeListener('panel:connectors:changed', listener)
    }
  },
  /** 订阅外部切换页签（宠物菜单/托盘 → 控制板指定页） */
  onSwitchTab: (callback: (tab: PanelTab) => void): (() => void) => {
    const listener = (_e: unknown, tab: PanelTab): void => callback(tab)
    ipcRenderer.on('panel:switch-tab', listener)
    return () => {
      ipcRenderer.removeListener('panel:switch-tab', listener)
    }
  },
  /** 订阅 Webhook 服务状态变化（端口被占用等） */
  onStatusChanged: (
    callback: (status: { port: number; running: boolean }) => void
  ): (() => void) => {
    const listener = (_e: unknown, status: { port: number; running: boolean }): void =>
      callback(status)
    ipcRenderer.on('panel:status:changed', listener)
    return () => {
      ipcRenderer.removeListener('panel:status:changed', listener)
    }
  },
  // ── v1：应用信息 / 数据目录 / 通知 ───────────────────
  /** 应用信息（版本号/是否打包/数据目录/日志路径） */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  /** 打开数据目录（白名单） */
  openPath: (
    target: 'clipboard' | 'userData' | 'logs' | 'vault'
  ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:openPath', target),
  /** 弹一条系统通知（测试通知是否可用） */
  notifyTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('notify:test'),
  // ── 任务追踪 ─────────────────────────────────────────
  listTaskStatuses: (): Promise<TaskStatus[]> => ipcRenderer.invoke('task:statuses:list'),
  addTaskStatus: (name: string, color: string): Promise<{ ok: boolean; data?: TaskStatus; error?: string }> =>
    ipcRenderer.invoke('task:statuses:add', name, color),
  updateTaskStatus: (
    id: number,
    patch: { name?: string; color?: string; sort_order?: number }
  ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('task:statuses:update', id, patch),
  removeTaskStatus: (id: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('task:statuses:remove', id),
  listTasks: (): Promise<TaskRecord[]> => ipcRenderer.invoke('task:list'),
  createTask: (input: TaskInput): Promise<TaskRecord | null> =>
    ipcRenderer.invoke('task:create', input),
  updateTask: (id: number, patch: Partial<TaskInput>): Promise<TaskRecord | null> =>
    ipcRenderer.invoke('task:update', id, patch),
  deleteTask: (id: number): Promise<boolean> => ipcRenderer.invoke('task:delete', id),
  setTaskStatus: (id: number, statusId: number, note?: string): Promise<TaskRecord | null> =>
    ipcRenderer.invoke('task:setStatus', id, statusId, note),
  listTaskLogs: (taskId: number): Promise<TaskProgressLog[]> =>
    ipcRenderer.invoke('task:logs', taskId),
  addTaskLog: (taskId: number, note: string): Promise<TaskProgressLog | null> =>
    ipcRenderer.invoke('task:addLog', taskId, note)
}
export type PanelApi = typeof panelApi
