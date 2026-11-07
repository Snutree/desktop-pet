<script setup lang="ts">
/**
 * 控制板外壳：深色侧栏 + 内容区（KeepAlive 保持各页状态）
 *  - 消息中心未读角标与消息页共用同一 store（单一数据源）
 *  - 支持外部（宠物菜单/托盘）切换到指定页
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { PanelTab } from '../../shared/datahub'
import type { AppInfo } from '../../shared/types'
import { messageStore } from './message-store'
import PanelClipboard from './views/PanelClipboard.vue'
import PanelVault from './views/PanelVault.vue'
import PanelMessages from './views/PanelMessages.vue'
import TaskTrackView from './views/TaskTrackView.vue'
import PanelLauncher from './views/PanelLauncher.vue'
import PanelApi from './views/PanelApi.vue'
import PanelSettings from './views/PanelSettings.vue'

const tab = ref<PanelTab>('clipboard')
const hubStatus = ref<{ port: number; running: boolean }>({ port: 0, running: false })
const appInfo = ref<AppInfo | null>(null)
/** 首启引导：提示可在设置中开启开机自启（默认关闭，尊重用户选择） */
const showFirstRunTip = ref(false)
let unsubStatus: (() => void) | null = null

const pages: Record<PanelTab, unknown> = {
  clipboard: PanelClipboard,
  vault: PanelVault,
  messages: PanelMessages,
  tasks: TaskTrackView,
  launcher: PanelLauncher,
  api: PanelApi,
  settings: PanelSettings
}
const currentPage = shallowRef(pages.clipboard)

const titles: Record<PanelTab, string> = {
  clipboard: '剪贴板',
  vault: '密码本',
  messages: '消息中心',
  tasks: '任务追踪',
  launcher: '启动中心',
  api: 'API 配置',
  settings: '设置'
}

const unreadCount = computed(() => messageStore.unreadCount.value)

let unsubMessage: (() => void) | null = null
let unsubSwitch: (() => void) | null = null

function switchTab(t: PanelTab): void {
  tab.value = t
  currentPage.value = pages[t]
}

async function dismissFirstRunTip(): Promise<void> {
  showFirstRunTip.value = false
  try {
    await window.clipboardPlus.setSetting('onboarding.done', 'true')
  } catch {
    /* 忽略 */
  }
}

async function openSettingsFromTip(): Promise<void> {
  switchTab('settings')
  await dismissFirstRunTip()
}

onMounted(async () => {
  unsubMessage = window.panelApi.onMessageNew(messageStore.onMessageNew)
  unsubSwitch = window.panelApi.onSwitchTab(switchTab)
  try {
    appInfo.value = await window.panelApi.getAppInfo()
    const onboardingDone = await window.clipboardPlus.getSetting('onboarding.done')
    showFirstRunTip.value = onboardingDone !== 'true'
    unsubStatus = window.panelApi.onStatusChanged((status) => {
      hubStatus.value = status
    })
    await messageStore.refresh()
    hubStatus.value = await window.panelApi.getStatus()
  } catch {
    // API 不可用时静默
  }
})

onUnmounted(() => {
  unsubMessage?.()
  unsubSwitch?.()
  unsubStatus?.()
})
</script>

