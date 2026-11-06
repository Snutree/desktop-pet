<script setup lang="ts">
/**
 * 密码本页：复用独立密码本应用（登录 ↔ 主界面）
 *  - 宿主提供原 App.vue 主题变量与 .btn 系列全局样式
 *  - 自动锁定事件 → 回登录界面
 */
import { ref, onMounted, onUnmounted } from 'vue'
import LoginView from '../../vault/components/LoginView.vue'
import MainView from '../../vault/components/MainView.vue'

const unlocked = ref(false)
const vaultPath = ref('')
let unsubscribe: (() => void) | null = null

function onUnlocked(path: string): void {
  vaultPath.value = path
  unlocked.value = true
}

function onLocked(): void {
  unlocked.value = false
}

onMounted(async () => {
  unsubscribe = window.vaultApi.onAutoLocked(() => onLocked())
  try {
    const state = await window.vaultApi.getState()
    if (state.unlocked) onUnlocked(state.path)
  } catch {
    // API 不可用
  }
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="vault-host">
    <LoginView v-if="!unlocked" @unlocked="onUnlocked" @locked="onLocked" />
    <MainView v-else :vault-path="vaultPath" @locked="onLocked" />
  </div>
</template>

<style>
.vault-host {
  /* 密码本全套主题变量（原 App.vue :root） */
  --bg: #f5f4ef;
  --card: #ffffff;
  --border: rgba(0, 0, 0, 0.08);
  --text: #1a1b1c;
  --text2: #6b7280;
  --accent: #e8a87c;
  --accent-deep: #b06a3a;
  --accent-bg: rgba(232, 168, 124, 0.18);
  --danger: #b02a2a;
  --danger-bg: rgba(234, 102, 104, 0.12);
  --ok: #1a6b52;
  --ok-bg: rgba(148, 216, 195, 0.22);

  height: 100%;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
}

.vault-host button {
  font-family: inherit;
  cursor: pointer;
}

/* 原 App.vue 全局按钮样式（组件依赖） */
.vault-host .btn {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}

.vault-host .btn:hover {
  border-color: var(--accent);
}

.vault-host .btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}

.vault-host .btn-primary:hover {
  filter: brightness(1.06);
}

.vault-host .btn-danger {
  color: var(--danger);
  border-color: rgba(234, 102, 104, 0.5);
}

.vault-host .btn.small {
  padding: 3px 10px;
  font-size: 12px;
}

.vault-host .btn.big {
  padding: 10px 22px;
  font-size: 14px;
}

.vault-host .btn.icon {
  padding: 4px 8px;
}

.vault-host .btn.link {
  border: none;
  background: transparent;
  color: var(--accent-deep);
  padding: 4px 8px;
}

.vault-host .btn.full {
  width: 100%;
}

.vault-host .toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(26, 27, 28, 0.9);
  color: #fff;
  font-size: 13px;
  padding: 9px 20px;
  border-radius: 999px;
  z-index: 1000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
</style>
