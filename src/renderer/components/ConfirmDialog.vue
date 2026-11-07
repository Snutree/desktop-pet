<script setup lang="ts">
/** 共享确认弹窗（v1.1） */
withDefaults(
  defineProps<{
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
  }>(),
  { confirmText: '确定', cancelText: '取消', danger: false }
)

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()
</script>

<template>
  <div class="cd-overlay" @click.self="emit('cancel')">
    <div class="cd-dialog">
      <h3>{{ title }}</h3>
      <p class="cd-message">{{ message }}</p>
      <div class="cd-actions">
        <button class="cd-btn" @click="emit('cancel')">{{ cancelText }}</button>
        <button class="cd-btn" :class="{ danger }" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 24, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.cd-dialog {
  width: 380px;
  max-width: 88vw;
  background: var(--card, #fff);
  border-radius: 14px;
  padding: 22px 24px 18px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.26);
  color: var(--text, #1a1b1c);
}

.cd-dialog h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.cd-message {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, var(--text2, #6b7280));
  white-space: pre-wrap;
}

.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.cd-btn {
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: var(--card, #fff);
  color: var(--text, #1a1b1c);
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.cd-btn:hover {
  border-color: var(--accent, #e8a87c);
}

.cd-btn.danger {
  border-color: rgba(234, 102, 104, 0.6);
  background: var(--red-bg, rgba(234, 102, 104, 0.12));
  color: var(--red, var(--danger, #b02a2a));
}

.cd-btn.danger:hover {
  background: var(--red, #ea6668);
  color: #fff;
}
</style>
