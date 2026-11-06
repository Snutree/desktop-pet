<script setup lang="ts">
/**
 * 历史面板（阶段 6）
 *  - 按日期分组展示：组头 = 今天/昨天/具体日期 + 条数，组内倒序（最新在上）
 *  - 日期筛选下拉：全部（按天分组）/ 指定日期
 *  - 每条：类型标识 / 预览 / 时间 / 【复制】【删除】【收藏】
 *  - 导出当前筛选日期（文本 + 图片复制）；清空当前筛选日期（收藏保护）
 *  - 订阅 clipboard:new 实时刷新
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ClipRecord } from '../../../shared/types'
import ClipItem from '../components/ClipItem.vue'
import ImagePreview from '../components/ImagePreview.vue'

const records = ref<ClipRecord[]>([])
const dates = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const filterDate = ref<string | null>(null) // null = 全部
const previewImage = ref<string | null>(null)
const toast = ref('')
const confirmClear = ref(false)
/** 导出格式（本次导出生效；默认值来自设置页 export_format） */
const exportFormat = ref<'html' | 'pdf'>('html')

// 保存到目录弹框状态
const showPicker = ref(false)
const pickerHistoryId = ref(0)
const categories = ref<{ id: number; name: string; is_default: number; created_at: number }[]>([])
const selectedIds = ref<number[]>([])
const newCatName = ref('')
const saving = ref(false)

let toastTimer: number | undefined
let confirmTimer: number | undefined
let unsubscribe: (() => void) | null = null

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 本地日期字符串 yyyy-MM-dd（与 SQLite localtime 格式一致） */
function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayStr = localDateString(new Date())

/** 昨天日期字符串 */
function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateString(d)
}

/** 日期显示标签（下拉选项用）：今天/昨天/YYYY-MM-DD · 周X */
function dateOptionLabel(date: string): string {
  if (date === todayStr) return `今天 · ${todayStr}`
  if (date === yesterdayStr()) return `昨天 · ${date}`
  const d = new Date(`${date}T00:00:00`)
  return `${date} · ${WEEKDAYS[d.getDay()]}`
}

/** 分组头标签：今天/昨天/YYYY年MM月DD日 周X（+条数） */
function dateGroupLabel(date: string, count: number): string {
  let base: string
  if (date === todayStr) base = '今天'
  else if (date === yesterdayStr()) base = '昨天'
  else {
    const d = new Date(`${date}T00:00:00`)
    base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
  }
  return `${base}（${count} 条）`
}

/** 按日期分组（records 已倒序，组内自然保持倒序；组按日期倒序） */
const grouped = computed(() => {
  const map = new Map<string, ClipRecord[]>()
  for (const r of records.value) {
    const d = localDateString(new Date(r.created_at))
    const list = map.get(d)
    if (list) list.push(r)
    else map.set(d, [r])
  }
  const groups = Array.from(map.entries()).map(([date, items]) => ({
    date,
    label: dateGroupLabel(date, items.length),
    items
  }))
  groups.sort((a, b) => (a.date < b.date ? 1 : -1))
  return groups
})

/** 当前可见分组（筛选生效时只显示该日） */
const visibleGroups = computed(() =>
  filterDate.value ? grouped.value.filter((g) => g.date === filterDate.value) : grouped.value
)

/** 当前筛选的日期（全部 = 今天），用于导出 / 清空 */
const activeDate = computed(() => filterDate.value ?? todayStr)

const activeDateLabel = computed(() => {
  const g = grouped.value.find((x) => x.date === activeDate.value)
  return g ? g.label : dateGroupLabel(activeDate.value, 0)
})

const totalCount = computed(() => records.value.length)

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 1600)
}

