<script setup lang="ts">
/**
 * 单条收藏（阶段 4）
 *  - 复制 / 编辑 / 取消收藏
 *  - 编辑模式：文本可改内容 + 备注；图片仅改备注
 *  - 图片缩略图点击放大
 */
import { ref } from 'vue'
import type { FavoriteRecord } from '../../../shared/types'

const props = defineProps<{ favorite: FavoriteRecord }>()

const emit = defineEmits<{
  copy: [id: number]
  remove: [id: number]
  update: [id: number, patch: { text?: string; note?: string }]
  preview: [imagePath: string | null]
}>()

const editing = ref(false)
const editText = ref('')
const editNote = ref('')
/** 缩略图加载失败（文件被清理/协议被拦截时不再显示破图） */
const thumbFailed = ref(false)

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

function textPreview(): string {
  const text = props.favorite.text_content ?? ''
  return text.length > 200 ? text.slice(0, 200) + '…' : text
}

function startEdit(): void {
  editText.value = props.favorite.text_content ?? ''
  editNote.value = props.favorite.note ?? ''
  editing.value = true
}

function cancelEdit(): void {
  editing.value = false
}

function saveEdit(): void {
  const patch: { text?: string; note?: string } = {}
  if (props.favorite.content_type === 'text') patch.text = editText.value
  patch.note = editNote.value
  emit('update', props.favorite.id, patch)
  editing.value = false
}
</script>

<template>
  <li class="item">
    <span class="type" :class="favorite.content_type">
      {{ favorite.content_type === 'text' ? '文本' : '图片' }}
    </span>

    <!-- 编辑模式 -->
    <div v-if="editing" class="edit-body">
      <textarea
        v-if="favorite.content_type === 'text'"
        v-model="editText"
        class="edit-area"
        rows="3"
        placeholder="内容"
      ></textarea>
      <input v-model="editNote" class="edit-note" placeholder="备注（可选）" />
      <div class="actions">
        <button class="btn primary" @click="saveEdit">保存</button>
        <button class="btn ghost" @click="cancelEdit">取消</button>
      </div>
    </div>

    <!-- 展示模式 -->
    <template v-else>
      <div class="body">
        <template v-if="favorite.content_type === 'text'">
          <p class="text">{{ textPreview() }}</p>
        </template>
        <template v-else>
          <span
            v-if="thumbFailed"
            class="text thumb-fail"
            title="缩略图加载失败，点击尝试查看原图"
            @click="emit('preview', favorite.image_path)"
          >
            （缩略图加载失败）
          </span>
          <img
            v-else-if="favorite.thumbnail_path"
            class="thumb"
            :src="`clipimg://local/${favorite.thumbnail_path}`"
            alt="收藏图片"
            @error="thumbFailed = true"
            @click="emit('preview', favorite.image_path)"
          />
          <span v-else class="text">（图片文件缺失）</span>
        </template>
      </div>

      <div class="side">
        <span class="time">{{ formatTime(favorite.created_at) }}</span>
        <span v-if="favorite.note" class="note" :title="favorite.note">备注：{{ favorite.note }}</span>
        <div class="actions">
          <button class="btn primary" @click="emit('copy', favorite.id)">复制</button>
          <button class="btn ghost" @click="startEdit">编辑</button>
          <button class="btn danger" title="从当前目录移除（内容若不再属于任何目录则删除）" @click="emit('remove', favorite.id)">
            移出目录
          </button>
        </div>
      </div>
    </template>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
}

.type {
  flex-shrink: 0;
  font-size: 11px;
  border-radius: 6px;
  padding: 2px 8px;
}

.type.text {
  background: var(--accent-bg);
  color: var(--accent-deep);
}

.type.image {
  background: var(--green-bg);
  color: var(--green-deep);
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.text {
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.thumb {
  max-width: 84px;
  max-height: 56px;
  border-radius: 6px;
  border: 1px solid var(--border);
  object-fit: contain;
  cursor: zoom-in;
}

.thumb-fail {
  color: var(--red);
  cursor: pointer;
}

.side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.time {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.note {
  font-size: 11px;
  color: var(--accent-deep);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  gap: 6px;
}

.btn {
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  padding: 3px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn.primary {
  background: var(--accent);
  color: var(--accent-text);
}

.btn.primary:hover {
  filter: brightness(0.94);
}

.btn.ghost {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--text-secondary);
}

.btn.ghost:hover {
  background: var(--head-bg);
}

.btn.danger {
  background: transparent;
  border-color: var(--red-border);
  color: var(--red);
}

.btn.danger:hover {
  background: var(--red-bg);
}

.edit-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-area {
  width: 100%;
  font-family: inherit;
  font-size: 13px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  border-radius: 8px;
  padding: 8px 10px;
  resize: vertical;
  color: var(--text);
}

.edit-note {
  width: 100%;
  font-family: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  border-radius: 8px;
  padding: 6px 10px;
  color: var(--text);
}
</style>
