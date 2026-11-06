<script setup lang="ts">
/**
 * 收藏面板（v4：目录制）
 *  - 左侧目录列表（默认收藏在前），右侧该目录内容
 *  - 每条：一键复制（按收藏 id）/ 编辑（共享内容，全局生效）/ 移出目录
 *  - 图片点击放大
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { FavoriteRecord } from '../../../shared/types'
import FavoriteItem from '../components/FavoriteItem.vue'
import ImagePreview from '../components/ImagePreview.vue'

const favorites = ref<FavoriteRecord[]>([])
const categories = ref<{ id: number; name: string; is_default: number; created_at: number }[]>([])
const activeCatId = ref<number | null>(null)
const newCatName = ref('')
const loading = ref(true)
const error = ref('')
const previewImage = ref<string | null>(null)
const toast = ref('')
let toastTimer: number | undefined

const activeCatName = (): string =>
  categories.value.find((c) => c.id === activeCatId.value)?.name ?? ''

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 1600)
}

async function loadCategories(): Promise<void> {
  categories.value = await window.clipboardPlus.listCategories()
  if (!activeCatId.value || !categories.value.some((c) => c.id === activeCatId.value)) {
    activeCatId.value = categories.value[0]?.id ?? null
  }
}

async function reload(): Promise<void> {
  try {
    await loadCategories()
    if (activeCatId.value != null) {
      favorites.value = await window.clipboardPlus.listFavoritesByCategory(activeCatId.value)
    } else {
      favorites.value = []
    }
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectCat(id: number): Promise<void> {
  activeCatId.value = id
  try {
    favorites.value = await window.clipboardPlus.listFavoritesByCategory(id)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function createCategory(): Promise<void> {
  const name = newCatName.value.trim()
  if (!name) return
  const cat = await window.clipboardPlus.addCategory(name)
  if (cat) {
    newCatName.value = ''
    await loadCategories()
    await selectCat(cat.id)
    showToast('目录已创建')
  } else {
    showToast('目录名已存在或无效')
  }
}

async function removeCategory(cat: { id: number; name: string; is_default: number }): Promise<void> {
  if (cat.is_default === 1) {
    showToast('默认目录不可删除')
    return
  }
  const ok = await window.clipboardPlus.removeCategory(cat.id)
  if (ok) {
    showToast(`目录「${cat.name}」已删除（内容仍在其他目录）`)
    await reload()
  } else {
    showToast('删除失败')
  }
}

/** 一键复制：按收藏 id 直接取内容写回剪贴板 */
async function onCopy(id: number): Promise<void> {
  const ok = await window.clipboardPlus.copyFavorite(id)
  showToast(ok ? '已复制到剪贴板' : '复制失败')
}

/** 移出当前目录（内容不再属于任何目录时自动删除本体） */
async function onRemoveFromCategory(favoriteId: number): Promise<void> {
  if (activeCatId.value == null) return
  const ok = await window.clipboardPlus.removeFavoriteFromCategory(favoriteId, activeCatId.value)
  showToast(ok ? '已移出该目录' : '操作失败')
  await reload()
}

async function onUpdate(id: number, patch: { text?: string; note?: string }): Promise<void> {
  const updated = await window.clipboardPlus.updateFavorite(id, patch)
  showToast(updated ? '已保存（所有目录同步生效）' : '保存失败')
  await reload()
}

onMounted(async () => {
  await reload()
  loading.value = false
})

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="fav-page">
    <!-- 目录栏 -->
    <aside class="cats">
      <div class="cats-t">目录</div>
      <div class="cat-list">
        <button
          v-for="c in categories"
          :key="c.id"
          class="cat"
          :class="{ active: c.id === activeCatId }"
          @click="selectCat(c.id)"
        >
          <span class="cat-name">{{ c.name }}</span>
          <em v-if="c.is_default === 1" class="def">默认</em>
          <span
            v-if="c.is_default !== 1"
            class="del"
            title="删除目录"
            @click.stop="removeCategory(c)"
          >
            ✕
          </span>
        </button>
        <div v-if="categories.length === 0" class="cats-empty">暂无目录</div>
      </div>
      <div class="cats-new">
        <input
          v-model="newCatName"
          class="new-input"
          placeholder="新建目录"
          @keydown.enter.prevent="createCategory"
        />
        <button class="new-btn" title="新建目录" @click="createCategory">＋</button>
      </div>
    </aside>

    <!-- 内容区 -->
    <section class="content">
      <div class="toolbar">
        <span class="count">
          {{ activeCatName() || '选择目录' }} · {{ favorites.length }} 条
        </span>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="loading" class="empty">正在加载…</div>

      <div v-else-if="categories.length === 0" class="empty">
        <p>还没有目录</p>
        <p class="hint">在左侧新建目录，然后在历史列表点【保存】把内容存进来。</p>
      </div>

      <div v-else-if="favorites.length === 0" class="empty">
        <p>该目录暂无内容</p>
        <p class="hint">在历史列表点【保存】，选择这个目录即可。</p>
      </div>

      <ul v-else class="list">
        <FavoriteItem
          v-for="f in favorites"
          :key="f.id"
          :favorite="f"
          @copy="onCopy"
          @remove="onRemoveFromCategory"
          @update="onUpdate"
          @preview="previewImage = $event"
        />
      </ul>
    </section>

    <ImagePreview v-if="previewImage" :image-path="previewImage" @close="previewImage = null" />

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.fav-page {
  display: flex;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

/* ── 目录栏 ── */
.cats {
  flex: 0 0 168px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-right: 1px solid var(--border);
  padding-right: 12px;
}

.cats-t {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 1px;
}

.cat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cat {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.cat:hover {
  background: var(--head-bg);
}

.cat.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  font-weight: 600;
}

.cat-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cat .def {
  font-style: normal;
  font-size: 10.5px;
  background: var(--accent);
  color: var(--accent-text);
  border-radius: 5px;
  padding: 1px 6px;
}

.cat .del {
  color: var(--text-secondary);
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  visibility: hidden;
}

.cat:hover .del {
  visibility: visible;
}

.cat .del:hover {
  color: var(--red);
  background: var(--red-bg);
}

.cats-empty {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  padding: 16px 0;
}

.cats-new {
  display: flex;
  gap: 6px;
}

.new-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  border-radius: 8px;
  padding: 6px 9px;
  color: var(--text);
  outline: none;
}

.new-input:focus {
  border-color: var(--accent);
}

.new-btn {
  flex: 0 0 auto;
  width: 28px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  border-radius: 8px;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-secondary);
}

.new-btn:hover {
  border-color: var(--accent);
  color: var(--accent-deep);
}

/* ── 内容区 ── */
.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: 0 0 auto;
  margin-bottom: 12px;
}

.count {
  font-size: 12px;
  color: var(--text-secondary);
}

.error {
  color: var(--red);
  font-size: 13px;
  margin-bottom: 12px;
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
  gap: 6px;
}

.hint {
  color: var(--text-secondary);
  font-size: 12px;
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
  z-index: 200;
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
