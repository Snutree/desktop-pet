<script setup lang="ts">
/**
 * 共享左侧分类/分组导航（v1.1）
 *  - 用于剪贴板收藏目录、启动中心分组、密码本分类
 *  - 支持选中、新建、重命名（名称唯一性由调用方校验）、删除
 */
import { nextTick, ref } from 'vue'

export interface CategoryNavItem {
  id: string | number
  name: string
  count?: number
  isDefault?: boolean
  badge?: string
}

const props = withDefaults(
  defineProps<{
    title?: string
    items: CategoryNavItem[]
    activeId: string | number | null
    allowAdd?: boolean
    addPlaceholder?: string
    allowRename?: boolean
    allowDelete?: boolean
    canRename?: (item: CategoryNavItem) => boolean
    canDelete?: (item: CategoryNavItem) => boolean
    emptyText?: string
  }>(),
  {
    title: '目录',
    allowAdd: true,
    addPlaceholder: '新建',
    allowRename: true,
    allowDelete: true,
    emptyText: '暂无'
  }
)

const emit = defineEmits<{
  (e: 'select', id: string | number): void
  (e: 'add', name: string): void
  (e: 'rename', id: string | number, name: string): void
  (e: 'delete', id: string | number): void
}>()

const newName = ref('')
const editingId = ref<string | number | null>(null)
const editingName = ref('')
const editInput = ref<HTMLInputElement | null>(null)

function submitAdd(): void {
  const name = newName.value.trim()
  if (!name) return
  newName.value = ''
  emit('add', name)
}

function startRename(item: CategoryNavItem): void {
  editingId.value = item.id
  editingName.value = item.name
  nextTick(() => editInput.value?.focus())
}

function commitRename(): void {
  if (editingId.value == null) return
  const id = editingId.value
  const name = editingName.value.trim()
  editingId.value = null
  if (name) emit('rename', id, name)
}

function cancelRename(): void {
  editingId.value = null
}

function deletable(item: CategoryNavItem): boolean {
  if (!props.allowDelete) return false
  if (props.canDelete) return props.canDelete(item)
  return !item.isDefault
}

function renameable(item: CategoryNavItem): boolean {
  if (!props.allowRename) return false
  if (props.canRename) return props.canRename(item)
  return true
}
</script>

<template>
  <aside class="cnav">
    <div class="cnav-title">{{ title }}</div>
    <div class="cnav-list">
      <div
        v-for="item in items"
        :key="String(item.id)"
        class="cnav-item"
        :class="{ active: item.id === activeId }"
        @click="emit('select', item.id)"
      >
        <template v-if="editingId === item.id">
          <input
            ref="editInput"
            v-model="editingName"
            class="cnav-edit"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename"
          />
        </template>
        <template v-else>
          <span class="cnav-name" :title="item.name">{{ item.name }}</span>
          <em v-if="item.isDefault" class="cnav-def">默认</em>
          <em v-if="item.badge" class="cnav-badge">{{ item.badge }}</em>
          <span v-if="item.count !== undefined" class="cnav-count">{{ item.count }}</span>
          <span
            v-if="renameable(item)"
            class="cnav-act"
            title="重命名"
            @click.stop="startRename(item)"
          >
            ✎
          </span>
          <span
            v-if="deletable(item)"
            class="cnav-act danger"
            title="删除"
            @click.stop="emit('delete', item.id)"
          >
            ✕
          </span>
        </template>
      </div>
      <div v-if="items.length === 0" class="cnav-empty">{{ emptyText }}</div>
    </div>

    <div v-if="allowAdd" class="cnav-new">
      <input
        v-model="newName"
        class="cnav-input"
        :placeholder="addPlaceholder"
        @keydown.enter.prevent="submitAdd"
      />
      <button class="cnav-add" title="新建" @click="submitAdd">＋</button>
    </div>
  </aside>
</template>

<style scoped>
.cnav {
  flex: 0 0 168px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-right: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  padding-right: 12px;
  height: 100%;
  box-sizing: border-box;
}

.cnav-title {
  font-size: 11px;
  color: var(--text-secondary, var(--text2, #6b7280));
  letter-spacing: 1px;
}

.cnav-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cnav-item {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
  color: var(--text, #1a1b1c);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.cnav-item:hover {
  background: var(--head-bg, rgba(0, 0, 0, 0.04));
}

.cnav-item.active {
  background: var(--accent-bg, rgba(232, 168, 124, 0.18));
  border-color: var(--accent, #e8a87c);
  font-weight: 600;
}

.cnav-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cnav-def {
  font-style: normal;
  font-size: 10px;
  background: var(--accent, #e8a87c);
  color: #fff;
  border-radius: 5px;
  padding: 1px 5px;
  flex: 0 0 auto;
}

.cnav-badge {
  font-style: normal;
  font-size: 10px;
  color: var(--text-secondary, #6b7280);
  flex: 0 0 auto;
}

.cnav-count {
  font-size: 11px;
  opacity: 0.7;
  flex: 0 0 auto;
}

.cnav-act {
  color: var(--text-secondary, var(--text2, #6b7280));
  font-size: 11px;
  padding: 1px 3px;
  border-radius: 4px;
  visibility: hidden;
  flex: 0 0 auto;
}

.cnav-item:hover .cnav-act {
  visibility: visible;
}

.cnav-act:hover {
  background: var(--accent-bg, rgba(0, 0, 0, 0.06));
}

.cnav-act.danger:hover {
  color: var(--red, var(--danger, #b02a2a));
  background: var(--red-bg, rgba(234, 102, 104, 0.12));
}

.cnav-edit {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 12.5px;
  border: 1px solid var(--accent, #e8a87c);
  border-radius: 6px;
  padding: 3px 6px;
  outline: none;
  background: #fff;
  color: var(--text, #1a1b1c);
}

.cnav-empty {
  font-size: 12px;
  color: var(--text-secondary, var(--text2, #6b7280));
  text-align: center;
  padding: 16px 0;
}

.cnav-new {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.cnav-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: var(--input-bg, #fff);
  border-radius: 8px;
  padding: 6px 9px;
  color: var(--text, #1a1b1c);
  outline: none;
}

.cnav-input:focus {
  border-color: var(--accent, #e8a87c);
}

.cnav-add {
  flex: 0 0 auto;
  width: 28px;
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: var(--input-bg, #fff);
  border-radius: 8px;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
}

.cnav-add:hover {
  border-color: var(--accent, #e8a87c);
  color: var(--accent-deep, #b06a3a);
}
</style>
