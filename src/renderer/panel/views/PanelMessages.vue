<script setup lang="ts">
/**
 * 消息中心：DataHub 收到的第三方消息（线索/系统/普通）
 *  - 与侧栏未读角标共用 messageStore（单一数据源，已读/清空即时同步）
 *  - 新消息由 PanelApp 订阅统一推入 store
 */
import { computed, onUnmounted, ref } from 'vue'
import type { HubMessageKind } from '../../../shared/datahub'
import type { TaskStatus } from '../../../shared/types'
import { messageStore } from '../message-store'
import TaskEditDialog from '../components/TaskEditDialog.vue'

const filter = ref<'all' | HubMessageKind>('all')
const toast = ref('')
let toastTimer: number | undefined

// 转任务
const showTaskDialog = ref(false)
const taskStatuses = ref<TaskStatus[]>([])
const taskPreset = ref<{ title?: string; description?: string; source_type?: 'client' | 'internal' | 'other'; source_detail?: string }>({})

const messages = messageStore.messages

const filtered = computed(() =>
  filter.value === 'all' ? messages.value : messages.value.filter((m) => m.kind === filter.value)
)

const KIND_LABEL: Record<HubMessageKind, string> = {
  lead: '线索',
  system: '系统',
  info: '通知'
}

function timeStr(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

async function markAll(): Promise<void> {
  await messageStore.markAllRead()
  showToast('已全部标记为已读')
}

async function clearAll(): Promise<void> {
  await messageStore.clearAll()
  showToast('已清空消息')
}

async function pushTest(): Promise<void> {
  await window.panelApi.pushTest()
  showToast('已发送测试消息（宠物也会冒泡）')
}

/** 将消息转成任务：预填内容并打开新建任务弹窗 */
async function toTask(m: { title: string; body: string; sourceName: string }): Promise<void> {
  try {
    if (taskStatuses.value.length === 0) {
      taskStatuses.value = await window.panelApi.listTaskStatuses()
    }
    taskPreset.value = {
      title: m.title,
      description: m.body || undefined,
      source_type: 'client',
      source_detail: m.sourceName
    }
    showTaskDialog.value = true
  } catch {
    showToast('任务功能暂不可用')
  }
}

async function onTaskSaved(): Promise<void> {
  showTaskDialog.value = false
  showToast('已创建任务，可在「任务追踪」中查看')
}

function showToast(t: string): void {
  toast.value = t
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2000)
}

