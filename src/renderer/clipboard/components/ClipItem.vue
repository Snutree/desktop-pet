<script setup lang="ts">
/**
 * 单条剪贴记录（阶段 4）
 *  - 类型标识（文本/图片）
 *  - 内容预览：文本两行截断 / 图片缩略图（点击放大）
 *  - 复制时间（全部筛选时附带日期）
 *  - 【复制】【删除】【收藏】操作按钮
 */
import { ref } from 'vue'
import type { ClipRecord } from '../../../shared/types'

const props = defineProps<{
  record: ClipRecord
  showDate: boolean
}>()

const emit = defineEmits<{
  copy: [id: number]
  remove: [id: number]
  save: [id: number]
  preview: [record: ClipRecord]
}>()

/** 缩略图加载失败（文件被清理/协议被拦截时不再显示破图，改为可点击提示） */
const thumbFailed = ref(false)

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function textPreview(): string {
  const text = props.record.text_content ?? ''
  return text.length > 200 ? text.slice(0, 200) + '…' : text
}
</script>

<template>
  <li class="item">
    <span class="type" :class="record.content_type">
      {{ record.content_type === 'text' ? '文本' : '图片' }}
    </span>

    <div class="body">
      <template v-if="record.content_type === 'text'">
        <p class="text">{{ textPreview() }}</p>
      </template>
      <template v-else>
        <span
          v-if="thumbFailed"
          class="text thumb-fail"
          title="缩略图加载失败，点击尝试查看原图"
          @click="emit('preview', record)"
        >
          （缩略图加载失败）
        </span>
        <img
          v-else-if="record.thumbnail_path"
          class="thumb"
          :src="`clipimg://local/${record.thumbnail_path}`"
          alt="图片缩略图"
          @error="thumbFailed = true"
          @click="emit('preview', record)"
        />
        <span v-else class="text">（图片文件缺失）</span>
        <span v-if="record.image_width" class="meta">
          {{ record.image_width }}×{{ record.image_height }}
        </span>
      </template>
    </div>

    <div class="side">
      <span class="time">
        {{ showDate ? formatDate(record.created_at) + ' ' : '' }}{{ formatTime(record.created_at) }}
      </span>
      <div class="actions">
        <button class="btn primary" title="写回系统剪贴板" @click="emit('copy', record.id)">
          复制
        </button>
        <button
          class="btn star"
          :class="{ active: record.is_favorite === 1 }"
          :title="record.is_favorite === 1 ? '已保存到收藏，点击选择目录' : '保存到收藏目录'"
          @click="emit('save', record.id)"
        >
          {{ record.is_favorite === 1 ? '已保存' : '保存' }}
        </button>
        <button class="btn danger" title="删除该条记录" @click="emit('remove', record.id)">
          删除
        </button>
      </div>
    </div>
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

.meta {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.time {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
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

.btn.star {
  background: transparent;
  border-color: var(--green-deep);
  color: var(--green-deep);
}

.btn.star:hover {
  background: var(--green-bg);
}

.btn.star.active {
  background: var(--green-solid);
  border-color: var(--green-solid);
  color: var(--green-deep);
  font-weight: 600;
}

.btn.danger {
  background: transparent;
  border-color: var(--red-border);
  color: var(--red);
}

.btn.danger:hover {
  background: var(--red-bg);
}
</style>
