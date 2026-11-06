<script setup lang="ts">
/**
 * 任务追踪：记录需求并更新进度
 *  - 列表按更新时间分组（今天/昨天/更早），状态/优先级/关键词筛选
 *  - 顶部统计卡随自定义状态动态变化，点击可筛选
 *  - 进度弹窗：状态快捷切换 + 备注时间线
 *  - 状态管理：自定义状态的增删改/排序
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { TaskRecord, TaskProgressLog, TaskStatus } from '../../../shared/types'
import TaskEditDialog from '../components/TaskEditDialog.vue'

const tasks = ref<TaskRecord[]>([])
const statuses = ref<TaskStatus[]>([])
const search = ref('')
const filterStatus = ref<number | null>(null)
const filterPriority = ref<'all' | 'high' | 'medium' | 'low'>('all')
const toast = ref('')
let toastTimer: number | undefined

// 编辑弹窗
const showEdit = ref(false)
const editTask = ref<TaskRecord | null>(null)

// 进度弹窗
const showProgress = ref(false)
const progressTask = ref<TaskRecord | null>(null)
const progressLogs = ref<TaskProgressLog[]>([])
const noteInput = ref('')

// 状态管理弹窗
const showStatusMgr = ref(false)

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' }

async function refresh(): Promise<void> {
  try {
    const [ts, st] = await Promise.all([window.panelApi.listTasks(), window.panelApi.listTaskStatuses()])
    tasks.value = ts
    statuses.value = st
    // 状态被删时清除失效筛选
    if (filterStatus.value !== null && !st.some((s) => s.id === filterStatus.value)) {
      filterStatus.value = null
    }
  } catch {
    // API 不可用
  }
}

// ── 统计与筛选 ────────────────────────────────────────────
function countOf(statusId: number): number {
  return tasks.value.filter((t) => t.status_id === statusId).length
}

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return tasks.value.filter((t) => {
    if (filterStatus.value !== null && t.status_id !== filterStatus.value) return false
    if (filterPriority.value !== 'all' && t.priority !== filterPriority.value) return false
    if (kw) {
      const hay = `${t.title} ${t.description ?? ''} ${t.category ?? ''} ${t.source_detail ?? ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
})

const groups = computed(() => {
  const map = new Map<string, TaskRecord[]>()
  for (const t of filtered.value) {
    const k = dayKey(t.updated_at)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(t)
  }
  return Array.from(map.entries())
})

function dayKey(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.floor((start(now) - start(d)) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function timeStr(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dueStr(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ── 任务操作 ──────────────────────────────────────────────
function openCreate(): void {
  editTask.value = null
  showEdit.value = true
}

function openEdit(t: TaskRecord): void {
  editTask.value = t
  showEdit.value = true
}

async function onSaved(): Promise<void> {
  showEdit.value = false
  await refresh()
  showToast('已保存')
}

async function removeTask(t: TaskRecord): Promise<void> {
  if (!window.confirm(`确定删除任务「${t.title}」？进度记录将一并删除。`)) return
  await window.panelApi.deleteTask(t.id)
  await refresh()
  showToast('已删除')
}

// ── 进度 ──────────────────────────────────────────────────
async function openProgress(t: TaskRecord): Promise<void> {
  progressTask.value = t
  noteInput.value = ''
  progressLogs.value = await window.panelApi.listTaskLogs(t.id)
  showProgress.value = true
}

async function switchStatus(statusId: number): Promise<void> {
  if (!progressTask.value || progressTask.value.status_id === statusId) return
  const note = noteInput.value.trim()
  const updated = await window.panelApi.setTaskStatus(progressTask.value.id, statusId, note || undefined)
  noteInput.value = ''
  if (updated) {
    progressTask.value = updated
    progressLogs.value = await window.panelApi.listTaskLogs(updated.id)
    await refresh()
    showToast(`已切换为「${updated.status_name}」`)
  }
}

async function addNote(): Promise<void> {
  if (!progressTask.value || !noteInput.value.trim()) return
  await window.panelApi.addTaskLog(progressTask.value.id, noteInput.value.trim())
  noteInput.value = ''
  progressLogs.value = await window.panelApi.listTaskLogs(progressTask.value.id)
  await refresh()
  showToast('已记录进度')
}

function logText(l: TaskProgressLog): string {
  if (l.note) return l.note
  if (l.status_name) return `状态变更为「${l.status_name}」`
  return ''
}

// ── 状态管理 ──────────────────────────────────────────────
const newStatusName = ref('')
const newStatusColor = ref('#8a94a6')

async function addStatus(): Promise<void> {
  if (!newStatusName.value.trim()) return
  const res = await window.panelApi.addTaskStatus(newStatusName.value.trim(), newStatusColor.value)
  if (!res.ok) {
    showToast(res.error ?? '添加失败')
    return
  }
  newStatusName.value = ''
  newStatusColor.value = '#8a94a6'
  await refresh()
  showToast('已添加状态')
}

async function renameStatus(s: TaskStatus, e: Event): Promise<void> {
  const name = (e.target as HTMLInputElement).value.trim()
  if (!name || name === s.name) return
  const res = await window.panelApi.updateTaskStatus(s.id, { name })
  if (!res.ok) showToast(res.error ?? '改名失败')
  await refresh()
}

async function colorStatus(s: TaskStatus, e: Event): Promise<void> {
  const color = (e.target as HTMLInputElement).value
  await window.panelApi.updateTaskStatus(s.id, { color })
}

async function moveStatus(s: TaskStatus, dir: -1 | 1): Promise<void> {
  const sorted = [...statuses.value].sort((a, b) => a.sort_order - b.sort_order)
  const idx = sorted.findIndex((x) => x.id === s.id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= sorted.length) return
  const other = sorted[target]
  await window.panelApi.updateTaskStatus(s.id, { sort_order: other.sort_order })
  await window.panelApi.updateTaskStatus(other.id, { sort_order: s.sort_order })
  await refresh()
}

async function removeStatus(s: TaskStatus): Promise<void> {
  const res = await window.panelApi.removeTaskStatus(s.id)
  if (!res.ok) {
    showToast(res.error ?? '删除失败')
    return
  }
  await refresh()
  showToast('已删除状态')
}

// ── 通用 ──────────────────────────────────────────────────
function showToast(t: string): void {
  toast.value = t
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2200)
}

onMounted(() => void refresh())
onUnmounted(() => window.clearTimeout(toastTimer))
</script>

<template>
  <div class="task-page">
    <!-- 统计卡 -->
    <div class="stats">
      <button
        class="stat"
        :class="{ active: filterStatus === null }"
        @click="filterStatus = null"
      >
        <span class="dot" style="background: #9aa3b5"></span>
        <span class="name">全部</span>
        <span class="num">{{ tasks.length }}</span>
      </button>
      <button
        v-for="s in statuses"
        :key="s.id"
        class="stat"
        :class="{ active: filterStatus === s.id }"
        @click="filterStatus = filterStatus === s.id ? null : s.id"
      >
        <span class="dot" :style="{ background: s.color }"></span>
        <span class="name">{{ s.name }}</span>
        <span class="num">{{ countOf(s.id) }}</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <input v-model="search" class="search" placeholder="搜索标题 / 描述 / 分类…" />
      <select v-model="filterPriority" class="fsel">
        <option value="all">全部优先级</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <div class="spacer"></div>
      <button class="act" @click="showStatusMgr = true">管理状态</button>
      <button class="add" @click="openCreate">＋ 新建任务</button>
    </div>

    <!-- 列表 -->
    <div v-if="groups.length === 0" class="empty">
      <div class="empty-icon">📋</div>
      <div>还没有任务</div>
      <div class="empty-sub">点击"新建任务"记录第一条需求</div>
    </div>

    <div v-else class="list">
      <template v-for="[day, items] in groups" :key="day">
        <div class="day-head">{{ day }}</div>
        <div v-for="t in items" :key="t.id" class="task" @dblclick="openEdit(t)">
          <div class="bar" :style="{ background: t.status_color }"></div>
          <div class="body">
            <div class="row1">
              <span class="title">{{ t.title }}</span>
              <span class="prio" :class="t.priority">{{ PRIORITY_LABEL[t.priority] }}</span>
              <span v-if="t.category" class="cat">{{ t.category }}</span>
              <span v-if="t.source_type === 'client'" class="src">客户 · {{ t.source_detail || '—' }}</span>
              <span v-else-if="t.source_detail" class="src">{{ t.source_detail }}</span>
              <span v-if="t.due_date" class="due" :class="{ late: t.due_date < Date.now() && t.status_name !== '已完成' }">
                ⏰ {{ dueStr(t.due_date) }}
              </span>
            </div>
            <div v-if="t.description" class="desc">{{ t.description }}</div>
            <div v-if="t.link" class="link">{{ t.link }}</div>
            <div class="meta">
              <span class="st" :style="{ color: t.status_color }">● {{ t.status_name }}</span>
              <span>{{ timeStr(t.updated_at) }}</span>
            </div>
          </div>
          <div class="ops">
            <button class="op" title="更新进度" @click="openProgress(t)">进度</button>
            <button class="op" title="编辑" @click="openEdit(t)">编辑</button>
            <button class="op danger" title="删除" @click="removeTask(t)">✕</button>
          </div>
        </div>
      </template>
    </div>

    <!-- 编辑弹窗 -->
    <TaskEditDialog
      :show="showEdit"
      :task="editTask"
      :statuses="statuses"
      @close="showEdit = false"
      @saved="onSaved"
    />

    <!-- 进度弹窗 -->
    <div v-if="showProgress && progressTask" class="mask" @click.self="showProgress = false">
      <div class="dialog">
        <div class="head">
          <span class="t">更新进度 · {{ progressTask.title }}</span>
          <button class="x" @click="showProgress = false">✕</button>
        </div>

        <div class="status-row">
          <button
            v-for="s in statuses"
            :key="s.id"
            class="chip"
            :class="{ active: progressTask.status_id === s.id }"
            :style="progressTask.status_id === s.id ? { background: s.color, borderColor: s.color } : {}"
            @click="switchStatus(s.id)"
          >
            {{ s.name }}
          </button>
        </div>

        <div class="note-box">
          <input v-model="noteInput" placeholder="记录一条进度（可选，切换状态时自动带上）" @keyup.enter="addNote" />
          <button class="save" @click="addNote">记录</button>
        </div>

        <div class="logs">
          <div v-if="progressLogs.length === 0" class="no-log">还没有进度记录</div>
          <div v-for="l in progressLogs" :key="l.id" class="log">
            <span class="dot" :style="{ background: l.status_color ?? '#d9dbe3' }"></span>
            <div class="txt">{{ logText(l) }}</div>
            <div class="time">{{ dayKey(l.created_at) }} {{ timeStr(l.created_at) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 状态管理弹窗 -->
    <div v-if="showStatusMgr" class="mask" @click.self="showStatusMgr = false">
      <div class="dialog sm">
        <div class="head">
          <span class="t">状态管理</span>
          <button class="x" @click="showStatusMgr = false">✕</button>
        </div>
        <div class="sm-list">
          <div v-for="(s, i) in [...statuses].sort((a, b) => a.sort_order - b.sort_order)" :key="s.id" class="sm-row">
            <input type="color" :value="s.color" class="color" @change="colorStatus(s, $event)" />
            <input :value="s.name" class="name-input" @change="renameStatus(s, $event)" />
            <button class="mv" title="上移" :disabled="i === 0" @click="moveStatus(s, -1)">↑</button>
            <button class="mv" title="下移" :disabled="i === statuses.length - 1" @click="moveStatus(s, 1)">↓</button>
            <button class="del" title="删除" @click="removeStatus(s)">✕</button>
          </div>
        </div>
        <div class="sm-add">
          <input v-model="newStatusName" placeholder="新状态名称" @keyup.enter="addStatus" />
          <input v-model="newStatusColor" type="color" class="color" />
          <button class="save" @click="addStatus">添加</button>
        </div>
        <div class="tip">删除状态后，其下任务自动归入第一个状态</div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.task-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px 22px;
  box-sizing: border-box;
  overflow: hidden;
}

/* ── 统计卡 ── */
.stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.stat {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #ecedf1;
  background: #fff;
  border-radius: 10px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  color: #4b5563;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat.active {
  border-color: #ff9a3c;
  box-shadow: 0 0 0 2px rgba(255, 154, 60, 0.15);
}
.stat .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.stat .name {
  font-weight: 600;
}
.stat .num {
  background: #f2f3f7;
  border-radius: 8px;
  padding: 1px 8px;
  font-size: 11.5px;
  color: #6b7280;
}

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex: 0 0 auto;
}
.search {
  flex: 1;
  max-width: 300px;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  background: #fff;
}
.search:focus {
  border-color: #ff9a3c;
}
.fsel {
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-family: inherit;
  background: #fff;
  color: #4b5563;
  outline: none;
}
.spacer {
  flex: 1;
}
.act {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 7px 13px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.act:hover {
  border-color: #ff9a3c;
}
.add {
  border: none;
  background: #ff9a3c;
  color: #fff;
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 12.5px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.add:hover {
  filter: brightness(1.06);
}

/* ── 列表 ── */
.list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.day-head {
  font-size: 11.5px;
  color: #9aa3b5;
  padding: 10px 2px 6px;
  font-weight: 600;
}
.task {
  display: flex;
  gap: 12px;
  background: #fff;
  border: 1px solid #ecedf1;
  border-radius: 11px;
  padding: 11px 14px;
  margin-bottom: 8px;
  transition: box-shadow 0.15s;
}
.task:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.task .bar {
  flex: 0 0 auto;
  width: 4px;
  border-radius: 2px;
}
.task .body {
  flex: 1;
  min-width: 0;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1a1b1c;
}
.prio {
  font-size: 10.5px;
  border-radius: 5px;
  padding: 1px 6px;
  font-weight: 600;
}
.prio.high {
  background: rgba(234, 102, 104, 0.12);
  color: #c0392b;
}
.prio.medium {
  background: rgba(255, 154, 60, 0.15);
  color: #c2601a;
}
.prio.low {
  background: rgba(139, 200, 234, 0.2);
  color: #1a5c7a;
}
.cat {
  font-size: 10.5px;
  background: rgba(0, 0, 0, 0.05);
  color: #6b7280;
  border-radius: 5px;
  padding: 1px 6px;
}
.src {
  font-size: 11px;
  color: #9aa3b5;
}
.due {
  font-size: 11px;
  color: #4b5563;
}
.due.late {
  color: #c0392b;
  font-weight: 600;
}
.desc {
  font-size: 12.5px;
  color: #4b5563;
  margin-top: 3px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.link {
  font-size: 11px;
  color: #1a5c7a;
  margin-top: 3px;
  word-break: break-all;
  font-family: Consolas, monospace;
}
.meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: #b0b6c2;
  margin-top: 5px;
}
.meta .st {
  font-weight: 600;
}
.ops {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.op {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.task:hover .op {
  opacity: 1;
}
.op:hover {
  border-color: #ff9a3c;
}
.op.danger {
  color: #b0b6c2;
  padding: 4px 8px;
}
.op.danger:hover {
  color: #ea6668;
  border-color: #ea6668;
}

/* ── 空态 ── */
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
}

/* ── 弹窗通用 ── */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.dialog {
  width: 560px;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.dialog.sm {
  width: 460px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.head .t {
  font-size: 15px;
  font-weight: 600;
}
.head .x {
  border: none;
  background: transparent;
  color: #b0b6c2;
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
}
.head .x:hover {
  color: #ea6668;
}

/* ── 进度弹窗 ── */
.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.chip {
  border: 1.5px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 999px;
  padding: 6px 16px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.chip:hover {
  border-color: #ff9a3c;
}
.chip.active {
  color: #fff;
  font-weight: 600;
}
.note-box {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.note-box input {
  flex: 1;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.note-box input:focus {
  border-color: #ff9a3c;
}
.save {
  border: none;
  background: #ff9a3c;
  color: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12.5px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.save:hover {
  filter: brightness(1.06);
}
.logs {
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid #ecedf1;
  padding-top: 10px;
}
.no-log {
  font-size: 12px;
  color: #b0b6c2;
  padding: 10px 0;
  text-align: center;
}
.log {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 2px;
}
.log .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex: 0 0 auto;
}
.log .txt {
  flex: 1;
  font-size: 12.5px;
  color: #1a1b1c;
  line-height: 1.5;
}
.log .time {
  font-size: 11px;
  color: #b0b6c2;
  flex: 0 0 auto;
}

/* ── 状态管理 ── */
.sm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.sm-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color {
  width: 30px;
  height: 28px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.name-input {
  flex: 1;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.name-input:focus {
  border-color: #ff9a3c;
}
.mv {
  border: 1px solid #d9dbe3;
  background: #fff;
  border-radius: 7px;
  width: 28px;
  height: 28px;
  font-size: 12px;
  cursor: pointer;
  color: #4b5563;
}
.mv:disabled {
  opacity: 0.35;
  cursor: default;
}
.del {
  border: none;
  background: transparent;
  color: #b0b6c2;
  font-size: 13px;
  cursor: pointer;
  width: 28px;
  height: 28px;
}
.del:hover {
  color: #ea6668;
}
.sm-add {
  display: flex;
  gap: 8px;
  align-items: center;
}
.sm-add input[type='text'] {
  flex: 1;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.sm-add input:focus {
  border-color: #ff9a3c;
}
.tip {
  font-size: 11px;
  color: #b0b6c2;
  margin-top: 10px;
}

/* ── toast ── */
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
