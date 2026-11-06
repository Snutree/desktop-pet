/**
 * 设置数据访问层（阶段 6）
 *
 * settings 表为通用键值存储（value 存 JSON 字符串，便于扩展类型）。
 * 默认值集中在 DEFAULT_SETTINGS，读取时未命中默认值则返回默认。
 */
import { getDb } from './db'
import type { AppSettings } from '../../shared/types'

export const DEFAULT_SETTINGS = {
  /** 历史保留天数（自动清理） */
  retention_days: 7,
  /** 自动清理开关 */
  retention_enabled: true
} as const

/** 读取原始值（JSON 字符串） */
export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

/** 写入原始值 */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, Date.now())
}

/** 类型化读取：保留天数（默认 7） */
export function getRetentionDays(): number {
  const raw = getSetting('retention_days')
  if (raw == null) return DEFAULT_SETTINGS.retention_days
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_SETTINGS.retention_days
}

/** 类型化读取：自动清理开关（默认开） */
export function getRetentionEnabled(): boolean {
  const raw = getSetting('retention_enabled')
  if (raw == null) return DEFAULT_SETTINGS.retention_enabled
  return raw === 'true'
}

/** 类型化写入 */
export function setRetentionDays(days: number): void {
  setSetting('retention_days', String(Math.max(1, Math.floor(days))))
}

export function setRetentionEnabled(enabled: boolean): void {
  setSetting('retention_enabled', String(enabled))
}

// ── 阶段 7：设置页相关 ───────────────────────────────────

/** 默认快捷键（与 hotkeys 模块保持一致） */
export const DEFAULT_HOTKEY_SCREENSHOT = 'CommandOrControl+Shift+S'
export const DEFAULT_HOTKEY_PANEL = 'CommandOrControl+Shift+V'

export function getAllSettings(): AppSettings {
  return {
    theme: getSetting('theme') === 'dark' ? 'dark' : 'light',
    retention_days: getRetentionDays(),
    retention_enabled: getRetentionEnabled(),
    screenshot_dir: getSetting('screenshot_dir') ?? '',
    auto_start: (getSetting('auto_start') ?? 'false') === 'true',
    hotkey_screenshot: getSetting('hotkey.screenshot') ?? DEFAULT_HOTKEY_SCREENSHOT,
    hotkey_panel: getSetting('hotkey.panel') ?? DEFAULT_HOTKEY_PANEL,
    export_format: getSetting('export_format') === 'pdf' ? 'pdf' : 'html'
  }
}
