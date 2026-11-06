/**
 * 主进程日志（v1 闭环）
 *
 * 目标：线上/现场问题不再只能看 dev 控制台。
 *  - 初始化后在 userData/logs/main.log 落盘（超过 2MB 轮转为 main.1.log）
 *  - 包一层 console.log/warn/error，既有日志自动进文件
 *  - 全局未捕获异常/未处理 Promise 拒绝统一记录
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let logFile: string | null = null
const MAX_LOG_BYTES = 2 * 1024 * 1024

function ts(): string {
  return new Date().toISOString()
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function append(line: string): void {
  if (!logFile) return
  try {
    fs.appendFileSync(logFile, `${line}\n`)
  } catch {
    /* 日志失败不影响运行 */
  }
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file)
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(path.dirname(file), 'main.1.log'))
    }
  } catch {
    /* 文件不存在/轮转失败都忽略 */
  }
}

/** 初始化日志（在 userData 确定后尽早调用） */
export function initLogger(): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'main.log')
    rotateIfNeeded(file)
    logFile = file

    const original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }
    const levels = ['log', 'warn', 'error'] as const
    for (const level of levels) {
      console[level] = (...args: unknown[]): void => {
        original[level](...args)
        append(`[${ts()}][${level}] ${args.map(formatArg).join(' ')}`)
      }
    }
    append(`[${ts()}][log] ===== 灵犀启动 v${app.getVersion()} · packaged=${app.isPackaged} =====`)
  } catch {
    /* 日志初始化失败不影响运行 */
  }
}

/** 写一条日志（同时进控制台与文件） */
export function log(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
  console[level](...args)
}

export function getLogPath(): string {
  return logFile ?? ''
}

/** 全局异常兜底：记录日志，避免静默退出 */
export function installGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    append(`[${ts()}][uncaughtException] ${formatArg(err)}`)
    console.error('[main] 未捕获异常：', err)
  })
  process.on('unhandledRejection', (reason) => {
    append(`[${ts()}][unhandledRejection] ${formatArg(reason)}`)
    console.error('[main] 未处理的 Promise 拒绝：', reason)
  })
}
