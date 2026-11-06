<script setup lang="ts">
/**
 * 密码本主界面：分类导航 + 搜索 + 条目列表 + 详情 + 新增/编辑/生成器/设置
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { VaultEntry } from '../env.d'
import EntryDialog from './EntryDialog.vue'
import GenDialog from './GenDialog.vue'

const props = defineProps<{ vaultPath: string }>()
const emit = defineEmits<{ (e: 'locked'): void }>()

// ── 数据 ───────────────────────────────────────────────
const categories = ref<{ category: string; count: number }[]>([])
const entries = ref<VaultEntry[]>([])
const keyword = ref('')
const activeCategory = ref('全部')
const selectedId = ref<number | null>(null)
const entryCount = ref(0)
const toast = ref('')
let toastTimer: number | null = null

// 弹窗
const showEntryDialog = ref(false)
const editingEntry = ref<VaultEntry | null>(null)
const showGenDialog = ref(false)
const showSettings = ref(false)

const selected = computed(() =>
  selectedId.value === null ? null : entries.value.find((e) => e.id === selectedId.value) ?? null
)

async function loadCategories(): Promise<void> {
  categories.value = await window.vaultApi.categories()
}

async function loadEntries(): Promise<void> {
  entries.value = await window.vaultApi.search(
    keyword.value,
    activeCategory.value === '全部' ? null : activeCategory.value
  )
  if (selectedId.value !== null && !entries.value.some((e) => e.id === selectedId.value)) {
    selectedId.value = null
  }
  const state = await window.vaultApi.getState()
  entryCount.value = state.entryCount
}

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2200)
}

// ── 交互 ───────────────────────────────────────────────
function selectCategory(cat: string): void {
  activeCategory.value = cat
  void loadEntries()
}

let searchTimer: number | null = null
function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadEntries(), 250)
  window.vaultApi.activity()
}

function openNew(): void {
  editingEntry.value = null
  showEntryDialog.value = true
}

function openEdit(entry: VaultEntry): void {
  editingEntry.value = entry
  showEntryDialog.value = true
}

async function onSaved(entry: VaultEntry | null): Promise<void> {
  showEntryDialog.value = false
  await loadCategories()
  await loadEntries()
  if (entry) selectedId.value = entry.id
  showToast(entry ? '已保存' : '')
}

async function onDeleted(): Promise<void> {
  showEntryDialog.value = false
  selectedId.value = null
  await loadCategories()
  await loadEntries()
  showToast('已删除')
}

async function copyField(field: 'account' | 'password'): Promise<void> {
  if (selectedId.value === null) return
  const r = await window.vaultApi.copy(selectedId.value, field)
  showToast(r.ok ? '已复制，30 秒后自动清空剪贴板' : (r.error ?? '复制失败'))
  window.vaultApi.activity()
}

async function lock(): Promise<void> {
  await window.vaultApi.lock()
  emit('locked')
}

// 生成器：生成成功后填入当前编辑条目
function useGenerated(pwd: string): void {
  showGenDialog.value = false
  openNew()
  // 等待弹窗打开后填入（通过事件总线简化：直接操作 nextTick）
  import('vue').then(({ nextTick }) =>
    nextTick(() => {
      // EntryDialog 内部监听自定义事件
      window.dispatchEvent(new CustomEvent('vault:fill-password', { detail: pwd }))
    })
  )
}

function touch(): void {
  window.vaultApi.activity()
}

onMounted(() => {
  void loadCategories()
  void loadEntries()
  // 交互心跳
  const hb = window.setInterval(() => window.vaultApi.activity(), 30_000)
  onUnmounted(() => window.clearInterval(hb))
})
</script>

<template>
  <div class="main" @mousemove="touch">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">🔐 密码本</div>
      <input
        v-model="keyword"
        class="search"
        placeholder="搜索名称 / 账号 / 网址 / 备注…"
        @input="onSearch"
      />
      <div class="actions">
        <button class="btn" @click="showGenDialog = true">生成密码</button>
        <button class="btn" @click="showSettings = true">设置</button>
        <button class="btn btn-primary" @click="openNew">＋ 新增</button>
        <button class="btn icon" title="锁定" @click="lock">🔒</button>
      </div>
    </header>

    <div class="body">
      <!-- 分类栏 -->
      <aside class="sidebar">
        <button
          v-for="c in categories"
          :key="c.category"
          class="cat"
          :class="{ active: activeCategory === c.category }"
          @click="selectCategory(c.category)"
        >
          <span class="cat-name">{{ c.category }}</span>
          <span class="cat-count">{{ c.count }}</span>
        </button>
        <div class="footnote">{{ entryCount }} 条记录</div>
      </aside>

      <!-- 条目列表 -->
      <section class="list">
        <div v-if="entries.length === 0" class="empty">
          暂无条目
          <button class="btn btn-primary" @click="openNew">＋ 新增第一条</button>
        </div>
        <div
          v-for="e in entries"
          :key="e.id"
          class="item"
          :class="{ active: selectedId === e.id }"
          @click="selectedId = e.id; touch()"
          @dblclick="openEdit(e)"
        >
          <div class="item-name">{{ e.name || '（未命名）' }}</div>
          <div class="item-meta">
            <span class="tag">{{ e.category }}</span>
            <span v-if="e.account" class="item-account">{{ e.account }}</span>
          </div>
        </div>
      </section>

      <!-- 详情 -->
      <section v-if="selected" class="detail">
        <div class="detail-head">
          <h2>{{ selected.name }}</h2>
          <span class="tag">{{ selected.category }}</span>
        </div>
        <div class="field">
          <label>账号</label>
          <div class="field-row">
            <span class="mono">{{ selected.account || '—' }}</span>
            <button class="btn small" @click="copyField('account')">复制</button>
          </div>
        </div>
        <div class="field">
          <label>密码</label>
          <div class="field-row">
            <span class="mono">{{ selected.password || '—' }}</span>
            <button class="btn small" @click="copyField('password')">复制</button>
          </div>
        </div>
        <div v-if="selected.url" class="field">
          <label>网址</label>
          <div class="field-row">
            <span class="mono url">{{ selected.url }}</span>
          </div>
        </div>
        <div v-if="selected.note" class="field">
          <label>备注</label>
          <div class="note">{{ selected.note }}</div>
        </div>
        <div class="detail-foot">
          <button class="btn" @click="openEdit(selected)">编辑</button>
          <span class="updated">更新于 {{ selected.updated_at }}</span>
        </div>
      </section>
      <section v-else class="detail placeholder">
        <div class="ph">选择左侧条目查看详情<br /><small>双击条目可直接编辑</small></div>
      </section>
    </div>

    <!-- 弹窗 -->
    <EntryDialog
      v-if="showEntryDialog"
      :entry="editingEntry"
      @close="showEntryDialog = false"
      @saved="onSaved"
      @deleted="onDeleted"
      @generate="showGenDialog = true"
    />
    <GenDialog v-if="showGenDialog" @close="showGenDialog = false" @use="useGenerated" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" @locked="emit('locked')" />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.brand {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
}

.search {
  flex: 1;
  max-width: 340px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  background: var(--bg);
}

.search:focus {
  border-color: var(--accent);
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.icon {
  padding: 7px 10px;
  font-size: 14px;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.sidebar {
  width: 150px;
  border-right: 1px solid var(--border);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  background: var(--card);
}

.cat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: none;
  background: none;
  border-radius: 7px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
}

.cat:hover {
  background: var(--accent-bg);
}

.cat.active {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

.cat-count {
  font-size: 11px;
  opacity: 0.75;
}

.footnote {
  margin-top: auto;
  padding: 10px;
  font-size: 11px;
  color: var(--text2);
}

.list {
  width: 280px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px;
  background: var(--bg);
}

.empty {
  padding: 40px 10px;
  text-align: center;
  color: var(--text2);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}

.item {
  border-radius: 9px;
  padding: 10px 12px;
  margin-bottom: 4px;
  cursor: pointer;
  background: var(--card);
  border: 1px solid transparent;
}

.item:hover {
  border-color: var(--border);
}

.item.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.item-name {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tag {
  font-size: 10.5px;
  background: var(--accent-bg);
  color: var(--accent-deep);
  border-radius: 999px;
  padding: 2px 8px;
}

.item-account {
  font-size: 11px;
  color: var(--text2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  flex: 1;
  padding: 22px 26px;
  overflow-y: auto;
  background: var(--bg);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.detail-head h2 {
  font-size: 19px;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  font-size: 11.5px;
  color: var(--text2);
  margin-bottom: 6px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  word-break: break-all;
  flex: 1;
}

.url {
  color: #1a6fb0;
}

.note {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  white-space: pre-wrap;
}

.small {
  padding: 4px 12px;
  font-size: 12px;
}

.detail-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.updated {
  font-size: 11px;
  color: var(--text2);
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text2);
}

.ph {
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
}

.ph small {
  color: var(--text2);
}
</style>

<script lang="ts">
import { defineComponent } from 'vue'
import SettingsDialog from './SettingsDialog.vue'

export default defineComponent({
  components: { SettingsDialog }
})
</script>
