/**
 * 开机自启（v1 闭环）
 *
 * - 默认关闭（settings.auto_start 缺省 = false），尊重用户选择：
 *   安装后第一次打开由控制板首启引导提示"可在设置中开启"，不自动写注册表。
 * - 只在打包版生效：开发模式不写 HKCU Run，避免把正式版的自启改成 electron.exe
 *   （PROJECT 已知问题 2）。
 */
import { app } from 'electron'
import { getSetting, setSetting } from '../storage/settings'

/** 应用启动时按设置应用开机自启状态，返回设置值（默认关闭） */
export function applyAutoStart(): boolean {
  const enabled = (getSetting('auto_start') ?? 'false') === 'true'
  if (!app.isPackaged) {
    console.log(`[main] 开机自启：设置=${enabled ? '开启' : '关闭'}（开发模式不写注册表，打包后生效）`)
    return enabled
  }
  app.setLoginItemSettings({ openAtLogin: enabled })
  console.log(`[main] 开机自启：${enabled ? '已开启' : '已关闭'}`)
  return enabled
}

/** 设置页切换：立即生效并落库（开发模式只保存设置，不碰注册表） */
export function setAutoStart(enabled: boolean): void {
  setSetting('auto_start', String(enabled))
  if (!app.isPackaged) {
    console.log(`[main] 开发模式：开机自启仅记录设置（${enabled ? '开' : '关'}），打包后生效`)
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled })
  console.log(`[main] 开机自启已${enabled ? '开启' : '关闭'}`)
}
