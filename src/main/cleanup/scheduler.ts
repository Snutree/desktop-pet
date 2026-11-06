/**
 * 历史自动清理调度器（阶段 6）
 *
 * 策略：
 *  - 应用启动时立即执行一次（清掉停机期间的过期记录）
 *  - 之后每小时检查一次（低成本：单条 DELETE + 少量文件删除）
 *  - 开关与天数读 settings：retention_enabled（默认开）/ retention_days（默认 7）
 *  - 收藏记录（is_favorite=1）始终受保护，不被清理
 */
import { getRetentionEnabled, getRetentionDays } from '../storage/settings'
import { clearClipsOlderThan } from '../storage/historyRepo'

/** 检查间隔：1 小时 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null

/** 立即执行一次过期清理，返回删除条数 */
export function runRetentionCleanup(): number {
  try {
    if (!getRetentionEnabled()) {
      console.log('[cleanup] 自动清理已关闭，跳过')
      return 0
    }
    const days = getRetentionDays()
    const n = clearClipsOlderThan(days)
    if (n > 0) {
      console.log(`[cleanup] 已清理 ${n} 条超过 ${days} 天的历史记录（收藏除外）`)
    }
    return n
  } catch (err) {
    console.error('[cleanup] 清理失败：', err)
    return 0
  }
}

/** 启动清理调度（app ready 后调用，幂等） */
export function startCleanupScheduler(): void {
  if (timer) return
  runRetentionCleanup()
  timer = setInterval(runRetentionCleanup, CHECK_INTERVAL_MS)
  console.log(`[cleanup] 自动清理已启动（保留 ${getRetentionDays()} 天 · 每小时检查）`)
}

/** 停止调度（will-quit 时调用） */
export function stopCleanupScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
