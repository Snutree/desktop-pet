/**
 * 消息中心共享 store（renderer 内单一数据源）
 *
 * 侧栏未读角标与消息中心页面必须看到同一份消息数据，
 * 否则在页面里已读/清空后角标不会同步刷新。
 * 这里用模块级 reactive 单例，两个组件 import 同一引用。
 */
import { computed, ref } from 'vue'
import type { HubMessage } from '../../shared/datahub'

const messages = ref<HubMessage[]>([])

const unreadCount = computed(() => messages.value.filter((m) => !m.read).length)

async function refresh(): Promise<void> {
  try {
    messages.value = await window.panelApi.listMessages()
  } catch {
    // API 不可用时保持现状
  }
}

async function markRead(m: HubMessage): Promise<void> {
  if (m.read) return
  m.read = true
  try {
    await window.panelApi.markRead(m.id)
  } catch {
    // 忽略
  }
}

async function markAllRead(): Promise<void> {
  try {
    await window.panelApi.markAllRead()
  } catch {
    // 忽略
  }
  messages.value.forEach((m) => {
    m.read = true
  })
}

async function clearAll(): Promise<void> {
  try {
    await window.panelApi.clearMessages()
  } catch {
    // 忽略
  }
  messages.value = []
}

function onMessageNew(msg: HubMessage): void {
  messages.value.unshift(msg)
}

export const messageStore = {
  messages,
  unreadCount,
  refresh,
  markRead,
  markAllRead,
  clearAll,
  onMessageNew
}
