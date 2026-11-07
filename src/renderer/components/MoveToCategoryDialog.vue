<script setup lang="ts">
/**
 * 剪贴板收藏"移出目录"弹窗（v1.1）
 *  - 收藏只属于当前目录时出现：可选择移动到其他目录（多选）、不移动直接删除、取消
 */
import { ref } from 'vue'

interface TargetCategory {
  id: number
  name: string
}

const props = defineProps<{
  favoriteName: string
  categories: TargetCategory[]
  currentCategoryId: number
}>()

const emit = defineEmits<{
  (e: 'move', categoryIds: number[]): void
  (e: 'delete'): void
  (e: 'cancel'): void
}>()

const selected = ref<number[]>([])

function toggle(id: number): void {
  const idx = selected.value.indexOf(id)
  if (idx >= 0) selected.value.splice(idx, 1)
  else selected.value.push(id)
}

const targets = (): TargetCategory[] =>
  props.categories.filter((c) => c.id !== props.currentCategoryId)
</script>

<template>
  <div class="mv-overlay" @click.self="emit('cancel')">
    <div class="mv-dialog">
      <h3>移出目录</h3>
      <p class="mv-desc">
        「{{ favoriteName }}」只属于当前目录。把它移动到其他目录，还是直接删除这条收藏？
      </p>

      <div v-if="targets().length > 0" class="mv-list">
        <label v-for="c in targets()" :key="c.id" class="mv-item">
          <input
            type="checkbox"
            :checked="selected.includes(c.id)"
            @change="toggle(c.id)"
          />
          <span>{{ c.name }}</span>
        </label>
      </div>
      <p v-else class="mv-empty">没有其他目录可移动。</p>

      <div class="mv-actions">
        <button class="mv-btn" @click="emit('cancel')">取消</button>
        <button
          class="mv-btn danger"
          :disabled="false"
          @click="emit('delete')"
        >
          不移动，删除收藏
        </button>
        <button
          class="mv-btn primary"
          :disabled="selected.length === 0"
          @click="emit('move', [...selected])"
        >
          移动到所选目录
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 24, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.mv-dialog {
  width: 420px;
  max-width: 90vw;
  background: var(--card, #fff);
  border-radius: 14px;
  padding: 22px 24px 18px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.26);
  color: var(--text, #1a1b1c);
}

.mv-dialog h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.mv-desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, var(--text2, #6b7280));
}

.mv-list {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.mv-empty {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.mv-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
  flex-wrap: wrap;
}

.mv-btn {
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: var(--card, #fff);
  color: var(--text, #1a1b1c);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.mv-btn:hover {
  border-color: var(--accent, #e8a87c);
}

.mv-btn.primary {
  background: var(--accent, #e8a87c);
  border-color: var(--accent, #e8a87c);
  color: #fff;
}

.mv-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mv-btn.danger {
  color: var(--red, var(--danger, #b02a2a));
  border-color: rgba(234, 102, 104, 0.6);
}
</style>
