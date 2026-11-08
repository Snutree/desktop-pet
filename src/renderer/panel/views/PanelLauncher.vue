<script setup lang="ts">
/**
 * 启动中心（v1.1）
 *  - 左侧分组，右侧启动项（行式）
 *  - 选择 .exe/.bat/.cmd 文件，自动使用文件所在目录作为工作目录
 *  - 点击启动 = 等同于在文件夹双击（bat/cmd 显示控制台）
 *  - 支持默认管理员启动、分组、标签、组内拖拽排序
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LauncherEntry, LauncherGroup } from '../../../shared/types'
import CategoryNav from '../../components/CategoryNav.vue'
import CategorySelect from '../../components/CategorySelect.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import { useDragSort } from '../../composables/useDragSort'

const groups = ref<LauncherGroup[]>([])
const entries = ref<LauncherEntry[]>([])
const activeGroupId = ref<number | null>(null)
const search = ref('')
const tagFilter = ref('')
const loading = ref(true)
const toast = ref('')
let toastTimer: number | undefined
const startErrors = ref<Record<number, string>>({})

const showEditor = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
  name: '',
  filePath: '',
  dirPath: '',
  type: 'exe' as 'exe' | 'bat' | 'cmd',
  groupId: 0,
  tags: '',
  runAsAdmin: false
})
const formError = ref('')
const saving = ref(false)
const choosing = ref(false)

const confirmDeleteGroup = ref<LauncherGroup | null>(null)
const confirmDeleteEntry = ref<LauncherEntry | null>(null)

const activeGroup = computed(() => groups.value.find((g) => g.id === activeGroupId.value) ?? null)
const groupOptions = computed(() =>
  groups.value.map((g) => ({ value: g.id, label: g.name }))
)

const allTags = computed(() => {
  const set = new Set<string>()
  for (const e of entries.value) e.tags.forEach((t) => set.add(t))
  return [...set].sort()
})

const filteredEntries = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (tagFilter.value && !e.tags.includes(tagFilter.value)) return false
    if (!kw) return true
    return (
      e.name.toLowerCase().includes(kw) ||
      e.file_path.toLowerCase().includes(kw) ||
      e.tags.some((t) => t.toLowerCase().includes(kw))
    )
  })
})

const canDrag = computed(() => !search.value.trim() && !tagFilter.value)
const { draggingId, onDragStart, onDragOver, onDrop, onDragEnd } = useDragSort(
  () => filteredEntries.value,
  async (orderedIds) => {
    if (activeGroupId.value == null) return
    await window.launcherApi.reorderEntries(activeGroupId.value, orderedIds)
    await loadEntries()
  }
)

function showToast(msg: string, duration = 2000): void {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), duration)
}

function formatTime(ms: number | null): string {
  if (!ms) return '从未启动'
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

async function loadGroups(): Promise<void> {
  groups.value = await window.launcherApi.listGroups()
  if (activeGroupId.value == null || !groups.value.some((g) => g.id === activeGroupId.value)) {
    activeGroupId.value = groups.value.find((g) => g.is_default === 1)?.id ?? groups.value[0]?.id ?? null
  }
}

async function loadEntries(): Promise<void> {
  entries.value = await window.launcherApi.listEntries(activeGroupId.value)
}

async function reload(): Promise<void> {
  try {
    await loadGroups()
    await loadEntries()
  } catch (err) {
    showToast(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function selectGroup(id: string | number): Promise<void> {
  activeGroupId.value = Number(id)
  startErrors.value = {}
  await loadEntries()
}

async function addGroup(name: string): Promise<void> {
  const res = await window.launcherApi.addGroup(name)
  if (!res.ok) {
    showToast(res.error ?? '新建分组失败')
    return
  }
  await loadGroups()
  if (res.data) {
    activeGroupId.value = res.data.id
    await loadEntries()
  }
}

async function renameGroup(id: string | number, name: string): Promise<void> {
  const res = await window.launcherApi.renameGroup(Number(id), name)
  if (!res.ok) {
    showToast(res.error ?? '重命名失败')
    return
  }
  await loadGroups()
}

function askDeleteGroup(id: string | number): void {
  confirmDeleteGroup.value = groups.value.find((g) => g.id === Number(id)) ?? null
}

async function doDeleteGroup(): Promise<void> {
  const group = confirmDeleteGroup.value
  confirmDeleteGroup.value = null
  if (!group) return
  const res = await window.launcherApi.deleteGroup(group.id)
  if (!res.ok) {
    showToast(res.error ?? '删除失败')
    return
  }
  activeGroupId.value = null
  await loadGroups()
  await loadEntries()
  showToast(`分组「${group.name}」已删除${res.deletedItems ? `（含 ${res.deletedItems} 个启动项）` : ''}`)
}

function openAdd(): void {
  editingId.value = null
  form.value = {
    name: '',
    filePath: '',
    dirPath: '',
    type: 'exe',
    groupId: activeGroupId.value ?? groups.value[0]?.id ?? 0,
    tags: '',
    runAsAdmin: false
  }
  formError.value = ''
  showEditor.value = true
}

async function openEdit(entry: LauncherEntry): Promise<void> {
  editingId.value = entry.id
  form.value = {
    name: entry.name,
    filePath: entry.file_path,
    dirPath: entry.dir_path,
    type: entry.type,
    groupId: entry.group_id,
    tags: entry.tags.join(', '),
    runAsAdmin: entry.run_as_admin === 1
  }
  formError.value = ''
  showEditor.value = true
}

async function chooseFile(): Promise<void> {
  choosing.value = true
  try {
    const res = await window.launcherApi.chooseFile()
    if (!res.ok || !res.path) return
    const base = (res.name ?? '').replace(/\.(exe|bat|cmd)$/i, '')
    form.value.filePath = res.path
    form.value.dirPath = res.dir ?? ''
    form.value.name = form.value.name || base
    const ext = (res.ext ?? '').replace('.', '')
    if (ext === 'exe' || ext === 'bat' || ext === 'cmd') form.value.type = ext
  } finally {
    choosing.value = false
  }
}

async function createGroupInline(name: string): Promise<void> {
  const res = await window.launcherApi.addGroup(name)
  if (!res.ok) {
    formError.value = res.error ?? '新建分组失败'
    return
  }
  await loadGroups()
  if (res.data) form.value.groupId = res.data.id
}

// ── 标签 / 保存 ──────────────────────────────────────────

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,，;；\s]+/).map((t) => t.trim()).filter(Boolean))]
}

async function save(): Promise<void> {
  formError.value = ''
  if (!form.value.name.trim()) {
    formError.value = '请填写名称'
    return
  }
  if (!form.value.filePath) {
    formError.value = '请选择启动文件（.exe / .bat / .cmd）'
    return
  }
  if (!form.value.groupId) {
    formError.value = '请选择分组'
    return
  }
  saving.value = true
  try {
    const input = {
      name: form.value.name.trim(),
      type: form.value.type,
      file_path: form.value.filePath,
      dir_path: form.value.dirPath,
      group_id: form.value.groupId,
      tags: parseTags(form.value.tags),
      run_as_admin: form.value.runAsAdmin
    }
    const res =
      editingId.value == null
        ? await window.launcherApi.addEntry(input)
        : await window.launcherApi.updateEntry(editingId.value, input)
    if (!res.ok) {
      formError.value = res.error ?? '保存失败'
      return
    }
    showEditor.value = false
    await loadGroups()
    await loadEntries()
    showToast(editingId.value == null ? '已添加启动项' : '已保存')
  } finally {
    saving.value = false
  }
}

async function run(entry: LauncherEntry): Promise<void> {
  const res = await window.launcherApi.run(entry.id)
  if (res.ok) {
    delete startErrors.value[entry.id]
    await loadEntries()
    return
  }
  startErrors.value = { ...startErrors.value, [entry.id]: res.error ?? '启动失败' }
  showToast(res.error ?? '启动失败', 3000)
}

async function doDeleteEntry(): Promise<void> {
  const entry = confirmDeleteEntry.value
  confirmDeleteEntry.value = null
  if (!entry) return
  const ok = await window.launcherApi.deleteEntry(entry.id)
  if (!ok) {
    showToast('删除失败')
    return
  }
  await loadGroups()
  await loadEntries()
  showToast('已删除启动项')
}

function askDeleteEntry(entry: LauncherEntry): void {
  confirmDeleteEntry.value = entry
}

/** 默认分组不允许重命名 */
function canRenameGroup(item: { id: string | number }): boolean {
  return !groups.value.find((g) => g.id === Number(item.id))?.is_default
}