onUnmounted(() => {
  window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="msg-page">
    <div class="toolbar">
      <div class="tabs">
        <button class="tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button class="tab" :class="{ active: filter === 'lead' }" @click="filter = 'lead'">线索</button>
        <button class="tab" :class="{ active: filter === 'system' }" @click="filter = 'system'">系统</button>
      </div>
      <div class="spacer"></div>
      <button class="act" @click="pushTest">发送测试消息</button>
      <button class="act" @click="markAll">全部已读</button>
      <button class="act danger" @click="clearAll">清空</button>
    </div>

    <div v-if="filtered.length === 0" class="empty">
      <div class="empty-icon">📭</div>
      <div>还没有消息</div>
      <div class="empty-sub">
        配置好 API 数据源后，官网表单等第三方推送会实时出现在这里，
        同时宠物也会弹出气泡提醒。
      </div>
    </div>

    <div v-else class="list">
      <div
        v-for="m in filtered"
        :key="m.id"
        class="msg"
        :class="{ unread: !m.read, lead: m.kind === 'lead' }"
        @click="messageStore.markRead(m)"
      >
        <div class="tag"></div>
        <div class="body">
          <div class="title">
            <span class="src">{{ m.sourceName }}</span>
            <span class="kind" :class="m.kind">{{ KIND_LABEL[m.kind] }}</span>
            <span v-if="m.kind === 'lead'" class="hot">高意向</span>
            <span v-if="!m.read" class="unread-dot"></span>
          </div>
          <div class="t">{{ m.title }}</div>
          <div v-if="m.body" class="d">{{ m.body }}</div>
          <div v-if="m.fields && m.fields.length" class="fields">
            <span v-for="(f, i) in m.fields" :key="i" class="field" :title="`${f.label}：${f.value}`">
              <b>{{ f.label }}</b>{{ f.value }}
            </span>
          </div>
          <div class="meta">{{ timeStr(m.createdAt) }}</div>
        </div>
        <button class="to-task" title="转为任务" @click.stop="toTask(m)">转任务</button>
      </div>
    </div>

    <TaskEditDialog
      :show="showTaskDialog"
      :task="null"
      :statuses="taskStatuses"
      :preset="taskPreset"
      @close="showTaskDialog = false"
      @saved="onTaskSaved"
    />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.msg-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px 22px;
  box-sizing: border-box;
  overflow: hidden;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.tabs {
  display: flex;
  background: #ecedf1;
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
}

.tab {
  border: none;
  background: transparent;
  padding: 5px 16px;
  border-radius: 7px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  color: #6b7280;
}

.tab.active {
  background: #fff;
  color: #1a1b1c;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.spacer {
  flex: 1;
}

.act {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 6px 13px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.act:hover {
  border-color: #ff9a3c;
}

.act.danger {
  color: #c0392b;
}

.list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.msg {
  display: flex;
  gap: 12px;
  background: #fff;
  border: 1px solid #ecedf1;
  border-radius: 11px;
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.msg:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.msg .tag {
  flex: 0 0 auto;
  width: 4px;
  border-radius: 2px;
  background: #c9c7c0;
}

.msg.lead .tag {
  background: #ea6668;
}

.msg .body {
  flex: 1;
  min-width: 0;
}

.msg .title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #9aa3b5;
}

.msg .src {
  font-weight: 600;
  color: #4b5563;
  font-size: 12.5px;
}

.kind {
  font-size: 10.5px;
  border-radius: 5px;
  padding: 1px 6px;
  font-weight: 600;
}

.kind.lead {
  background: rgba(234, 102, 104, 0.12);
  color: #c0392b;
}

.kind.system {
  background: rgba(139, 200, 234, 0.2);
  color: #1a5c7a;
}

.kind.info {
  background: rgba(0, 0, 0, 0.06);
  color: #6b7280;
}

.hot {
  font-size: 10.5px;
  background: rgba(234, 102, 104, 0.12);
  color: #c0392b;
  border-radius: 5px;
  padding: 1px 6px;
  font-weight: 600;
}

.unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ea6668;
  display: inline-block;
}

.msg .t {
  font-size: 13.5px;
  font-weight: 600;
  color: #1a1b1c;
  margin-top: 3px;
}

.msg .d {
  font-size: 12.5px;
  color: #4b5563;
  margin-top: 3px;
  line-height: 1.5;
}

.msg .meta {
  font-size: 11px;
  color: #b0b6c2;
  margin-top: 4px;
}

.msg .fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.msg .field {
  max-width: 100%;
  background: #f7f8fa;
  border: 1px solid #ecedf1;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11.5px;
  color: #4b5563;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg .field b {
  color: #9aa3b5;
  font-weight: 500;
  margin-right: 5px;
}

.to-task {
  flex: 0 0 auto;
  align-self: center;
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 7px;
  padding: 5px 11px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.msg:hover .to-task {
  opacity: 1;
}

.to-task:hover {
  border-color: #ff9a3c;
  color: #c2601a;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #9aa3b5;
  font-size: 14px;
  gap: 6px;
}

.empty-icon {
  font-size: 40px;
}

.empty-sub {
  font-size: 12px;
  color: #b0b6c2;
  max-width: 360px;
  text-align: center;
  line-height: 1.6;
}

.toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(26, 27, 28, 0.9);
  color: #fff;
  font-size: 13px;
  padding: 9px 20px;
  border-radius: 999px;
  z-index: 1000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
</style>
