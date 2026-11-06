<script setup lang="ts">
/**
 * API 配置：第三方消息数据源连接器管理
 *  - 连接器列表（Webhook 接收地址自动生成，可复制）
 *  - 添加 / 删除 / 启用开关
 *  - 状态提示：本地端口 + 内网穿透说明
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DataSource } from '../../../shared/datahub'

const connectors = ref<DataSource[]>([])
const status = ref<{ port: number; running: boolean }>({ port: 0, running: false })

const showAdd = ref(false)
const name = ref('')
const kind = ref<'webhook' | 'poll'>('webhook')
const url = ref('')
const token = ref('')
const pollInterval = ref(60)
const method = ref<'GET' | 'POST'>('GET')
const requestHeaders = ref('')
const requestBody = ref('')
const saving = ref(false)
const toast = ref('')
let toastTimer: number | undefined
let unsubChanged: (() => void) | null = null
let unsubStatus: (() => void) | null = null

const webhookBase = computed(() => `http://127.0.0.1:${status.value.port}`)

function webhookUrl(c: DataSource): string {
  const t = c.token ? `?token=${c.token}` : ''
  return `${webhookBase.value}/webhook/${c.id}${t}`
}

async function refresh(): Promise<void> {
  try {
    const [cs, st] = await Promise.all([window.panelApi.listConnectors(), window.panelApi.getStatus()])
    connectors.value = cs
    status.value = st
  } catch {
    // API 不可用
  }
}

async function addConnector(): Promise<void> {
  if (!name.value.trim()) {
    showToast('请填写数据源名称')
    return
  }
  if (kind.value === 'poll' && !url.value.trim()) {
    showToast('轮询方式需要填写接口 URL')
    return
  }
  saving.value = true
  try {
    const res = await window.panelApi.addConnector({
      name: name.value.trim(),
      kind: kind.value,
      url: url.value.trim(),
      token: token.value.trim() || undefined,
      pollIntervalSec: kind.value === 'poll' ? pollInterval.value : undefined,
      method: kind.value === 'poll' ? method.value : undefined,
      requestHeaders: kind.value === 'poll' ? requestHeaders.value.trim() || undefined : undefined,
      requestBody: kind.value === 'poll' ? requestBody.value.trim() || undefined : undefined,
      enabled: true
    })
    if (res.ok) {
      name.value = ''
      url.value = ''
      token.value = ''
      requestHeaders.value = ''
      requestBody.value = ''
      method.value = 'GET'
      showAdd.value = false
      await refresh()
      showToast('数据源已添加')
    } else {
      showToast(res.error ?? '添加失败')
    }
  } finally {
    saving.value = false
  }
}

async function toggleConnector(c: DataSource): Promise<void> {
  await window.panelApi.updateConnector(c.id, { enabled: !c.enabled })
  await refresh()
}

async function removeConnector(c: DataSource): Promise<void> {
  await window.panelApi.deleteConnector(c.id)
  await refresh()
  showToast('已删除')
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制接收地址')
  } catch {
    showToast('复制失败')
  }
}

function showToast(t: string): void {
  toast.value = t
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2200)
}

onMounted(async () => {
  unsubChanged = window.panelApi.onConnectorsChanged(() => void refresh())
  unsubStatus = window.panelApi.onStatusChanged((s) => {
    status.value = s
  })
  await refresh()
})

onUnmounted(() => {
  unsubChanged?.()
  unsubStatus?.()
  window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="api-page">
    <div class="intro">
      <div class="intro-t">数据源连接器</div>
      <div class="intro-d">
        Webhook：把生成的地址给第三方，<b>POST 任意 JSON</b> 即可，字段会自动整理成消息；<br />
        轮询：填接口 URL（支持 GET / POST、自定义请求头与请求体），返回的任意 JSON 也会自动整理。
      </div>
    </div>

    <div class="status-bar">
      <span class="dot" :class="{ off: !status.running }"></span>
      <span v-if="status.running">
        本地 Webhook 服务运行中 · 端口 <b>{{ status.port }}</b>
        <span class="tunnel-hint">（仅监听 127.0.0.1；公网推送需内网穿透）</span>
      </span>
      <span v-else>Webhook 服务未启动（端口可能被占用；轮询数据源不受影响）</span>
    </div>

    <div v-if="connectors.length === 0" class="empty">
      <div class="empty-icon">🔌</div>
      <div>还没有数据源</div>
      <div class="empty-sub">点击右上角"添加数据源"，配置第一个消息来源</div>
    </div>

    <div v-else class="list">
      <div v-for="c in connectors" :key="c.id" class="conn">
        <div class="s" :class="{ on: c.enabled }">{{ c.kind === 'webhook' ? '🌐' : '⏱️' }}</div>
        <div class="info">
          <div class="name">
            {{ c.name }}
            <span class="kind-tag">{{ c.kind === 'webhook' ? 'Webhook 推送' : '定时轮询' }}</span>
          </div>
          <div v-if="c.kind === 'webhook'" class="addr">
            {{ webhookUrl(c) }}
            <button class="copy" @click="copyText(webhookUrl(c))">复制</button>
            <span class="addr-tip">POST 任意 JSON 即可</span>
          </div>
          <div v-else class="addr">
            {{ c.method ?? 'GET' }} {{ c.url }} · 每 {{ c.pollIntervalSec ?? 60 }}s
          </div>
          <div v-if="c.kind === 'poll' && c.requestBody" class="addr">请求体：{{ c.requestBody }}</div>
          <div v-if="c.kind === 'poll' && c.token" class="addr">Token：****{{ c.token.slice(-4) }}</div>
        </div>
        <div class="sw" :class="{ on: c.enabled }" @click="toggleConnector(c)"></div>
        <button class="del" title="删除" @click="removeConnector(c)">✕</button>
      </div>
    </div>

    <button v-if="!showAdd" class="add-btn" @click="showAdd = true">＋ 添加数据源</button>

    <div v-if="showAdd" class="add-card">
      <div class="row">
        <input v-model="name" placeholder="名称，如：公司官网 · 线索表单" />
      </div>
      <div class="row">
        <div class="kind-pick">
          <label :class="{ active: kind === 'webhook' }">
            <input v-model="kind" type="radio" value="webhook" /> Webhook（第三方推送）
          </label>
          <label :class="{ active: kind === 'poll' }">
            <input v-model="kind" type="radio" value="poll" /> 定时轮询
          </label>
        </div>
      </div>
      <div v-if="kind === 'webhook'" class="row">
        <input v-model="token" placeholder="鉴权 Token（可选，推送时校验 X-Token）" />
        <span class="tip">保存后生成接收地址；第三方 POST 任意 JSON 即可，字段自动整理</span>
      </div>
      <template v-else>
        <div class="row">
          <select v-model="method" class="method">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <input v-model="url" placeholder="接口 URL（返回 JSON）" />
          <input v-model.number="pollInterval" type="number" min="10" placeholder="间隔（秒）" class="interval" />
        </div>
        <div class="row">
          <textarea
            v-model="requestHeaders"
            class="json-input"
            rows="2"
            placeholder='自定义请求头（可选，JSON），如 {"X-Api-Key":"xxx"}'
          ></textarea>
        </div>
        <div v-if="method === 'POST'" class="row">
          <textarea
            v-model="requestBody"
            class="json-input"
            rows="3"
            placeholder='POST 请求体（可选，JSON），如 {"page":1,"size":20}'
          ></textarea>
        </div>
      </template>
      <div class="row btns">
        <button class="save" :disabled="saving" @click="addConnector">保存配置</button>
        <button class="cancel" @click="showAdd = false">取消</button>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.api-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px 22px;
  box-sizing: border-box;
  overflow-y: auto;
}

.intro-t {
  font-size: 15px;
  font-weight: 600;
}

.intro-d {
  font-size: 12px;
  color: #9aa3b5;
  margin-top: 3px;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #4b5563;
  background: #fff;
  border: 1px solid #ecedf1;
  border-radius: 10px;
  padding: 10px 14px;
  margin: 12px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #52c41a;
  display: inline-block;
}

.dot.off {
  background: #ea6668;
}

.tunnel-hint {
  color: #b0b6c2;
  font-size: 11.5px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conn {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  border: 1px solid #ecedf1;
  border-radius: 12px;
  padding: 12px 16px;
}

.conn .s {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: #f2f3f7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  flex: 0 0 auto;
}

.conn .s.on {
  background: rgba(82, 196, 26, 0.12);
}

.conn .info {
  flex: 1;
  min-width: 0;
}

.conn .name {
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.kind-tag {
  font-size: 10.5px;
  background: rgba(139, 200, 234, 0.2);
  color: #1a5c7a;
  border-radius: 5px;
  padding: 1px 7px;
  font-weight: 500;
}

.conn .addr {
  font-size: 11.5px;
  color: #6b7280;
  margin-top: 3px;
  font-family: Consolas, 'Courier New', monospace;
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy {
  border: 1px solid #d9dbe3;
  background: #f7f8fa;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  color: #4b5563;
}

.copy:hover {
  border-color: #ff9a3c;
}

.sw {
  width: 38px;
  height: 21px;
  border-radius: 11px;
  background: #d9dbe3;
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  flex: 0 0 auto;
}

.sw::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.sw.on {
  background: #52c41a;
}

.sw.on::after {
  left: 19px;
}

.del {
  border: none;
  background: transparent;
  color: #b0b6c2;
  font-size: 14px;
  cursor: pointer;
  padding: 6px;
}

.del:hover {
  color: #ea6668;
}

.add-btn {
  margin-top: 12px;
  border: 1.5px dashed #d9dbe3;
  background: transparent;
  border-radius: 12px;
  padding: 13px;
  font-size: 13px;
  font-family: inherit;
  color: #6b7280;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.add-btn:hover {
  border-color: #ff9a3c;
  color: #c2601a;
}

.add-card {
  margin-top: 12px;
  border: 1.5px dashed #d9dbe3;
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
}

.row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.row input {
  flex: 1;
  min-width: 180px;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}

.row input:focus {
  border-color: #ff9a3c;
}

.row .interval {
  flex: 0 0 110px;
}

.row .method {
  flex: 0 0 92px;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  font-family: inherit;
  background: #fff;
  color: #1a1b1c;
  outline: none;
}

.row .json-input {
  flex: 1;
  width: 100%;
  min-width: 260px;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-family: Consolas, 'Courier New', monospace;
  color: #1a1b1c;
  resize: vertical;
  outline: none;
  background: #fff;
}

.row .json-input:focus,
.row .method:focus {
  border-color: #ff9a3c;
}

.addr-tip {
  color: #b0b6c2;
  font-size: 11px;
  font-family: inherit;
}

.kind-pick {
  display: flex;
  gap: 14px;
  font-size: 12.5px;
}

.kind-pick label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid #d9dbe3;
  border-radius: 8px;
  cursor: pointer;
  color: #4b5563;
}

.kind-pick label.active {
  border-color: #ff9a3c;
  background: rgba(255, 154, 60, 0.1);
  color: #c2601a;
}

.tip {
  font-size: 11.5px;
  color: #b0b6c2;
}

.btns {
  justify-content: flex-end;
}

.save {
  border: none;
  background: #ff9a3c;
  color: #fff;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 12.5px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.save:hover {
  filter: brightness(1.06);
}

.cancel {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #9aa3b5;
  font-size: 14px;
  gap: 6px;
  padding: 30px 0;
}

.empty-icon {
  font-size: 40px;
}

.empty-sub {
  font-size: 12px;
  color: #b0b6c2;
}

.toast {
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
