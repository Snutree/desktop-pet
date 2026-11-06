<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { ParticleBurst } from './effects'
import type { PetBubblePayload } from '@shared/ipc'
import petSrc from './assets/pet.svg'

const fxCanvas = ref<HTMLCanvasElement | null>(null)
const bubbleText = ref('')
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let burst: ParticleBurst | null = null
let dragging = false
let moved = false
let startX = 0
let startY = 0

onMounted(() => {
  if (fxCanvas.value) {
    burst = new ParticleBurst(fxCanvas.value)
  }
  // 订阅主进程推送的气泡（后续数据源通知入口）
  const off = window.pet.onBubble((payload: PetBubblePayload) => showBubble(payload.text, payload.durationMs))
  ;(window as unknown as { __offBubble?: () => void }).__offBubble = off
})

onBeforeUnmount(() => {
  burst?.destroy()
  const off = (window as unknown as { __offBubble?: () => void }).__offBubble
  off?.()
})

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  moved = false
  startX = e.screenX
  startY = e.screenY
  // 捕获指针：即使移出窗口也能收到 mouseup
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.pet.dragStart(e.screenX, e.screenY)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  if (Math.abs(e.screenX - startX) > 3 || Math.abs(e.screenY - startY) > 3) {
    moved = true
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging) return
  dragging = false
  window.pet.dragEnd()
  // 没有发生移动 → 视为点击，触发粒子特效
  if (!moved && burst) {
    burst.burst(e.clientX, e.clientY)
  }
}

function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
  window.pet.showContextMenu()
}

function showBubble(text: string, durationMs = 4000): void {
  bubbleText.value = text
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => {
    bubbleText.value = ''
  }, durationMs)
}
</script>

<template>
  <div class="pet-root">
    <div
      class="pet-stage"
      @pointerdown.left="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu="onContextMenu"
    >
      <img :src="petSrc" class="pet-img" alt="宠物" draggable="false" />
      <div v-if="bubbleText" class="bubble">{{ bubbleText }}</div>
    </div>
    <canvas ref="fxCanvas" class="fx-canvas"></canvas>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
  user-select: none;
}

.pet-root {
  position: relative;
  width: 100%;
  height: 100%;
  background: transparent;
  cursor: grab;
}

.pet-root:active {
  cursor: grabbing;
}

.pet-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  touch-action: none;
}

.pet-img {
  width: 200px;
  height: 260px;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.18));
  transform-origin: 50% 100%;
  animation: pet-breathe 3.2s ease-in-out infinite;
}

@keyframes pet-breathe {
  0%,
  100% {
    transform: scale(1, 1) translateY(0);
  }
  50% {
    transform: scale(1.02, 0.985) translateY(1.5px);
  }
}

.fx-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.bubble {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 180px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #f0d9c0;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #4a3728;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  z-index: 5;
}

.bubble::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border: 8px solid transparent;
  border-top-color: #fff;
  border-bottom: none;
}
</style>
