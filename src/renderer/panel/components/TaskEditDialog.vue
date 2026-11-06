<script setup lang="ts">
/**
 * 任务编辑弹窗（新建/编辑通用，消息中心"转任务"也复用）
 *  - props.task 为空 = 新建；非空 = 编辑
 *  - 保存成功 emit('saved', task)
 */
import { ref, watch } from 'vue'
import type { TaskRecord, TaskStatus } from '../../../shared/types'

const props = defineProps<{
  show: boolean
  task: TaskRecord | null
  statuses: TaskStatus[]
  /** 预填内容（无 task 时生效，用于消息中心"转任务"等场景） */
  preset?: {
    title?: string
    description?: string
    source_type?: 'client' | 'internal' | 'other'
    source_detail?: string
  }
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', task: TaskRecord): void
}>()

const title = ref('')
const description = ref('')
const sourceType = ref<'client' | 'internal' | 'other'>('internal')
const sourceDetail = ref('')
const priority = ref<'high' | 'medium' | 'low'>('medium')
const category = ref('')
const link = ref('')
const dueDate = ref('')
const statusId = ref(0)
const saving = ref(false)
const error = ref('')

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}
function parseDate(s: string): number | null {
  if (!s) return null
  const d = new Date(`${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    error.value = ''
    const t = props.task
    const p = props.preset
    title.value = t?.title ?? p?.title ?? ''
    description.value = t?.description ?? p?.description ?? ''
    sourceType.value = t?.source_type ?? p?.source_type ?? 'internal'
    sourceDetail.value = t?.source_detail ?? p?.source_detail ?? ''
    priority.value = t?.priority ?? 'medium'
    category.value = t?.category ?? ''
    link.value = t?.link ?? ''
    dueDate.value = t?.due_date ? fmtDate(t.due_date) : ''
    statusId.value = t?.status_id ?? props.statuses[0]?.id ?? 0
  }
)

async function save(): Promise<void> {
  if (!title.value.trim()) {
    error.value = '请填写任务标题'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = {
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      source_type: sourceType.value,
      source_detail: sourceDetail.value.trim() || undefined,
      priority: priority.value,
      category: category.value.trim() || undefined,
      link: link.value.trim() || undefined,
      due_date: parseDate(dueDate.value),
      status_id: statusId.value || undefined
    }
    const res = props.task
      ? await window.panelApi.updateTask(props.task.id, payload)
      : await window.panelApi.createTask(payload)
    if (res) emit('saved', res)
    else error.value = '保存失败'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="show" class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span class="t">{{ task ? '编辑任务' : '新建任务' }}</span>
        <button class="x" @click="emit('close')">✕</button>
      </div>
      <div class="form">
        <label class="field full">
          <span class="label">标题 *</span>
          <input v-model="title" placeholder="一句话描述这个任务" />
        </label>
        <label class="field full">
          <span class="label">详细描述</span>
          <textarea v-model="description" rows="3" placeholder="需求细节、验收要点…"></textarea>
        </label>
        <div class="row2">
          <label class="field">
            <span class="label">来源</span>
            <select v-model="sourceType">
              <option value="client">客户</option>
              <option value="internal">内部</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label class="field">
            <span class="label">来源人 / 渠道</span>
            <input v-model="sourceDetail" placeholder="如：张总 / 官网表单" />
          </label>
        </div>
        <div class="row2">
          <label class="field">
            <span class="label">优先级</span>
            <select v-model="priority">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label class="field">
            <span class="label">分类</span>
            <input v-model="category" placeholder="如：官网 / 小程序" />
          </label>
        </div>
        <div class="row2">
          <label class="field">
            <span class="label">关联链接</span>
            <input v-model="link" placeholder="https://…" />
          </label>
          <label class="field">
            <span class="label">期望完成</span>
            <input v-model="dueDate" type="date" />
          </label>
        </div>
        <label class="field full">
          <span class="label">状态</span>
          <select v-model="statusId">
            <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="btns">
          <button class="cancel" @click="emit('close')">取消</button>
          <button class="save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  width: 520px;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
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
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.field.full {
  width: 100%;
}
.field .label {
  font-size: 11.5px;
  color: #6b7280;
}
.field input,
.field select,
.field textarea {
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  color: #1a1b1c;
  background: #fff;
  width: 100%;
  box-sizing: border-box;
}
.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: #ff9a3c;
}
.field textarea {
  resize: vertical;
  min-height: 60px;
}
.row2 {
  display: flex;
  gap: 10px;
}
.error {
  font-size: 12px;
  color: #c0392b;
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}
.cancel {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.save {
  border: none;
  background: #ff9a3c;
  color: #fff;
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 12.5px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.save:hover {
  filter: brightness(1.06);
}
.save:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
