/**
 * 全局快捷键模块（阶段 7）
 *
 * 两个快捷键：
 *  - hotkey.screenshot（默认 Ctrl+Shift+S）：唤起截图
 *  - hotkey.panel（默认 Ctrl+Shift+V）：显示 / 隐藏主窗口
 *
 * 设计要点：
 *  - 注册失败的快捷键（被其他程序占用）输出警告，不阻断其他快捷键
 *  - updateHotkey：先试注册新键 → 成功才落库；失败恢复旧键并返回错误（设置页提示换键）
 *  - 自定义快捷键以 Electron accelerator 语法存储（如 CommandOrControl+Shift+A）
 */
import { globalShortcut } from 'electron'
import {
  getSetting,
  setSetting,
  DEFAULT_HOTKEY_SCREENSHOT,
  DEFAULT_HOTKEY_PANEL
} from '../storage/settings'

export type HotkeyKind = 'screenshot' | 'panel'

const KIND_SETTING_KEY: Record<HotkeyKind, string> = {
  screenshot: 'hotkey.screenshot',
  panel: 'hotkey.panel'
}

const DEFAULT_ACCELERATOR: Record<HotkeyKind, string> = {
  screenshot: DEFAULT_HOTKEY_SCREENSHOT,
  panel: DEFAULT_HOTKEY_PANEL
}

/** 当前已注册的快捷键（从设置读取，未设置用默认） */
export function getCurrentAccelerators(): Record<HotkeyKind, string> {
  return {
    screenshot: getSetting(KIND_SETTING_KEY.screenshot) ?? DEFAULT_ACCELERATOR.screenshot,
    panel: getSetting(KIND_SETTING_KEY.panel) ?? DEFAULT_ACCELERATOR.panel
  }
}

/** 业务回调（main/index.ts 注入） */
let handlers: Partial<Record<HotkeyKind, () => void>> = {}

/**
 * 注册全部快捷键（app ready 后调用）。
 * 每次调用先注销全部再按最新设置注册，幂等。
 */
export function registerGlobalHotkeys(opts: {
  onScreenshot: () => void
  onTogglePanel: () => void
}): void {
  handlers = { screenshot: opts.onScreenshot, panel: opts.onTogglePanel }
  unregisterGlobalHotkeys()

  const acc = getCurrentAccelerators()
  for (const kind of ['screenshot', 'panel'] as HotkeyKind[]) {
    const accelerator = acc[kind]
    const ok = globalShortcut.register(accelerator, () => handlers[kind]?.())
    if (ok) {
      console.log(`[hotkey] ${kind} 快捷键已注册：${accelerator}`)
    } else {
      console.warn(`[hotkey] ${kind} 快捷键 ${accelerator} 注册失败（可能已被其他程序占用）`)
    }
  }
}

/**
 * 更新某个快捷键（设置页调用）：
 * 1) 注销旧键 → 试注册新键
 * 2) 成功 → 写入设置并返回 { ok: true }
 * 3) 失败 → 恢复旧键并返回 { ok: false, error }
 */
export function updateHotkey(
  kind: HotkeyKind,
  accelerator: string
): { ok: boolean; error?: string } {
  if (!accelerator || !accelerator.trim()) {
    return { ok: false, error: '快捷键不能为空' }
  }
  const current = getCurrentAccelerators()
  if (current[kind] === accelerator) return { ok: true }

  const handler = () => handlers[kind]?.()
  globalShortcut.unregister(current[kind])
  const ok = globalShortcut.register(accelerator, handler)
  if (!ok) {
    // 新键被占用：恢复旧键
    globalShortcut.register(current[kind], handler)
    return { ok: false, error: '注册失败：该快捷键可能已被其他程序占用，请换一个组合键' }
  }
  setSetting(KIND_SETTING_KEY[kind], accelerator)
  console.log(`[hotkey] ${kind} 快捷键已更新：${current[kind]} → ${accelerator}`)
  return { ok: true }
}

/** 注销全部全局快捷键（will-quit 时调用） */
export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll()
}
