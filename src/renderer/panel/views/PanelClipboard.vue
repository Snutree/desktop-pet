<script setup lang="ts">
/**
 * 剪贴板页：历史 / 收藏（设置已统一并入控制板"设置"页）
 *  - 复用独立剪贴板应用的两个视图
 *  - 宿主提供原 App.vue 的浅色主题变量，组件样式全部自带（scoped）
 */
import { ref } from 'vue'
import HistoryView from '../../clipboard/views/HistoryView.vue'
import FavoritesView from '../../clipboard/views/FavoritesView.vue'

type Tab = 'history' | 'favorites'
const tab = ref<Tab>('history')
</script>

<template>
  <div class="clip-host">
    <div class="clip-tabs">
      <button class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">历史</button>
      <button class="tab" :class="{ active: tab === 'favorites' }" @click="tab = 'favorites'">收藏</button>
    </div>
    <div class="clip-body">
      <HistoryView v-if="tab === 'history'" />
      <FavoritesView v-else />
    </div>
  </div>
</template>

<style>
.clip-host {
  /* 剪贴板全套浅色主题变量（原 App.vue :root 浅色部分） */
  --bg: #f4f3ee;
  --card: #ffffff;
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.16);
  --text: #1a1b1c;
  --text-secondary: #6b7280;
  --accent: #8bc8ea;
  --accent-bg: rgba(139, 200, 234, 0.25);
  --accent-deep: #1a5c7a;
  --accent-text: #14222b;
  --green-bg: rgba(148, 216, 195, 0.3);
  --green-deep: #1a6b52;
  --green-solid: #94d8c3;
  --red: #b02a2a;
  --red-border: rgba(234, 102, 104, 0.5);
  --red-solid: #ea6668;
  --red-bg: rgba(234, 102, 104, 0.12);
  --head-bg: rgba(0, 0, 0, 0.04);
  --input-bg: #ffffff;
  --toast-bg: rgba(26, 27, 28, 0.88);
  --toast-text: #ffffff;
  --overlay-bg: rgba(20, 22, 24, 0.85);

  height: 100%;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
}

.clip-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 14px 22px 0;
  background: var(--bg);
}

.clip-tabs .tab {
  border: 1px solid var(--border-strong);
  background: var(--card);
  border-radius: 8px;
  padding: 5px 18px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  color: var(--text-secondary);
}

.clip-tabs .tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.clip-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
