/**
 * 启动中心执行器（v1.1）
 *
 * 行为与资源管理器双击一致：
 *  - 工作目录 = 启动文件所在目录
 *  - BAT/CMD 显示控制台窗口（不隐藏）
 *  - 勾选了"默认以管理员启动"或本次强制管理员时，走 PowerShell Start-Process -Verb RunAs（触发 UAC）
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import type { LauncherEntry } from '../../shared/types'

export interface LauncherRunResult {
  ok: boolean
  error?: string
}

/** 等待子进程真正启动（spawn）或立即失败（error）；最长等 3 秒 */
function waitSpawn(child: ChildProcess): Promise<LauncherRunResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: LauncherRunResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.once('spawn', () => finish({ ok: true }))
    child.once('error', (err) => finish({ ok: false, error: err.message || String(err) }))
    setTimeout(() => finish({ ok: true }), 3000)
  })
}

/** PowerShell 单引号字符串转义 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** 通过 -EncodedCommand 传脚本，避免路径/参数引号转义问题 */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export async function runLauncherEntry(
  entry: LauncherEntry,
  forceAdmin = false
): Promise<LauncherRunResult> {
  if (!fs.existsSync(entry.file_path)) {
    return { ok: false, error: '目标文件不存在（可能已被移动或删除）' }
  }

  const asAdmin = forceAdmin || entry.run_as_admin === 1
  if (asAdmin) {
    const script =
      `$ErrorActionPreference='Stop'; ` +
      `Start-Process -FilePath ${psQuote(entry.file_path)} ` +
      `-WorkingDirectory ${psQuote(entry.dir_path)} -Verb RunAs`
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
      { windowsHide: true, stdio: 'ignore', detached: true }
    )
    child.unref()
    return waitSpawn(child)
  }

  if (entry.type === 'exe') {
    const child = spawn(entry.file_path, [], {
      cwd: entry.dir_path,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
    return waitSpawn(child)
  }

  // .bat / .cmd：通过 cmd.exe 执行，保留控制台窗口（等同双击）
  const comspec = process.env.ComSpec || 'cmd.exe'
  const child = spawn(comspec, ['/d', '/s', '/c', entry.file_path], {
    cwd: entry.dir_path,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return waitSpawn(child)
}
