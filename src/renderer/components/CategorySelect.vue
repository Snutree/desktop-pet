<script setup lang="ts">
/**
 * 共享分类下拉选择（v1.1）
 *  - 单选：启动中心分组、密码本分类
 *  - allowCreate 时支持输入新名称（由调用方决定是否真正创建）
 */
import { ref } from 'vue'

interface Option {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: Option[]
    placeholder?: string
    allowCreate?: boolean
    createLabel?: string
  }>(),
  {
    placeholder: '请选择',
    allowCreate: true,
    createLabel: '新建'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void
  (e: 'create', name: string): void
}>()

const creating = ref(false)
const newName = ref('')

function onChange(raw: string): void {
  const hit = props.options.find((o) => String(o.value) === raw)
  emit('update:modelValue', hit ? hit.value : raw)
}

function startCreate(): void {
  creating.value = true
  newName.value = ''
}

function submitCreate(): void {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  emit('create', name)
  creating.value = false
  newName.value = ''
}
</script>

<template>
  <div class="cselect">
    <select :value="String(modelValue)" class="cselect-select" @change="onChange(($event.target as HTMLSelectElement).value)">
      <option v-if="options.length === 0" value="">{{ placeholder }}</option>
      <option v-for="o in options" :key="String(o.value)" :value="String(o.value)">{{ o.label }}</option>
    </select>
    <button v-if="allowCreate && !creating" class="cselect-create" type="button" @click="startCreate">
      ＋ {{ createLabel }}
    </button>
    <template v-else-if="creating">
      <input
        v-model="newName"
        class="cselect-input"
        :placeholder="createLabel"
        @keydown.enter.prevent="submitCreate"
        @keydown.esc.prevent="creating = false"
        autofocus
      />
      <button class="cselect-create" type="button" @click="submitCreate">确定</button>
      <button class="cselect-create" type="button" @click="creating = false">取消</button>
    </template>
  </div>
</template>

<style scoped>
.cselect {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cselect-select {
  flex: 1;
  min-width: 120px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  color: var(--text, #1a1b1c);
  outline: none;
}

.cselect-select:focus {
  border-color: var(--accent, #e8a87c);
}

.cselect-create {
  border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.14));
  background: var(--input-bg, #fff);
  color: var(--text-secondary, #6b7280);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.cselect-create:hover {
  border-color: var(--accent, #e8a87c);
  color: var(--accent-deep, #b06a3a);
}

.cselect-input {
  flex: 1;
  min-width: 110px;
  border: 1px solid var(--accent, #e8a87c);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
</style>
