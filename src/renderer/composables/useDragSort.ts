/**
 * 通用拖拽排序（v1.1）
 *  - 只用于"组内条目排序"（分组/目录本身不排序）
 *  - 列表项需要 draggable + dragstart/dragover/drop/dragend 绑定
 */
import { ref, type Ref } from 'vue'

export interface DragItem {
  id: number | string
}

export function useDragSort<T extends DragItem>(
  getItems: () => T[],
  onReorder: (orderedIds: number[]) => void
): {
  draggingId: Ref<number | string | null>
  onDragStart: (item: T) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (target: T) => void
  onDragEnd: () => void
} {
  const draggingId = ref<number | string | null>(null)

  function onDragStart(item: T): void {
    draggingId.value = item.id
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault()
  }

  function onDrop(target: T): void {
    const sourceId = draggingId.value
    draggingId.value = null
    if (sourceId == null || sourceId === target.id) return
    const list = [...getItems()]
    const from = list.findIndex((i) => i.id === sourceId)
    const to = list.findIndex((i) => i.id === target.id)
    if (from < 0 || to < 0) return
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    onReorder(list.map((i) => Number(i.id)))
  }

  function onDragEnd(): void {
    draggingId.value = null
  }

  return { draggingId, onDragStart, onDragOver, onDrop, onDragEnd }
}