onMounted(async () => {
  await reload()
})

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="launcher-page">
    <CategoryNav
      title="分组"
      :items="
        groups.map((g) => ({
          id: g.id,
          name: g.name,
          count: g.count ?? 0,
          isDefault: g.is_default === 1
        }))
      "
      :active-id="activeGroupId"
      allow-add
      add-placeholder="新建分组"
      allow-rename
      allow-delete
      :can-rename="canRenameGroup"
      :can-delete="(item) => !groups.find((g) => g.id === Number(item.id))?.is_default"
      @select="selectGroup"
      @add="addGroup"
      @rename="renameGroup"
      @delete="askDeleteGroup"
    />

    <section class="content">
      <div class="toolbar">
        <input v-model="search" class="search" placeholder="搜索名称 / 路径 / 标签" />
        <select v-model="tagFilter" class="tag-filter">
          <option value="">全部标签</option>
          <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
        </select>
        <div class="spacer"></div>
        <span class="count">{{ filteredEntries.length }} 个启动项</span>
        <button class="add-btn" @click="openAdd">＋ 添加启动项</button>
      </div>

      <div v-if="loading" class="empty">正在加载…</div>

      <div v-else-if="groups.length === 0" class="empty">
        <p>还没有分组</p>
        <p class="hint">先在左侧新建分组，再添加启动项。</p>
      </div>

      <div v-else-if="filteredEntries.length === 0" class="empty">
        <p>该分组还没有启动项</p>
        <p class="hint">点击右上角「添加启动项」，选择 .exe / .bat / .cmd 文件。</p>
      </div>

      <ul v-else class="list">
        <li
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="row"
          :class="{ dragging: draggingId === entry.id }"
          :draggable="canDrag"
          @dragstart="onDragStart(entry)"
          @dragover="onDragOver"
          @drop="onDrop(entry)"
          @dragend="onDragEnd"
        >
          <img
            v-if="entry.icon_path"
            class="row-icon"
            :src="`lxicon://local/${entry.icon_path}`"
            alt=""
          />
          <span v-else class="row-icon fallback">{{ entry.type.toUpperCase() }}</span>

          <div class="row-main">
            <div class="row-title">
              <span class="row-name">{{ entry.name }}</span>
              <span class="type-badge">{{ entry.type.toUpperCase() }}</span>
              <span v-for="t in entry.tags" :key="t" class="tag">{{ t }}</span>
              <span v-if="entry.run_as_admin === 1" class="admin-badge" title="默认以管理员身份启动">管理员</span>
            </div>
            <div class="row-path" :title="entry.file_path">{{ entry.file_path }}</div>
            <div v-if="startErrors[entry.id]" class="row-error">{{ startErrors[entry.id] }}</div>
          </div>

          <div class="row-meta">
            <span class="row-group">{{ entry.group_name }}</span>
            <span class="row-time">{{ formatTime(entry.last_run_at) }}</span>
          </div>

          <div class="row-actions">
            <button class="act-btn start" @click="run(entry)">启动</button>
            <button class="act-btn edit" @click="openEdit(entry)">编辑</button>
            <button class="act-btn del" @click="askDeleteEntry(entry)">删除</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 添加 / 编辑弹窗 -->
    <div v-if="showEditor" class="editor-overlay" @click.self="showEditor = false">
      <div class="editor">
        <h3>{{ editingId == null ? '添加启动项' : '编辑启动项' }}</h3>

        <label>启动文件 *</label>
        <div class="file-row">
          <input :value="form.filePath" readonly placeholder="选择 .exe / .bat / .cmd 文件" />
          <button class="btn" :disabled="choosing" @click="chooseFile">
            {{ choosing ? '选择中…' : '选择文件' }}
          </button>
        </div>
        <p v-if="form.dirPath" class="file-hint">工作目录：{{ form.dirPath }}</p>

        <label>名称 *</label>
        <input v-model="form.name" placeholder="显示名称" />

        <label>分组 *</label>
        <CategorySelect
          v-model="form.groupId"
          :options="groupOptions"
          allow-create
          create-label="新建分组"
          @create="createGroupInline"
        />

        <label>标签</label>
        <input v-model="form.tags" placeholder="多个标签用逗号分隔，如：后端, 项目A" />

        <label class="check-row">
          <input v-model="form.runAsAdmin" type="checkbox" />
          默认以管理员身份启动（启动时触发 UAC）
        </label>

        <p v-if="formError" class="error">{{ formError }}</p>

        <div class="editor-foot">
          <div class="spacer"></div>
          <button class="btn" @click="showEditor = false">取消</button>
          <button class="btn primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmDeleteGroup"
      title="删除分组"
      :message="`删除分组「${confirmDeleteGroup.name}」将同时删除其中 ${confirmDeleteGroup.count ?? 0} 个启动项，此操作不可撤销。`"
      confirm-text="删除"
      danger
      @confirm="doDeleteGroup"
      @cancel="confirmDeleteGroup = null"
    />

    <ConfirmDialog
      v-if="confirmDeleteEntry"
      title="删除启动项"
      :message="`确定删除「${confirmDeleteEntry.name}」？只删除这条启动项，不会删除原文件。`"
      confirm-text="删除"
      danger
      @confirm="doDeleteEntry"
      @cancel="confirmDeleteEntry = null"
    />

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.launcher-page {
  display: flex;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 2px 2px 0;
  box-sizing: border-box;
}

