<script setup lang="ts">
/**
 * 设置页（控制板唯一设置中心）
 *
 * 剪贴板/密码本/消息通知/快捷键全部集中在这里：
 *  - 剪贴板：历史保留、截图另存、导出格式
 *  - 快捷键：框选截图、控制板开关（录制组合键，冲突回滚由主进程完成）
 *  - 通用：开机自启、消息通知
 *  - 密码本：自动锁定
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppInfo, AppSettings } from '../../../shared/types'

const settings = ref<AppSettings | null>(null)
const appInfo = ref<AppInfo | null>(null)
const notifyEnabled = ref(true)
const autoLockMinutes = ref(5)
const petEnabled = ref(false)
const toast = ref('')
let toastTimer: number | undefined

// 快捷键录制
const recording = ref<null | 'screenshot' | 'panel'>(null)
const hint = ref('')

// 剪贴板字段
const retentionDays = ref(7)
const retentionEnabled = ref(true)
const screenshotDir = ref('')
const autoStart = ref(false)
const exportFormat = ref<'html' | 'pdf'>('html')

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2200)
}

async function reload(): Promise<void> {
  try {
    const [s, nv, vs, info] = await Promise.all([
      window.clipboardPlus.getSettings(),
      window.clipboardPlus.getSetting('panel.notify'),
      window.vaultApi.getSettings(),
      window.panelApi.getAppInfo()
    ])
    settings.value = s
    appInfo.value = info
    if (s) {
      retentionDays.value = s.retention_days
      retentionEnabled.value = s.retention_enabled
      screenshotDir.value = s.screenshot_dir
      autoStart.value = s.auto_start
      exportFormat.value = s.export_format
    }
    notifyEnabled.value = nv !== 'false'
    autoLockMinutes.value = vs.autoLockMinutes ?? 5
    petEnabled.value = await window.pet.getEnabled()
  } catch {
    // API 不可用
  }
}

// ── 快捷键录制 ──────────────────────────────────────────
function displayAccel(kind: 'screenshot' | 'panel'): string {
  const raw =
    settings.value?.[kind === 'screenshot' ? 'hotkey_screenshot' : 'hotkey_panel'] ?? ''
  return raw.replace('CommandOrControl', 'Ctrl')
}

function normalizeKey(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  if (/^F([1-9]|1[0-2])$/.test(key)) return key
  const map: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '\\': 'Backslash',
    '`': 'Backquote'
  }
  return map[key] ?? null
}

function startRecord(kind: 'screenshot' | 'panel'): void {
  if (recording.value) return
  recording.value = kind
  hint.value = '请按下新组合键（需含 Ctrl/Alt/Shift 至少一个）· Esc 取消'
}

function cancelRecord(): void {
  recording.value = null
  hint.value = ''
}

async function onKeydown(e: KeyboardEvent): Promise<void> {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    cancelRecord()
    return
  }
  const mods: string[] = []
  if (e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const key = normalizeKey(e.key)
  if (!key) {
    hint.value = '不支持的按键，请换一个'
    return
  }
  if (mods.length === 0) {
    hint.value = '组合键需要包含 Ctrl / Alt / Shift 至少一个'
    return
  }
  const kind = recording.value
  const accel = [...mods, key].join('+')
  cancelRecord()
  const res = await window.clipboardPlus.updateHotkey(kind, accel)
  if (res.ok) {
    showToast('快捷键已更新')
    await reload()
  } else {
    showToast(res.error ?? '快捷键更新失败')
  }
}

// ── 剪贴板设置 ──────────────────────────────────────────
async function saveRetention(): Promise<void> {
  await window.clipboardPlus.setSetting('retention_days', String(retentionDays.value))
  await window.clipboardPlus.setSetting('retention_enabled', String(retentionEnabled.value))
  showToast('历史保留设置已保存')
}

async function chooseScreenshotDir(): Promise<void> {
  const dir = await window.clipboardPlus.chooseDirectory()
  if (!dir) return
  screenshotDir.value = dir
  await window.clipboardPlus.setSetting('screenshot_dir', dir)
  showToast('截图另存目录已设置')
}

async function clearScreenshotDir(): Promise<void> {
  screenshotDir.value = ''
  await window.clipboardPlus.setSetting('screenshot_dir', '')
  showToast('已清除（截图不再另存）')
}

async function onExportFormat(v: 'html' | 'pdf'): Promise<void> {
  exportFormat.value = v
  await window.clipboardPlus.setSetting('export_format', v)
  showToast(v === 'pdf' ? '默认导出格式已设为 PDF' : '默认导出格式已设为 HTML')
}

// ── 通用 / 密码本 ────────────────────────────────────────
async function toggleAutoStart(): Promise<void> {
  const next = !autoStart.value
  const ok = await window.clipboardPlus.setAutoStart(next)
  if (ok) {
    autoStart.value = next
    showToast(next ? '已开启开机自启' : '已关闭开机自启')
  } else {
    showToast('设置失败')
  }
}

async function toggleNotify(): Promise<void> {
  notifyEnabled.value = !notifyEnabled.value
  await window.clipboardPlus.setSetting('panel.notify', String(notifyEnabled.value))
  showToast(notifyEnabled.value ? '已开启消息通知' : '已关闭消息通知')
}

async function togglePet(): Promise<void> {
  const next = !petEnabled.value
  const ok = await window.pet.setEnabled(next)
  if (ok) {
    petEnabled.value = next
    showToast(next ? '已显示桌宠' : '已隐藏桌宠')
  } else {
    showToast('操作失败')
  }
}

async function saveAutoLock(): Promise<void> {
  const res = await window.vaultApi.setAutoLock(autoLockMinutes.value)
  if (res.ok) showToast('已保存：闲置自动锁定')
  else showToast('保存失败')
}

// ── v1：通知测试 / 数据目录 ─────────────────────────────
async function testNotify(): Promise<void> {
  const res = await window.panelApi.notifyTest()
  showToast(res.ok ? '已发送测试通知，请查看系统通知区域' : '当前系统不支持通知')
}

async function openPath(target: 'clipboard' | 'userData' | 'logs' | 'vault'): Promise<void> {
  const res = await window.panelApi.openPath(target)
  if (!res.ok) showToast(res.error ?? '打开失败')
}

function shortPath(p: string | undefined): string {
  if (!p) return '—'
  return p.length > 46 ? `…${p.slice(-45)}` : p
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await reload()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="set-page">
    <div v-if="!settings" class="empty">正在加载…</div>

    <template v-else>
      <!-- 剪贴板 -->
      <div class="group">
        <div class="group-t">剪贴板</div>
        <div class="row">
          <div>
            <div class="t">历史保留天数</div>
            <div class="d">过期自动清理，收藏除外</div>
          </div>
          <div class="ctrl">
            <input v-model.number="retentionDays" type="number" min="1" max="365" class="num" />
            <span class="unit">天</span>
            <button class="btn-save" @click="saveRetention">保存</button>
          </div>
        </div>
        <div class="row">
          <label class="check">
            <input v-model="retentionEnabled" type="checkbox" />
            自动清理过期历史（启动时 + 每小时检查）
          </label>
        </div>
        <div class="row">
          <div>
            <div class="t">截图另存路径</div>
            <div class="d">未设置则截图仅入剪贴板与历史</div>
          </div>
          <div class="ctrl path-ctrl">
            <span class="path" :title="screenshotDir">{{ screenshotDir || '未设置' }}</span>
            <button class="btn-ghost" @click="chooseScreenshotDir">选择目录</button>
            <button v-if="screenshotDir" class="btn-ghost" @click="clearScreenshotDir">清除</button>
          </div>
        </div>
        <div class="row">
          <div>
            <div class="t">默认导出格式</div>
            <div class="d">历史记录导出时的默认格式</div>
          </div>
          <div class="ctrl">
            <label class="radio">
              <input v-model="exportFormat" type="radio" value="html" @change="onExportFormat('html')" />
              HTML
            </label>
            <label class="radio">
              <input v-model="exportFormat" type="radio" value="pdf" @change="onExportFormat('pdf')" />
              PDF
            </label>
          </div>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="group">
        <div class="group-t">快捷键</div>
        <div class="row">
          <div>
            <div class="t">框选截图</div>
            <div class="d">截图自动进入剪贴板历史</div>
          </div>
          <div class="ctrl">
            <button
              class="key-btn"
              :class="{ recording: recording === 'screenshot' }"
              @click="startRecord('screenshot')"
            >
              {{ recording === 'screenshot' ? '请按组合键…' : displayAccel('screenshot') }}
            </button>
          </div>
        </div>
        <div class="row">
          <div>
            <div class="t">控制板开关</div>
            <div class="d">显示 / 隐藏控制板</div>
          </div>
          <div class="ctrl">
            <button
              class="key-btn"
              :class="{ recording: recording === 'panel' }"
              @click="startRecord('panel')"
            >
              {{ recording === 'panel' ? '请按组合键…' : displayAccel('panel') }}
            </button>
          </div>
        </div>
        <p v-if="hint" class="hint">{{ hint }}</p>
      </div>

      <!-- 通用 -->
      <div class="group">
        <div class="group-t">通用</div>
        <div class="row">
          <div>
            <div class="t">开机自启动</div>
            <div class="d">
              默认关闭。开启后登录 Windows 自动运行灵犀{{
                appInfo && !appInfo.isPackaged ? '（开发模式不写注册表，打包后生效）' : ''
              }}
            </div>
          </div>
          <div class="ctrl"><div class="sw" :class="{ on: autoStart }" @click="toggleAutoStart"></div></div>
        </div>
        <div class="row">
          <div>
            <div class="t">消息通知</div>
            <div class="d">收到新消息时弹 Windows 系统通知；桌宠气泡需在下方开启桌宠</div>
          </div>
          <div class="ctrl">
            <button class="btn-ghost" @click="testNotify">测试通知</button>
            <div class="sw" :class="{ on: notifyEnabled }" @click="toggleNotify"></div>
          </div>
        </div>
        <div class="row">
          <div>
            <div class="t">桌宠</div>
            <div class="d">显示桌面宠物（可选项，默认隐藏）</div>
          </div>
          <div class="ctrl"><div class="sw" :class="{ on: petEnabled }" @click="togglePet"></div></div>
        </div>
      </div>

      <!-- 密码本 -->
      <div class="group">
        <div class="group-t">密码本</div>
        <div class="row">
          <div>
            <div class="t">自动锁定</div>
            <div class="d">闲置后自动锁定保险库，保护账号密码</div>
          </div>
          <div class="ctrl">
            <input v-model.number="autoLockMinutes" type="number" min="1" max="120" class="num" />
            <span class="unit">分钟</span>
            <button class="btn-save" @click="saveAutoLock">保存</button>
          </div>
        </div>
      </div>

      <!-- 数据与备份 -->
      <div class="group">
        <div class="group-t">数据与备份</div>
        <div class="row">
          <div>
            <div class="t">剪贴板数据</div>
            <div class="d" :title="appInfo?.clipboardDataPath">数据库 + 图片：{{ shortPath(appInfo?.clipboardDataPath) }}</div>
          </div>
          <div class="ctrl">
            <button class="btn-ghost" @click="openPath('clipboard')">打开目录</button>
          </div>
        </div>
        <div class="row">
          <div>
            <div class="t">应用数据</div>
            <div class="d" :title="appInfo?.userDataPath">配置 + 保险库 + 消息：{{ shortPath(appInfo?.userDataPath) }}</div>
          </div>
          <div class="ctrl">
            <button class="btn-ghost" @click="openPath('userData')">打开目录</button>
            <button class="btn-ghost" @click="openPath('vault')">保险库目录</button>
          </div>
        </div>
        <div class="row">
          <div>
            <div class="t">运行日志</div>
            <div class="d" :title="appInfo?.logPath">排障用：{{ shortPath(appInfo?.logPath) }}</div>
          </div>
          <div class="ctrl">
            <button class="btn-ghost" @click="openPath('logs')">打开目录</button>
          </div>
        </div>
        <div class="hint">
          备份：退出灵犀后复制以上两个目录即可完整备份；密码本另可在「密码本 → 设置 → 导出加密备份」单独备份库文件。
        </div>
      </div>

      <!-- 关于 -->
      <div class="about">
        灵犀 v{{ appInfo?.version ?? '—' }} · 剪贴板 / 密码本 / 消息中枢 · 本地优先 · 数据不上传云端
      </div>
    </template>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.set-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 22px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
}

.group {
  background: #fff;
  border: 1px solid #ecedf1;
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
  flex: 0 0 auto;
  min-width: 0;
}

.group-t {
  font-size: 12px;
  color: #9aa3b5;
  padding: 12px 16px 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-top: 1px solid #f2f3f7;
  flex-wrap: wrap;
  min-width: 0;
}

.row:first-of-type {
  border-top: none;
}

.row > div:first-child {
  min-width: 0;
  flex: 1 1 180px;
}

.t {
  font-size: 13px;
  font-weight: 500;
}

.d {
  font-size: 11.5px;
  color: #9aa3b5;
  margin-top: 2px;
}

.ctrl {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.sw {
  width: 38px;
  height: 21px;
  border-radius: 11px;
  background: #d9dbe3;
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
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

.num {
  width: 64px;
  border: 1px solid #d9dbe3;
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  text-align: center;
}

.num:focus {
  border-color: #ff9a3c;
}

.unit {
  font-size: 12px;
  color: #6b7280;
}

.btn-save {
  border: none;
  background: #ff9a3c;
  color: #fff;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 12px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn-ghost {
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.btn-ghost:hover {
  border-color: #ff9a3c;
}

.key-btn {
  font-family: inherit;
  font-size: 12.5px;
  border: 1px solid #d9dbe3;
  background: #fff;
  color: #4b5563;
  border-radius: 8px;
  padding: 6px 16px;
  min-width: 150px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.key-btn.recording {
  border-color: #ff9a3c;
  background: rgba(255, 154, 60, 0.12);
  color: #c2601a;
  font-weight: 600;
}

.hint {
  font-size: 12px;
  color: #c2601a;
  padding: 0 16px 12px;
}

.path {
  font-size: 11.5px;
  color: #6b7280;
  background: #f2f3f7;
  border-radius: 6px;
  padding: 4px 10px;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.path-ctrl {
  max-width: 100%;
}

.check {
  font-size: 12.5px;
  color: #1a1b1c;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.radio {
  font-size: 12.5px;
  color: #1a1b1c;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.empty {
  color: #9aa3b5;
  font-size: 13px;
  padding: 30px;
  text-align: center;
}

.about {
  text-align: center;
  color: #b0b6c2;
  font-size: 11.5px;
  padding: 10px 0 20px;
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

/* 窄窗口：设置行改为纵向堆叠，避免描述与控件挤压在同一行 */
@media (max-width: 640px) {
  .row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .row > div:first-child {
    flex: none;
    width: 100%;
  }

  .ctrl {
    margin-left: 0;
    width: 100%;
    justify-content: flex-end;
    align-items: center;
  }

  .path {
    max-width: 100%;
    flex: 1 1 auto;
  }
}
</style>
