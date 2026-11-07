<script setup lang="ts">
/**
 * 新增 / 编辑条目弹窗
 *  - 保存：新增或更新（主进程自动加密落盘）
 *  - 删除（仅编辑态）
 *  - 监听 vault:fill-password 事件（生成器生成后自动填入密码）
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { VaultEntry } from '../env.d'
import CategorySelect from '../../components/CategorySelect.vue'

const props = defineProps<{ entry: VaultEntry | null; categories?: string[] }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', entry: VaultEntry | null): void
  (e: 'deleted'): void
  (e: 'generate'): void
}>()

const name = ref('')
const category = ref('未分类')
const account = ref('')
const password = ref('')
const url = ref('')
const note = ref('')
const error = ref('')
const saving = ref(false)
const showPassword = ref(false)

/** 已有分类 + 当前分类 + 默认分类 */
const categoryOptions = computed(() => {
  const set = new Set<string>(['未分类', ...(props.categories ?? [])])
  if (category.value) set.add(category.value)
  return [...set].map((name) => ({ value: name, label: name }))
})

function onCreateCategory(name: string): void {
  category.value = name.trim() || '未分类'
}

onMounted(() => {
  const e = props.entry
  if (e) {
    name.value = e.name
    category.value = e.category
    account.value = e.account
    password.value = e.password
    url.value = e.url
    note.value = e.note
  }
  const onFill = (evt: Event): void => {
    password.value = (evt as CustomEvent<string>).detail
  }
  window.addEventListener('vault:fill-password', onFill)
  onUnmounted(() => window.removeEventListener('vault:fill-password', onFill))
})

async function save(): Promise<void> {
  error.value = ''
  if (!name.value.trim()) {
    error.value = '名称不能为空'
    return
  }
  saving.value = true
  try {
    const data = {
      name: name.value.trim(),
      category: category.value.trim() || '未分类',
      account: account.value,
      password: password.value,
      url: url.value,
      note: note.value
    }
    let result: { ok: boolean; id?: number; error?: string }
    if (props.entry) {
      result = await window.vaultApi.update(props.entry.id, data)
    } else {
      result = await window.vaultApi.add(data)
    }
    if (!result.ok) {
      error.value = result.error ?? '保存失败'
      return
    }
    emit('saved', props.entry ? { ...props.entry, ...data } : { id: result.id!, ...data } as unknown as VaultEntry)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (!props.entry) return
  if (!window.confirm(`确定删除「${props.entry.name}」？此操作不可撤销。`)) return
  const r = await window.vaultApi.delete(props.entry.id)
  if (r.ok) emit('deleted')
  else error.value = r.error ?? '删除失败'
}
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <div class="dialog">
      <h3>{{ entry ? '编辑条目' : '新增条目' }}</h3>

      <label>名称 *</label>
      <input v-model="name" placeholder="如：公司邮箱 / 淘宝账号" @keyup.enter="save" />

      <div class="grid2">
        <div>
          <label>分类</label>
          <CategorySelect
            v-model="category"
            :options="categoryOptions"
            allow-create
            create-label="新建分类"
            @create="onCreateCategory"
          />
        </div>
        <div>
          <label>账号</label>
          <input v-model="account" placeholder="用户名 / 邮箱 / 手机号" />
        </div>
      </div>

      <label>密码</label>
      <div class="pwd-row">
        <input
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          placeholder="留空则仅保存账号"
        />
        <button class="btn small" @click="showPassword = !showPassword">
          {{ showPassword ? '隐藏' : '显示' }}
        </button>
        <button class="btn small" @click="emit('generate')">生成</button>
      </div>

      <label>网址</label>
      <input v-model="url" placeholder="https://…" />

      <label>备注</label>
      <textarea v-model="note" rows="3" placeholder="选填"></textarea>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="foot">
        <button v-if="entry" class="btn btn-danger" :disabled="saving" @click="remove">
          删除
        </button>
        <div class="spacer"></div>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 24, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 460px;
  background: var(--card);
  border-radius: 14px;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.28);
}

h3 {
  margin-bottom: 8px;
}

label {
  font-size: 11.5px;
  color: var(--text2);
  margin-top: 6px;
}

input,
textarea {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
  background: #fff;
  width: 100%;
}

input:focus,
textarea:focus {
  border-color: var(--accent);
}

textarea {
  resize: vertical;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.pwd-row {
  display: flex;
  gap: 8px;
}

.pwd-row input {
  flex: 1;
}

.small {
  padding: 5px 12px;
  font-size: 12px;
  white-space: nowrap;
}

.error {
  color: var(--danger);
  font-size: 12px;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.spacer {
  flex: 1;
}
</style>
