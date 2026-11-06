<script setup lang="ts">
/**
 * 设置弹窗：修改主密码 / 闲置自动锁定 / 导出备份 / 锁定
 */
import { ref, onMounted } from 'vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'locked'): void }>()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const autoLock = ref(0)
const busy = ref(false)
const error = ref('')
const info = ref('')

onMounted(async () => {
  const s = await window.vaultApi.getSettings()
  autoLock.value = s.autoLockMinutes
})

async function changePassword(): Promise<void> {
  error.value = ''
  if (!oldPassword.value || !newPassword.value) {
    error.value = '请填写旧密码与新密码'
    return
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  busy.value = true
  try {
    const r = await window.vaultApi.changePassword(oldPassword.value, newPassword.value)
    if (r.ok) {
      info.value = '主密码已更新'
      oldPassword.value = newPassword.value = confirmPassword.value = ''
      window.setTimeout(() => (info.value = ''), 2500)
    } else {
      error.value = r.error ?? '修改失败'
    }
  } finally {
    busy.value = false
  }
}

async function saveAutoLock(): Promise<void> {
  await window.vaultApi.setAutoLock(autoLock.value)
  info.value = '自动锁定设置已保存'
  window.setTimeout(() => (info.value = ''), 2000)
}

async function exportBackup(): Promise<void> {
  const r = await window.vaultApi.exportBackup()
  if (r.ok) {
    info.value = `已导出：${r.path}`
    window.setTimeout(() => (info.value = ''), 3000)
  } else if (!r.canceled) {
    error.value = r.error ?? '导出失败'
  }
}

async function lockNow(): Promise<void> {
  await window.vaultApi.lock()
  emit('locked')
}
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <div class="dialog">
      <h3>设置</h3>

      <section>
        <label>修改主密码</label>
        <input v-model="oldPassword" type="password" placeholder="当前主密码" />
        <input v-model="newPassword" type="password" placeholder="新主密码（至少 4 位）" />
        <input v-model="confirmPassword" type="password" placeholder="再次输入新主密码" />
        <button class="btn btn-primary full" :disabled="busy" @click="changePassword">
          {{ busy ? '处理中…' : '更新主密码' }}
        </button>
      </section>

      <section>
        <label>闲置自动锁定</label>
        <div class="row">
          <select v-model.number="autoLock">
            <option :value="0">不自动锁定</option>
            <option :value="1">1 分钟</option>
            <option :value="5">5 分钟</option>
            <option :value="15">15 分钟</option>
            <option :value="30">30 分钟</option>
          </select>
          <button class="btn" @click="saveAutoLock">保存</button>
        </div>
      </section>

      <section>
        <label>数据</label>
        <div class="row">
          <button class="btn" @click="exportBackup">导出加密备份…</button>
          <button class="btn btn-danger" @click="lockNow">立即锁定</button>
        </div>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="info" class="info">{{ info }}</p>

      <div class="foot">
        <div class="spacer"></div>
        <button class="btn" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 24, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
}

.dialog {
  width: 420px;
  background: var(--card);
  border-radius: 14px;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.28);
  max-height: 90vh;
  overflow-y: auto;
}

h3 {
  margin-bottom: 6px;
}

section {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

label {
  font-size: 11.5px;
  color: var(--text2);
}

input,
select {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
  background: #fff;
  width: 100%;
}

input:focus,
select:focus {
  border-color: var(--accent);
}

.full {
  width: 100%;
  padding: 9px;
}

.row {
  display: flex;
  gap: 10px;
}

.row select {
  flex: 1;
}

.error {
  color: var(--danger);
  font-size: 12px;
}

.info {
  color: var(--ok);
  font-size: 12px;
  word-break: break-all;
}

.foot {
  display: flex;
  margin-top: 8px;
}

.spacer {
  flex: 1;
}
</style>