.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.search {
  width: 260px;
  max-width: 40vw;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  color: var(--text, #1a1b1c);
}

.search:focus {
  border-color: var(--accent, #e8a87c);
}

.tag-filter {
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  font-family: inherit;
  background: #fff;
  color: var(--text, #1a1b1c);
  outline: none;
  max-width: 150px;
}

.spacer {
  flex: 1;
}

.count {
  font-size: 12px;
  color: var(--text-secondary, var(--text2, #6b7280));
}

.add-btn {
  border: none;
  background: var(--accent, #e8a87c);
  color: #fff;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  font-weight: 600;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  padding: 10px 14px;
  cursor: grab;
}

.row.dragging {
  opacity: 0.55;
}

.row-icon {
  width: 30px;
  height: 30px;
  object-fit: contain;
  flex: 0 0 auto;
}

.row-icon.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--accent-bg, rgba(232, 168, 124, 0.18));
  color: var(--accent-deep, #b06a3a);
  font-size: 9px;
  font-weight: 700;
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.row-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text, #1a1b1c);
}

.type-badge {
  font-size: 9.5px;
  border-radius: 5px;
  padding: 1px 6px;
  background: var(--gold-bg, rgba(228, 212, 143, 0.35));
  color: var(--gold-deep, #7a6420);
  font-weight: 600;
}

.tag {
  font-size: 10.5px;
  border-radius: 5px;
  padding: 1px 6px;
  background: var(--head-bg, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary, #6b7280);
}

.admin-badge {
  font-size: 10.5px;
  border-radius: 5px;
  padding: 1px 6px;
  background: var(--red-bg, rgba(234, 102, 104, 0.12));
  color: var(--red, #b02a2a);
}

.row-path {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-error {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--red, #b02a2a);
}

.row-meta {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.row-group {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--head-bg, rgba(0, 0, 0, 0.05));
}

.row-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.act-btn {
  border: none;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  font-weight: 600;
  color: #fff;
}

.act-btn.start {
  background: #52c41a;
}

.act-btn.edit {
  background: #f0a020;
}

.act-btn.del {
  background: #ea6668;
}

.act-btn:hover {
  filter: brightness(0.94);
}

.act-btn:active {
  transform: translateY(1px);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  gap: 6px;
  text-align: center;
}

.hint {
  font-size: 12px;
}

.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 24, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 250;
}

.editor {
  width: 500px;
  max-width: 92vw;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--card, #fff);
  border-radius: 14px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text, #1a1b1c);
  box-shadow: 0 14px 48px rgba(0, 0, 0, 0.28);
}

.editor h3 {
  margin: 0 0 6px;
  font-size: 15px;
}

.editor label {
  font-size: 11.5px;
  color: var(--text-secondary, #6b7280);
  margin-top: 4px;
}

.editor input:not([type='checkbox']),
.editor textarea {
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  color: var(--text, #1a1b1c);
  width: 100%;
  box-sizing: border-box;
}

.editor input:focus {
  border-color: var(--accent, #e8a87c);
}

.file-row {
  display: flex;
  gap: 8px;
}

.file-row input {
  flex: 1;
  background: var(--head-bg, rgba(0, 0, 0, 0.03));
}

.file-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  word-break: break-all;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px !important;
  color: var(--text, #1a1b1c) !important;
  margin-top: 8px !important;
}

.error {
  color: var(--red, #b02a2a);
  font-size: 12px;
  margin: 4px 0 0;
}

.editor-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: #fff;
  color: var(--text, #1a1b1c);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}

.btn:hover {
  border-color: var(--accent, #e8a87c);
}

.btn.primary {
  background: var(--accent, #e8a87c);
  border-color: var(--accent, #e8a87c);
  color: #fff;
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  background: var(--toast-bg, rgba(26, 27, 28, 0.9));
  color: var(--toast-text, #fff);
  font-size: 13px;
  padding: 8px 18px;
  border-radius: 999px;
  z-index: 400;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
