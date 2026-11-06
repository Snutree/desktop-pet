<script setup lang="ts">
/**
 * 登录界面：检测库文件存在 → 解锁；不存在 → 引导（新建 / 打开已有库 / 从备份恢复）
 *
 * v1 闭环：换机/重装后不再"静默进入新建模式"（会让人误以为数据丢了），
 * 而是明确告诉用户"这台设备上没有找到保险库"，并给出三条路。
 */
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'unlocked', path: string): void
  (e: 'locked'): void
}>()

const MIN_PASSWORD_LEN = 6

const exists = ref(false)
const path = ref('')
const loading = ref(true)
const busy = ref(false)
const mode = ref<'welcome' | 'unlock' | 'create'>('unlock')
const password = ref('')
const confirm = ref('')
const error = ref('')

onMounted(async () => {
  try {
    const state = await window.vaultApi.getState()
    exists.value = state.exists
    path.value = state.path
    mode.value = state.exists ? 'unlock' : 'welcome'
  } catch {
    mode.value = 'welcome'
  } finally {
    loading.value = false
  }
})

async function submit(): Promise<void> {
  error.value = ''
  if (!password.value) {
    error.value = '请输入主密码'
    return
  }
  busy.value = true
  try {
    if (mode.value === 'create') {
      if (password.value.length < MIN_PASSWORD_LEN) {
        error.value = `主密码至少 ${MIN_PASSWORD_LEN} 位`
        return
      }
      if (password.value !== confirm.value) {
        error.value = '两次输入的密码不一致'
        return
      }
      const r = await window.vaultApi.create(password.value)
      if (r.ok) {
        emit('unlocked', r.path ?? '')
      } else {
        error.value = r.error ?? '创建失败'
      }
    } else {
      const r = await window.vaultApi.unlock(password.value)
      if (r.ok) {
        emit('unlocked', path.value)
      } else {
        error.value = r.error ?? '解锁失败'
      }
    }
  } finally {
    busy.value = false
  }
}

/** 打开其他库文件 / 从备份恢复（主进程弹文件选择，选择后进入解锁态） */
async function openOther(): Promise<void> {
  error.value = ''
  const r = await window.vaultApi.openFile()
  if (r.ok) {
    path.value = r.path ?? ''
    exists.value = true
    mode.value = 'unlock'
    password.value = ''
  } else if (!r.canceled) {
    error.value = r.error ?? '打开失败'
  }
}

/** 新建到指定位置 */
async function createNewFile(): Promise<void> {
  error.value = ''
  const r = await window.vaultApi.createFile()
  if (r.ok) {
    path.value = r.path ?? ''
    exists.value = false
    password.value = ''
    confirm.value = ''
    mode.value = 'create'
  } else if (!r.canceled) {
    error.value = r.error ?? '新建失败'
  }
}

/** 在默认位置新建（userData/vault.pvlt） */
function startCreate(): void {
  error.value = ''
  password.value = ''
  confirm.value = ''
  mode.value = 'create'
}

function backToWelcome(): void {
  error.value = ''
  mode.value = exists.value ? 'unlock' : 'welcome'
}
</script>

<template>
  <div class="login">
    <div class="card">
      <div class="logo">🔐</div>
      <h1>密码本</h1>

      <div v-if="loading" class="loading">读取保险库…</div>

      <!-- 本机没有保险库：明确引导，不擅自新建 -->
      <template v-else-if="mode === 'welcome'">
        <p class="sub">这台设备上还没有找到保险库</p>
        <p class="hint-block">
          如果这是新电脑：把旧电脑导出的 <b>vault.pvlt</b> 拷过来，点「打开已有库」并输入主密码即可。
        </p>
        <button class="btn btn-primary big" @click="startCreate">新建加密保险库</button>
        <button class="btn big" @click="openOther">打开已有库 / 从备份恢复…</button>
        <button class="btn link" @click="createNewFile">新建到指定位置…</button>
        <p class="hint">
          主密码不会保存，遗忘后无法恢复；数据以 AES-256-GCM 整体加密，只存本地。
        </p>
      </template>

      <!-- 已有保险库：解锁 -->
      <template v-else-if="mode === 'unlock'">
        <p class="sub">解锁加密保险库</p>
        <p v-if="exists" class="file" :title="path">{{ path }}</p>
        <input
          v-model="password"
          type="password"
          placeholder="输入主密码"
          @keyup.enter="submit"
          autofocus
        />
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn btn-primary big" :disabled="busy" @click="submit">
          {{ busy ? '处理中…' : '解锁' }}
        </button>
        <div class="row">
          <button class="btn link" @click="openOther">打开其他库…</button>
          <button class="btn link" @click="createNewFile">新建到指定位置…</button>
        </div>
        <p class="hint">主密码不会保存，遗忘后将无法恢复。数据以 AES-256-GCM 整体加密存储于本地。</p>
      </template>

      <!-- 新建 -->
      <template v-else>
        <p class="sub">创建新的加密保险库</p>
        <p v-if="path" class="file" :title="path">{{ path }}</p>
        <input
          v-model="password"
          type="password"
          :placeholder="`设置主密码（至少 ${MIN_PASSWORD_LEN} 位）`"
          @keyup.enter="submit"
          autofocus
        />
        <input v-model="confirm" type="password" placeholder="再次输入主密码" @keyup.enter="submit" />
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn btn-primary big" :disabled="busy" @click="submit">
          {{ busy ? '处理中…' : '创建并解锁' }}
        </button>
        <div class="row">
          <button class="btn link" @click="backToWelcome">返回</button>
          <button class="btn link" @click="createNewFile">换个位置…</button>
        </div>
        <p class="hint">主密码至少 6 位；遗忘后无法恢复，请务必记牢或导出备份。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #f5f4ef 0%, #f0e6da 100%);
}

.card {
  width: 400px;
  background: var(--card);
  border-radius: 16px;
  padding: 34px 32px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.logo {
  font-size: 40px;
  text-align: center;
}

h1 {
  text-align: center;
  font-size: 22px;
}

.sub {
  text-align: center;
  color: var(--text2);
  font-size: 13px;
}

.file {
  text-align: center;
  color: var(--text2);
  font-size: 11px;
  word-break: break-all;
  background: var(--bg);
  border-radius: 6px;
  padding: 6px 10px;
}

.hint-block {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text2);
  background: var(--bg);
  border-radius: 8px;
  padding: 10px 12px;
}

.loading {
  text-align: center;
  color: var(--text2);
  padding: 24px 0;
}

input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
  background: #fff;
}

input:focus {
  border-color: var(--accent);
}

.error {
  color: var(--danger);
  font-size: 12px;
}

.big {
  padding: 11px;
  font-size: 14px;
}

.row {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.link {
  border: none;
  background: none;
  color: var(--accent-deep);
  font-size: 12px;
  padding: 4px;
}

.hint {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
}
</style>
