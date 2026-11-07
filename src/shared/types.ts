/**
 * 共享类型：主进程 / 预加载 / 渲染进程三方共用
 * （避免三处重复定义导致类型漂移）
 */

/** 剪贴板记录（对应 clip_history 表行） */
export interface ClipRecord {
  id: number
  content_type: 'text' | 'image'
  text_content: string | null
  image_path: string | null
  thumbnail_path: string | null
  image_width: number | null
  image_height: number | null
  content_hash: string
  is_favorite: number
  source_app: string | null
  created_at: number
  updated_at: number
}

/** 收藏记录（对应 favorites 表行） */
export interface FavoriteRecord {
  id: number
  content_type: 'text' | 'image'
  text_content: string | null
  image_path: string | null
  thumbnail_path: string | null
  note: string | null
  content_hash: string
  source_history_id: number | null
  created_at: number
  updated_at: number
}

/** 收藏目录（对应 favorite_categories 表行） */
export interface FavoriteCategory {
  id: number
  name: string
  is_default: number
  created_at: number
}

/** 收藏记录 + 所属目录 id 列表（目录视图用） */
export interface FavoriteWithCategories extends FavoriteRecord {
  categoryIds: number[]
}

// ── 阶段 5：截图 ────────────────────────────────────────

/** 框选区域（物理像素，主进程直接用于 crop） */
export interface ScreenshotRegion {
  x: number
  y: number
  width: number
  height: number
}

/** 主进程 → 框选窗口的初始化数据 */
export interface ScreenshotInitPayload {
  /** 全屏截图（物理像素 PNG dataURL） */
  imageDataUrl: string
  /** 显示器逻辑尺寸（CSS 像素），即框选窗口可视区域 */
  displayWidth: number
  displayHeight: number
  /** DPI 缩放系数：裁剪时逻辑像素 × scaleFactor = 物理像素 */
  scaleFactor: number
}

// ── 阶段 7：设置页 ──────────────────────────────────────

/** 设置页一次性读取的全部设置 */
export interface AppSettings {
  theme: 'light' | 'dark'
  retention_days: number
  retention_enabled: boolean
  /** 截图另存目录（空字符串 = 不另存） */
  screenshot_dir: string
  auto_start: boolean
  hotkey_screenshot: string
  hotkey_panel: string
  /** 默认导出格式（设置页配置；导出时可临时切换） */
  export_format: 'html' | 'pdf'
}

/** 应用信息（设置页/首启引导用） */
export interface AppInfo {
  version: string
  isPackaged: boolean
  userDataPath: string
  /** 剪贴板数据根目录（DB + 图片） */
  clipboardDataPath: string
  dbPath: string
  logPath: string
}

// ── 任务追踪 ──────────────────────────────────────────────

/** 自定义任务状态（对应 task_statuses 表行） */
export interface TaskStatus {
  id: number
  name: string
  color: string
  sort_order: number
  /** 系统预置状态（默认四态）标记，可改名/改色，不影响删除 */
  is_system: number
  created_at: number
}

/** 任务（对应 tasks 表行 + JOIN 状态名/色） */
export interface TaskRecord {
  id: number
  title: string
  description: string | null
  source_type: 'client' | 'internal' | 'other'
  source_detail: string | null
  priority: 'high' | 'medium' | 'low'
  category: string | null
  link: string | null
  due_date: number | null
  status_id: number
  status_name: string
  status_color: string
  created_at: number
  updated_at: number
}

/** 任务进度备注（对应 task_progress_logs 表行 + 状态快照） */
export interface TaskProgressLog {
  id: number
  task_id: number
  note: string
  status_id: number | null
  status_name: string | null
  status_color: string | null
  created_at: number
}

/** 新建/编辑任务的输入 */
export interface TaskInput {
  title: string
  description?: string
  source_type?: 'client' | 'internal' | 'other'
  source_detail?: string
  priority?: 'high' | 'medium' | 'low'
  category?: string
  link?: string
  due_date?: number | null
  status_id?: number
}

// ── 启动中心（v1.1） ─────────────────────────────────────

export type LauncherType = 'exe' | 'bat' | 'cmd'

/** 启动分组（左侧分组列表） */
export interface LauncherGroup {
  id: number
  name: string
  is_default: number
  created_at: number
  /** 该分组下启动项数量（列表查询附带） */
  count?: number
}

/** 启动项 */
export interface LauncherEntry {
  id: number
  name: string
  type: LauncherType
  /** 启动文件完整路径 */
  file_path: string
  /** 工作目录（文件所在目录） */
  dir_path: string
  group_id: number
  group_name?: string
  tags: string[]
  /** 默认以管理员身份启动 */
  run_as_admin: number
  /** lxicon 协议下的图标文件名 */
  icon_path: string | null
  sort_order: number
  last_run_at: number | null
  run_count: number
  created_at: number
  updated_at: number
}

/** 新建/编辑启动项的输入 */
export interface LauncherInput {
  name: string
  type: LauncherType
  file_path: string
  dir_path?: string
  group_id: number
  tags?: string[]
  run_as_admin?: boolean
}
