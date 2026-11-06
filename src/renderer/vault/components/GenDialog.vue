<script setup lang="ts">
/**
 * 密码生成器弹窗：长度 / 字符集 / 排除易混淆字符
 */
import { ref, computed } from 'vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'use', password: string): void }>()

const length = ref(16)
const useLower = ref(true)
const useUpper = ref(true)
const useDigit = ref(true)
const useSymbol = ref(true)
const avoidAmbiguous = ref(false)
const custom = ref('')
const result = ref('')
const error = ref('')
const generating = ref(false)
const copied = ref(false)

const strength = computed(() => {
  if (!result.value) return { label: '', color: '' }
  let pool = 0
  if (useLower.value) pool += 26
  if (useUpper.value) pool += 26
  if (useDigit.value) pool += 10
  if (useSymbol.value) pool += 28
  if (custom.value) pool += custom.value.length
  const bits = length.value * Math.log2(Math.max(pool, 1))
  if (bits < 50) return { label: '弱', color: '#b02a2a' }
  if (bits < 80) return { label: '中', color: '#b06a3a' }
  return { label: '强', color: '#1a6b52' }
})

async function generate(): Promise<void> {
  error.value = ''
  generating.value = true
  try {
    const r = await window.vaultApi.generate({
      length: length.value,
      use_lower: useLower.value,
      use_upper: useUpper.value,
      use_digit: useDigit.value,
      use_symbol: useSymbol.value,
      custom: custom.value,
      avoid_ambiguous: avoidAmbiguous.value
    })
    if (r.ok) {
      result.value = r.password ?? ''
      copied.value = false
    } else {
      error.value = r.error ?? '生成失败'
    }
  } finally {
    generating.value = false
  }
}

async function copy(): Promise<void> {
  if (!result.value) return
  await navigator.clipboard.writeText(result.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <div class="dialog">
      <h3>密码生成器</h3>

      <div class="result-row">
        <input v-model="result" readonly class="result" placeholder="点击下方按钮生成" />
        <span v-if="strength.label" class="strength" :style="{ color: strength.color }">
          {{ strength.label }}
        </span>
      </div>
      <div class="res-actions">
        <button class="btn btn-primary" :disabled="generating" @click="generate">
          {{ generating ? '生成中…' : '⚡ 生成密码' }}
        </button>
        <button v-if="result" class="btn" @click="copy">
          {{ copied ? '✓ 已复制' : '复制' }}
        </button>
        <button v-if="result" class="btn" @click="emit('use', result)">填入条目</button>
      </div>

      <label>长度</label>
      <div class="len-row">
        <input v-model.number="length" type="range" min="4" max="64" />
        <span class="len-val">{{ length }}</span>
      </div>

      <label>字符集</label>
      <div class="checks">
        <label class="check"><input v-model="useLower" type="checkbox" />小写 a-z</label>
        <label class="check"><input v-model="useUpper" type="checkbox" />大写 A-Z</label>
        <label class="check"><input v-model="useDigit" type="checkbox" />数字 0-9</label>
        <label class="check"><input v-model="useSymbol" type="checkbox" />符号 !@#…</label>
        <label class="check"><input v-model="avoidAmbiguous" type="checkbox" />排除易混淆 il1Lo0O</label>
      </div>

      <label>自定义字符集（可选）</label>
      <input v-model="custom" placeholder="如：@#$%&" />

      <p v-if="error" class="error">{{ error }}</p>

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
  z-index: 110;
}

.dialog {
  width: 440px;
  background: var(--card);
  border-radius: 14px;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.28);
}

h3 {
  margin-bottom: 8px;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.result {
  flex: 1;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 15px;
  letter-spacing: 0.5px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 11px 12px;
  text-align: center;
}

.strength {
  font-size: 13px;
  font-weight: 700;
  width: 28px;
  text-align: center;
}

.res-actions {
  display: flex;
  gap: 8px;
}

.res-actions .btn {
  flex: 1;
}

label {
  font-size: 11.5px;
  color: var(--text2);
  margin-top: 8px;
}

.len-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.len-row input {
  flex: 1;
  accent-color: var(--accent);
}

.len-val {
  font-size: 14px;
  font-weight: 700;
  width: 26px;
  text-align: center;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}

.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text);
  margin-top: 0;
  cursor: pointer;
}

.check input {
  accent-color: var(--accent);
}

.error {
  color: var(--danger);
  font-size: 12px;
}

.foot {
  display: flex;
  margin-top: 12px;
}

.spacer {
  flex: 1;
}
</style>
