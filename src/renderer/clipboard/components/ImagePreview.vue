<script setup lang="ts">
/**
 * 图片大图预览弹层（阶段 3/4 通用）
 *  - 传入 image_path（相对 clipimg 协议根目录）
 *  - 点击遮罩或按 Esc 关闭
 *  - 加载失败时显示明确提示（不再静默空白）
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ imagePath: string | null }>()
const emit = defineEmits<{ close: [] }>()

const failed = ref(false)
const src = computed(() => (props.imagePath ? `clipimg://local/${props.imagePath}` : ''))

// 切换预览目标时重置失败状态
watch(
  () => props.imagePath,
  () => {
    failed.value = false
  }
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <img v-if="src && !failed" :src="src" class="full" alt="图片原图" @error="failed = true" />
    <p v-else class="missing">{{ failed ? '图片加载失败：文件可能已被清理' : '图片文件不存在' }}</p>
    <button class="close" title="关闭（Esc）" @click="emit('close')">✕</button>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.full {
  max-width: 92vw;
  max-height: 88vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}

.missing {
  color: #e5e7eb;
  font-size: 14px;
}

.close {
  position: fixed;
  top: 18px;
  right: 22px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

.close:hover {
  background: rgba(255, 255, 255, 0.26);
}
</style>
