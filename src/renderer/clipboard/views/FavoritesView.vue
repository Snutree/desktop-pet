<script setup lang="ts">
/**
 * 收藏面板（v1.1）
 *  - 左侧目录列表（共享 CategoryNav，可重命名）
 *  - 右侧该目录内容；目录内可拖拽排序
 *  - 移出目录：若收藏只属于当前目录，弹窗选择"移动到其他目录 / 直接删除 / 取消"
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FavoriteWithCategories } from '../../../shared/types'
import FavoriteItem from '../components/FavoriteItem.vue'
import ImagePreview from '../components/ImagePreview.vue'
import CategoryNav from '../../components/CategoryNav.vue'
import MoveToCategoryDialog from '../../components/MoveToCategoryDialog.vue'
import { useDragSort } from '../../composables/useDragSort'

const favorites = ref<FavoriteWithCategories[]>([])
const categories = ref<{ id: number; name: string; is_default: number; created_at: number }[]>([])
const activeCatId = ref<number | null>(null)
const loading = ref(true)
const error = ref('')
const previewImage = ref<string | null>(null)
const toast = ref('')
let toastTimer: number | undefined

const moveTarget = ref<{ id: number; label: string } | null>(null)

const activeCatName = computed(
  () => categories.value.find((c) => c.id === activeCatId.value)?.name ?? ''
)

const navItems = computed(() =>
  categories.value.map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.is_default === 1
  }))
)

const { draggingId, onDragStart, onDragOver, onDrop, onDragEnd } = useDragSort(
  () => favorites.value,
  async (orderedIds) => {
    if (activeCatId.value == null) return
    await window.clipboardPlus.reorderFavorites(activeCatId.value, orderedIds)
    await loadFavorites()
  }
)

function showToast(msg: string, duration = 1600): void {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, duration)
}

async function loadCategories(): Promise<void> {
  categories.value = await window.clipboardPlus.listCategories()
  if (!activeCatId.value || !categories.value.some((c) => c.id === activeCatId.value)) {
    activeCatId.value = categories.value[0]?.id ?? null
  }
}

async function loadFavorites(): Promise<void> {
  favorites.value =
    activeCatId.value != null
      ? await window.clipboardPlus.listFavoritesByCategory(activeCatId.value)
      : []
}

async function reload(): Promise<void> {
  try {
    await loadCategories()
    await loadFavorites()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectCat(id: string | number): Promise<void> {
  activeCatId.value = Number(id)
  try {
    await loadFavorites()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function addCategory(name: string): Promise<void> {
  const cat = await window.clipboardPlus.addCategory(name)
  if (!cat) {
    showToast('目录名已存在或无效')
    return
  }
  await loadCategories()
  await selectCat(cat.id)
  showToast('目录已创建')
}

async function renameCategory(id: string | number, name: string): Promise<void> {
  const res = await window.clipboardPlus.renameCategory(Number(id), name)
  if (!res.ok) {
    showToast(res.error ?? '重命名失败')
    return
  }
  await loadCategories()
  showToast('目录已重命名')
}

async function removeCategory(id: string | number): Promise<void> {
  const cat = categories.value.find((c) => c.id === Number(id))
  if (!cat) return
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

/**
 * 移出目录：
 *  - 收藏还在其他目录 → 直接移出当前目录
 *  - 只属于当前目录 → 弹窗选择移动目标 / 直接删除 / 取消
 */
async function onRemoveFromCategory(favoriteId: number): Promise<void> {
  if (activeCatId.value == null) return
  const favorite = favorites.value.find((f) => f.id === favoriteId)
  const catIds = favorite?.categoryIds ?? []
  if (catIds.length > 1) {
    const ok = await window.clipboardPlus.removeFavoriteFromCategory(favoriteId, activeCatId.value)
    showToast(ok ? '已移出该目录' : '操作失败')
    await reload()
    return
  }
  const label = favorite?.text_content?.slice(0, 24) || '（图片收藏）'
  moveTarget.value = { id: favoriteId, label }
}

async function onMoveToCategories(categoryIds: number[]): Promise<void> {
  const target = moveTarget.value
  moveTarget.value = null
  if (!target || activeCatId.value == null) return
  const res = await window.clipboardPlus.moveFavoriteToCategories(
    target.id,
    activeCatId.value,
    categoryIds
  )
  showToast(res.ok ? '已移动到所选目录' : (res.error ?? '移动失败'))
  await reload()
}

async function onDeleteMovedFavorite(): Promise<void> {
  const target = moveTarget.value
  moveTarget.value = null
  if (!target) return
  const ok = await window.clipboardPlus.removeFavorite(target.id)
  showToast(ok ? '收藏已删除' : '删除失败')
  await reload()
}

async function onUpdate(id: number, patch: { text?: string; note?: string }): Promise<void> {
  const updated = await window.clipboardPlus.updateFavorite(id, patch)
  showToast(updated ? '已保存（所有目录同步生效）' : '保存失败')
  await reload()
}

const canDrag = computed(() => favorites.value.length > 1)

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
    <CategoryNav
      title="目录"
      :items="navItems"
      :active-id="activeCatId"
      allow-add
      add-placeholder="新建目录"
      allow-rename
      allow-delete
      :can-delete="(item) => !categories.find((c) => c.id === Number(item.id))?.is_default"
      @select="selectCat"
      @add="addCategory"
      @rename="renameCategory"
      @delete="removeCategory"
    />

    <!-- 内容区 -->
    <section class="content">
      <div class="toolbar">
        <span class="count">
          {{ activeCatName || '选择目录' }} · {{ favorites.length }} 条
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
          :class="{ dragging: draggingId === f.id }"
          :draggable="canDrag"
          @dragstart="onDragStart(f)"
          @dragover.prevent="onDragOver"
          @drop="onDrop(f)"
          @dragend="onDragEnd"
          @copy="onCopy"
          @remove="onRemoveFromCategory"
          @update="onUpdate"
          @preview="previewImage = $event"
        />
      </ul>
    </section>

    <ImagePreview v-if="previewImage" :image-path="previewImage" @close="previewImage = null" />

    <MoveToCategoryDialog
      v-if="moveTarget"
      :favorite-name="moveTarget.label"
      :categories="categories.map((c) => ({ id: c.id, name: c.name }))"
      :current-category-id="activeCatId ?? 0"
      @move="onMoveToCategories"
      @delete="onDeleteMovedFavorite"
      @cancel="moveTarget = null"
    />

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

.list :deep(li.dragging) {
  opacity: 0.55;
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