<template>
  <div class="shell">
    <!-- 侧栏 -->
    <aside class="sidebar">
      <div class="pet-badge">
        <div class="pet-avatar">🦊</div>
        <div class="pet-name">
          灵犀<small>控制板 v{{ appInfo?.version ?? '—' }}</small>
        </div>
      </div>

      <div class="nav-label">工作台</div>
      <button class="nav-item" :class="{ active: tab === 'clipboard' }" @click="switchTab('clipboard')">
        <span class="icon">📋</span>剪贴板
      </button>
      <button class="nav-item" :class="{ active: tab === 'vault' }" @click="switchTab('vault')">
        <span class="icon">🔐</span>密码本
      </button>
      <button class="nav-item" :class="{ active: tab === 'messages' }" @click="switchTab('messages')">
        <span class="icon">💬</span>消息中心
        <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>
      </button>
      <button class="nav-item" :class="{ active: tab === 'tasks' }" @click="switchTab('tasks')">
        <span class="icon">✅</span>任务追踪
      </button>
      <button class="nav-item" :class="{ active: tab === 'launcher' }" @click="switchTab('launcher')">
        <span class="icon">⚡</span>启动中心
      </button>

      <div class="nav-label">系统</div>
      <button class="nav-item" :class="{ active: tab === 'api' }" @click="switchTab('api')">
        <span class="icon">🔌</span>API 配置
      </button>
      <button class="nav-item" :class="{ active: tab === 'settings' }" @click="switchTab('settings')">
        <span class="icon">⚙️</span>设置
      </button>

      <div class="sidebar-foot">
        <span><span class="dot" :class="{ off: !hubStatus.running }"></span>
          {{ hubStatus.running ? `Webhook :${hubStatus.port}` : '服务未启动' }}</span>
      </div>
    </aside>

    <!-- 内容区 -->
    <main class="content">
      <header class="topbar">
        <h1>{{ titles[tab] }}</h1>
        <span class="hint">宠物右键菜单 / 托盘 Ctrl+Shift+V 可随时呼出</span>
      </header>

      <!-- 首启引导：开机自启默认关闭，只提示、不替用户做主 -->
      <div v-if="showFirstRunTip" class="onboarding">
        <span class="onboarding-icon">👋</span>
        <div class="onboarding-text">
          欢迎使用灵犀。开机自启默认关闭；如果需要开机自动运行，可在「设置 → 通用」中开启。
        </div>
        <button class="onboarding-btn" @click="openSettingsFromTip">去设置</button>
        <button class="onboarding-btn ghost" @click="dismissFirstRunTip">知道了</button>
      </div>
      <div class="page-host">
        <KeepAlive>
          <component :is="currentPage" />
        </KeepAlive>
      </div>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
}

body {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f2f3f7;
  color: #1a1b1c;
  user-select: none;
}

.shell {
  display: flex;
  height: 100%;
}

/* ── 侧栏 ── */
.sidebar {
  width: 216px;
  flex: 0 0 216px;
  background: #20242f;
  color: #9aa3b5;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.pet-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 12px;
}

.pet-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #ff9a3c;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

.pet-name {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.pet-name small {
  display: block;
  color: #7a8398;
  font-size: 11px;
  font-weight: 400;
}

.nav-label {
  font-size: 11px;
  color: #5c6577;
  padding: 10px 8px 6px;
  letter-spacing: 1px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13.5px;
  font-family: inherit;
  background: transparent;
  color: #9aa3b5;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  margin-bottom: 2px;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #dde2ec;
}

.nav-item.active {
  background: rgba(255, 154, 60, 0.16);
  color: #ffb36b;
  font-weight: 600;
}

.nav-item .icon {
  font-size: 17px;
  width: 22px;
  text-align: center;
}

.nav-item .badge {
  margin-left: auto;
  background: #ea6668;
  color: #fff;
  font-size: 10.5px;
  border-radius: 9px;
  padding: 1px 7px;
  font-weight: 600;
}

.sidebar-foot {
  margin-top: auto;
  padding: 10px 8px 2px;
  font-size: 11.5px;
  color: #5c6577;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52c41a;
  display: inline-block;
  margin-right: 5px;
}

.dot.off {
  background: #ea6668;
}

/* ── 内容区 ── */
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #f7f8fa;
}

.topbar {
  height: 52px;
  flex: 0 0 52px;
  background: #fff;
  border-bottom: 1px solid #ecedf1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 22px;
}

.topbar h1 {
  font-size: 16px;
  font-weight: 600;
}

.topbar .hint {
  margin-left: auto;
  font-size: 11.5px;
  color: #9aa3b5;
}

.onboarding {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 22px 0;
  padding: 10px 14px;
  background: rgba(255, 154, 60, 0.1);
  border: 1px solid rgba(255, 154, 60, 0.28);
  border-radius: 10px;
  font-size: 12.5px;
  color: #7a4a1e;
}

.onboarding-icon {
  font-size: 16px;
}

.onboarding-text {
  flex: 1;
  line-height: 1.5;
}

.onboarding-btn {
  flex: 0 0 auto;
  border: 1px solid #ff9a3c;
  background: #ff9a3c;
  color: #fff;
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.onboarding-btn.ghost {
  background: transparent;
  color: #b26b2a;
}

.page-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.page-host > * {
  height: 100%;
}
</style>
