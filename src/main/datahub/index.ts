/**
 * DataHub 编排：初始化存储 + Webhook 服务 + 控制板 IPC 注册
 *
 * v1 闭环要点：
 *  - 收到消息 → 入库 → 广播控制板 → 系统通知 → 宠物气泡 → 刷新托盘未读数
 *  - Webhook 服务状态变化（启动/端口被占）实时广播给界面
 */
import { ipcMain } from 'electron'
import { IpcChannels, type PetBubblePayload } from '../../shared/ipc'
import { WEBHOOK_PORT, startWebhookServer, stopWebhookServer, isServerRunning } from './server'
import * as store from './store'
import { restartPollers, initSeen, stopPollers } from './poller'
import { broadcastToRenderers } from '../ipc'
import { getPetWindow } from '../pet-window'
import { notifyNewMessage } from '../notify/desktop'
import { setUnreadCount } from '../tray'

export function initDataHub(): boolean {
  store.loadStore()
  initSeen(store.listSeenKeys())
  const ok = startWebhookServer(
    (m) => onMessage(m),
    (id) => store.getConnector(id),
    (running) => broadcastStatus(running)
  )
  restartPollers(onMessage)
  registerPanelIpc()
  setUnreadCount(store.getUnreadCount())
  console.log(`[datahub] 已启动 · Webhook 端口 ${WEBHOOK_PORT} · 连接器 ${store.listConnectors().length} 个`)
  return ok
}

export function disposeDataHub(): void {
  stopWebhookServer()
  stopPollers()
}

/** 收到第三方消息 → 入库 + 广播控制板 + 系统通知 + 宠物气泡；返回是否真正入库（去重拦截返回 false） */
function onMessage(
  m: Parameters<typeof store.pushMessage>[0],
  opts: { silent?: boolean } = {}
): boolean {
  const msg = store.pushMessage(m)
  if (!msg) return false
  broadcastToRenderers('panel:message:new', msg)
  setUnreadCount(store.getUnreadCount())

  if (!opts.silent) {
    // 系统通知（尊重设置里的消息通知开关）
    notifyNewMessage(msg)

    const pet = getPetWindow()
    if (pet && !pet.isDestroyed()) {
      const payload: PetBubblePayload = {
        text: `${msg.title}${msg.body ? ` · ${msg.body}` : ''}`,
        durationMs: 5000
      }
      pet.webContents.send(IpcChannels.PetShowBubble, payload)
    }
  }
  return true
}

function broadcastStatus(running: boolean): void {
  broadcastToRenderers('panel:status:changed', { port: WEBHOOK_PORT, running })
}

function registerPanelIpc(): void {
  ipcMain.handle('panel:getStatus', () => ({
    port: WEBHOOK_PORT,
    running: isServerRunning()
  }))

  // ── 连接器 ──
  ipcMain.handle('panel:connectors:list', () => store.listConnectors())
  ipcMain.handle('panel:connectors:add', (_e, data) => {
    try {
      const conn = store.addConnector(data)
      broadcastToRenderers('panel:connectors:changed', null)
      restartPollers(onMessage)
      return { ok: true, data: conn }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle('panel:connectors:update', (_e, id, patch) => {
    const ok = store.updateConnector(id, patch)
    if (ok) {
      broadcastToRenderers('panel:connectors:changed', null)
      restartPollers(onMessage)
    }
    return { ok }
  })
  ipcMain.handle('panel:connectors:delete', (_e, id) => {
    const ok = store.deleteConnector(id)
    if (ok) {
      broadcastToRenderers('panel:connectors:changed', null)
      restartPollers(onMessage)
    }
    return { ok }
  })

  // ── 消息 ──
  ipcMain.handle('panel:messages:list', () => store.listMessages())
  ipcMain.handle('panel:messages:markRead', (_e, id) => {
    const ok = store.markRead(id)
    setUnreadCount(store.getUnreadCount())
    return { ok }
  })
  ipcMain.handle('panel:messages:markAllRead', () => {
    const ok = store.markAllRead()
    setUnreadCount(store.getUnreadCount())
    return { ok }
  })
  ipcMain.handle('panel:messages:clear', () => {
    const ok = store.clearMessages()
    setUnreadCount(store.getUnreadCount())
    return { ok }
  })
  // 本地测试推送：覆盖"任意 JSON 自动整理"链路
  ipcMain.handle('panel:messages:pushTest', () => {
    onMessage({
      sourceId: 'local-test',
      sourceName: '本地测试',
      kind: 'lead',
      title: '测试消息 · 消息链路正常',
      body: '这条消息来自本地测试推送，验证 官网表单 → 桌宠 → 控制板 的完整链路。',
      dedupKey: `test:${Date.now()}`,
      fields: [
        { label: '来源', value: '本地测试' },
        { label: '链路', value: 'Webhook / 轮询 → 入库 → 通知 → 宠物气泡' }
      ]
    })
    return { ok: true }
  })
}
