/**
 * Windows 系统通知（v1 闭环）
 *
 * 设计：
 *  - 只在新消息到达时调用；受设置 "panel.notify" 控制（false 关闭）
 *  - 同一来源 900ms 内合并为一条通知（如“新增 3 条消息”）
 *  - 控制板正在前台时不弹（角标已足够），点击通知直达消息中心
 *  - 轮询连接器的"首次拉取"由调用方标记 silent，历史线索不会被弹窗轰炸
 */
import { Notification } from 'electron'
import { getSetting } from '../storage/settings'
import { getPanelWindow, openPanel } from '../panel/panel-window'
import type { HubMessage } from '../../shared/datahub'
import { log } from '../log'

const AGGREGATE_MS = 900

interface Pending {
  count: number
  latest: HubMessage
  timer: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

/** 是否允许弹系统通知（设置里的"消息通知"开关，默认开启） */
export function notificationsEnabled(): boolean {
  return getSetting('panel.notify') !== 'false'
}

export function notifyNewMessage(msg: HubMessage): void {
  try {
    if (!notificationsEnabled()) return
    if (!Notification.isSupported()) return

    // 控制板正在前台：只用未读角标，不弹系统通知
    const panel = getPanelWindow()
    if (panel && panel.isVisible() && panel.isFocused()) return

    const prev = pending.get(msg.sourceId)
    if (prev) {
      prev.count += 1
      prev.latest = msg
      return
    }
    const timer = setTimeout(() => {
      const item = pending.get(msg.sourceId)
      pending.delete(msg.sourceId)
      if (item) show(item)
    }, AGGREGATE_MS)
    pending.set(msg.sourceId, { count: 1, latest: msg, timer })
  } catch (err) {
    log('error', '[notify] 发送通知失败：', err)
  }
}

function show(item: Pending): void {
  const { latest } = item
  const title = item.count > 1 ? `「${latest.sourceName}」新增 ${item.count} 条消息` : latest.title
  const body = item.count > 1 ? latest.title : latest.body || latest.sourceName
  const notification = new Notification({
    title: title.slice(0, 120),
    body: String(body).slice(0, 300),
    silent: false
  })
  notification.on('click', () => openPanel('messages'))
  notification.show()
}

/** 设置页"测试通知"按钮用 */
export function showTestNotification(): boolean {
  if (!Notification.isSupported()) return false
  const notification = new Notification({
    title: '灵犀 · 通知测试',
    body: '看到这条系统通知，说明消息提醒可以正常工作。'
  })
  notification.show()
  return true
}