/** 从数据库重新拉取列表与日期集合（权威来源） */
async function reload(): Promise<void> {
  try {
    records.value = await window.clipboardPlus.listClips(300)
    dates.value = await window.clipboardPlus.listClipDates()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 复制：写回剪贴板后监听模块会做同日去重 → 该条置顶 */
async function onCopy(id: number): Promise<void> {
  const ok = await window.clipboardPlus.copyClip(id)
  showToast(ok ? '已复制到剪贴板' : '复制失败')
  await reload()
}

async function onRemove(id: number): Promise<void> {
  const ok = await window.clipboardPlus.deleteClip(id)
  showToast(ok ? '已删除' : '删除失败')
  await reload()
}

/** 保存到目录：打开多选目录弹框（默认勾选"默认收藏"） */
async function onSave(id: number): Promise<void> {
  pickerHistoryId.value = id
  try {
    const cats = await window.clipboardPlus.listCategories()
    categories.value = cats
    const def = cats.find((c) => c.is_default === 1)
    selectedIds.value = def ? [def.id] : []
  } catch (e) {
    showToast(`目录加载失败：${e instanceof Error ? e.message : String(e)}`)
    return
  }
  showPicker.value = true
}

function togglePick(categoryId: number): void {
  const i = selectedIds.value.indexOf(categoryId)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(categoryId)
}

async function createCategory(): Promise<void> {
  const name = newCatName.value.trim()
  if (!name) return
  try {
    const cat = await window.clipboardPlus.addCategory(name)
    if (cat) {
      categories.value = [...categories.value, cat]
      selectedIds.value.push(cat.id)
      newCatName.value = ''
    } else {
      showToast('目录名已存在或无效')
    }
  } catch (e) {
    showToast(`新建目录失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function confirmSave(): Promise<void> {
  if (selectedIds.value.length === 0) {
    showToast('请至少选择一个目录')
    return
  }
  saving.value = true
  try {
    // 注意：必须传普通数组拷贝（Vue 响应式 Proxy 数组无法通过 contextBridge 结构化克隆）
    const res = await window.clipboardPlus.saveFavorite(pickerHistoryId.value, [...selectedIds.value])
    showToast(res ? `已保存到 ${res.categoryIds.length} 个目录` : '保存失败，记录可能已不存在')
    showPicker.value = false
    await reload()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    showToast(`保存失败：${msg}`)
    showPicker.value = false
  } finally {
    saving.value = false
  }
}

/** 导出当前筛选日期（全部 = 今日）：弹目录选择 → 按所选格式生成 HTML/PDF 单文件 */
async function onExport(): Promise<void> {
  const result = await window.clipboardPlus.exportByDate(activeDate.value, exportFormat.value)
  if (!result) {
    showToast('已取消导出')
    return
  }
  const imageText = result.imageCount > 0 ? `，图片 ${result.imageCount} 张` : ''
  showToast(`已导出 ${result.recordCount} 条：${result.file}${imageText}`)
}

/** 清空当前筛选日期（全部 = 今日）：首次点击进入确认态（3 秒），再次点击执行 */
async function onClearActiveDate(): Promise<void> {
  if (!confirmClear.value) {
    confirmClear.value = true
    if (confirmTimer) window.clearTimeout(confirmTimer)
    confirmTimer = window.setTimeout(() => {
      confirmClear.value = false
    }, 3000)
    return
  }
  confirmClear.value = false
  const n = await window.clipboardPlus.clearByDate(activeDate.value)
  showToast(n > 0 ? `已清空 ${activeDate.value} 共 ${n} 条` : `${activeDate.value} 无记录可清空`)
  await reload()
}

/** 唤起框选截图 */
async function onScreenshot(): Promise<void> {
  const ok = await window.clipboardPlus.captureScreenshot()
  if (!ok) showToast('截图未启动（可能正在截图中）')
}

onMounted(async () => {
  // 导出格式默认值跟随设置页配置
  try {
    const s = await window.clipboardPlus.getSettings()
    exportFormat.value = s.export_format
  } catch {
    // 保持默认 html
  }
  await reload()
  loading.value = false
  unsubscribe = window.clipboardPlus.onClipboardNew(() => {
    void reload()
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  if (toastTimer) window.clearTimeout(toastTimer)
  if (confirmTimer) window.clearTimeout(confirmTimer)
})
</script>

<template>
  <div>
    <div class="toolbar">
      <select v-model="filterDate" class="date-select" title="按日期筛选">
        <option :value="null">全部日期 · 按天分组（{{ totalCount }} 条）</option>
        <option v-for="d in dates" :key="d" :value="d">{{ dateOptionLabel(d) }}</option>
      </select>

      <div class="actions">
        <button class="btn snap" title="框选截图（Ctrl+Shift+S）" @click="onScreenshot">
          截图
        </button>
        <div class="fmt-switch" title="导出格式（默认值可在设置页修改）">
          <button
            class="fmt-btn"
            :class="{ on: exportFormat === 'html' }"
            @click="exportFormat = 'html'"
          >
            HTML
          </button>
          <button
            class="fmt-btn"
            :class="{ on: exportFormat === 'pdf' }"
            @click="exportFormat = 'pdf'"
          >
            PDF
          </button>
        </div>
        <button class="btn export" :title="`导出 ${activeDate} 的记录（${exportFormat.toUpperCase()}）`" @click="onExport">
          导出{{ filterDate ? dateOptionLabel(activeDate).split('·')[0].trim() : '今日' }}
        </button>
        <button class="btn clear" :class="{ confirming: confirmClear }" @click="onClearActiveDate">
          {{ confirmClear ? `再次点击确认清空${filterDate ? '该日' : '今日'}` : `清空${filterDate ? '该日' : '当日'}` }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="loading" class="empty">正在加载…</div>

    <div v-else-if="records.length === 0" class="empty">
      <p>暂无剪贴记录</p>
      <p class="hint">去任意应用复制文本或图片，记录会实时出现在这里。</p>
    </div>

    <div v-else-if="visibleGroups.length === 0" class="empty">
      <p>{{ dateOptionLabel(activeDate) }} 无记录</p>
    </div>

    <template v-else>
      <section v-for="g in visibleGroups" :key="g.date" class="group">
        <h2 class="group-head">{{ g.label }}</h2>
        <ul class="list">
          <ClipItem
            v-for="r in g.items"
            :key="r.id"
            :record="r"
            :show-date="false"
            @copy="onCopy"
            @remove="onRemove"
            @save="onSave"
            @preview="previewImage = $event.image_path"
          />
        </ul>
      </section>
    </template>

    <ImagePreview v-if="previewImage" :image-path="previewImage" @close="previewImage = null" />

    <!-- 保存到目录弹框 -->
    <div v-if="showPicker" class="picker-mask" @click.self="showPicker = false">
      <div class="picker">
        <div class="picker-t">保存到目录</div>
        <div class="picker-d">可多选，同一内容可同时存在于多个目录</div>
        <div class="picker-cats">
          <label v-for="c in categories" :key="c.id" class="cat">
            <input
              type="checkbox"
              :checked="selectedIds.includes(c.id)"
              @change="togglePick(c.id)"
            />
            <span class="cat-name">
              {{ c.name }}
              <em v-if="c.is_default === 1">默认</em>
            </span>
          </label>
          <div v-if="categories.length === 0" class="picker-empty">暂无目录，请先新建</div>
        </div>
        <div class="picker-new">
          <input
            v-model="newCatName"
            class="new-input"
            placeholder="新建目录名称，回车添加"
            @keydown.enter.prevent="createCategory"
          />
          <button class="new-btn" @click="createCategory">新建</button>
        </div>
        <div class="picker-actions">
          <button class="btn-cancel" @click="showPicker = false">取消</button>
          <button class="btn-ok" :disabled="saving" @click="confirmSave">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.date-select {
  font-family: inherit;
  font-size: 13px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  border-radius: 8px;
  padding: 5px 10px;
  color: var(--text);
  max-width: 280px;
}

.actions {
  display: flex;
  gap: 6px;
}

.btn {
  font-size: 12px;
  border-radius: 8px;
  padding: 5px 14px;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn.snap {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent-deep);
}

.btn.snap:hover {
  background: var(--accent-bg);
}

.btn.export {
  background: var(--accent);
  color: var(--accent-text);
}

.fmt-switch {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  overflow: hidden;
}

.fmt-btn {
  font-size: 12px;
  border: none;
  background: var(--input-bg);
  color: var(--text-secondary);
  padding: 4px 12px;
  cursor: pointer;
  font-family: inherit;
}

.fmt-btn + .fmt-btn {
  border-left: 1px solid var(--border-strong);
}

.fmt-btn.on {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.btn.export:hover {
  filter: brightness(0.94);
}

.btn.clear {
  border: 1px solid var(--red-border);
  background: transparent;
  color: var(--red);
}

.btn.clear:hover {
  background: var(--red-bg);
}

.btn.clear.confirming {
  background: var(--red-solid);
  border-color: var(--red-solid);
  color: #ffffff;
  font-weight: 600;
}

.error {
  color: var(--red);
  font-size: 13px;
  margin-bottom: 12px;
}

.group {
  margin-bottom: 18px;
}

.group-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--head-bg);
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 8px;
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 8px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  background: var(--toast-bg);
  color: var(--toast-text);
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

/* ── 保存到目录弹框 ── */
.picker-mask {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.picker {
  width: 360px;
  max-width: calc(100vw - 40px);
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.picker-t {
  font-size: 15px;
  font-weight: 600;
  color: #1a1b1c;
}

.picker-d {
  font-size: 12px;
  color: #6b7280;
  margin: 3px 0 12px;
}

.picker-cats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #e4e3dd;
  border-radius: 10px;
  padding: 8px;
}

.cat {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #1a1b1c;
}

.cat:hover {
  background: rgba(139, 200, 234, 0.12);
}

.cat input {
  width: 15px;
  height: 15px;
  accent-color: #8bc8ea;
}

.cat-name em {
  font-style: normal;
  font-size: 10.5px;
  background: rgba(139, 200, 234, 0.25);
  color: #1a5c7a;
  border-radius: 5px;
  padding: 1px 6px;
  margin-left: 6px;
}

.picker-empty {
  font-size: 12px;
  color: #9aa3b5;
  text-align: center;
  padding: 14px 0;
}

.picker-new {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.new-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 12.5px;
  border: 1px solid #e4e3dd;
  border-radius: 8px;
  padding: 7px 10px;
  outline: none;
}

.new-input:focus {
  border-color: #8bc8ea;
}

.new-btn {
  border: 1px solid #8bc8ea;
  background: transparent;
  color: #1a5c7a;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}

.new-btn:hover {
  background: rgba(139, 200, 234, 0.15);
}

.picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.btn-cancel {
  border: 1px solid #e4e3dd;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 7px 18px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}

.btn-ok {
  border: none;
  background: #8bc8ea;
  color: #14222b;
  font-weight: 600;
  border-radius: 8px;
  padding: 7px 20px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}

.btn-ok:hover {
  filter: brightness(0.94);
}

.btn-ok:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
