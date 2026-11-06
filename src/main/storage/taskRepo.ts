/**
 * 任务追踪数据访问层（v5）
 *
 *  - task_statuses：自定义状态（预置：待处理/进行中/已完成/已取消，可增删改）
 *  - tasks：任务主体（标题/描述/来源/优先级/分类/链接/期望完成时间/状态）
 *  - task_progress_logs：进度备注时间线（含状态变更快照，不覆盖历史）
 *  - 删除状态时其下任务迁移到首个状态；至少保留一个状态
 */
import type Database from 'better-sqlite3'
import { getDb } from './db'
import type { TaskInput, TaskProgressLog, TaskRecord, TaskStatus } from '../../shared/types'

// ── 状态 ───────────────────────────────────────────────────

/** 状态列表（按排序升序） */
export function listTaskStatuses(): TaskStatus[] {
  return getDb()
    .prepare('SELECT * FROM task_statuses ORDER BY sort_order ASC, id ASC')
    .all() as TaskStatus[]
}

/** 新建状态；重名返回错误 */
export function addTaskStatus(
  name: string,
  color: string
): { ok: boolean; data?: TaskStatus; error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '状态名称不能为空' }
  const db = getDb()
  const dup = db.prepare('SELECT id FROM task_statuses WHERE name = ?').get(trimmed)
  if (dup) return { ok: false, error: '状态名称已存在' }
  const maxRow = db.prepare('SELECT MAX(sort_order) AS m FROM task_statuses').get() as {
    m: number | null
  }
  const info = db
    .prepare(
      'INSERT INTO task_statuses (name, color, sort_order, is_system, created_at) VALUES (?, ?, ?, 0, ?)'
    )
    .run(trimmed, color || '#8a94a6', (maxRow.m ?? 0) + 1, Date.now())
  const row = db
    .prepare('SELECT * FROM task_statuses WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as TaskStatus | undefined
  return row ? { ok: true, data: row } : { ok: false, error: '创建失败' }
}

/** 更新状态（名称/颜色/排序）；重名或为空返回错误 */
export function updateTaskStatus(
  id: number,
  patch: { name?: string; color?: string; sort_order?: number }
): { ok: boolean; error?: string } {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM task_statuses WHERE id = ?').get(id) as
    | TaskStatus
    | undefined
  if (!cur) return { ok: false, error: '状态不存在' }
  if (patch.name !== undefined) {
    const t = patch.name.trim()
    if (!t) return { ok: false, error: '状态名称不能为空' }
    const dup = db.prepare('SELECT id FROM task_statuses WHERE name = ? AND id != ?').get(t, id)
    if (dup) return { ok: false, error: '状态名称已存在' }
    db.prepare('UPDATE task_statuses SET name = ? WHERE id = ?').run(t, id)
  }
  if (patch.color !== undefined) {
    db.prepare('UPDATE task_statuses SET color = ? WHERE id = ?').run(patch.color, id)
  }
  if (patch.sort_order !== undefined) {
    db.prepare('UPDATE task_statuses SET sort_order = ? WHERE id = ?').run(patch.sort_order, id)
  }
  return { ok: true }
}

/** 删除状态；其下任务迁移到首个状态。至少保留一个状态 */
export function removeTaskStatus(id: number): { ok: boolean; error?: string } {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM task_statuses WHERE id = ?').get(id) as
    | TaskStatus
    | undefined
  if (!cur) return { ok: false, error: '状态不存在' }
  const all = listTaskStatuses()
  if (all.length <= 1) return { ok: false, error: '至少保留一个状态' }
  const fallback = all.find((s) => s.id !== id)!
  const tx = db.transaction((): void => {
    db.prepare('UPDATE tasks SET status_id = ? WHERE status_id = ?').run(fallback.id, id)
    db.prepare('DELETE FROM task_statuses WHERE id = ?').run(id)
  })
  tx()
  return { ok: true }
}

/** 首个状态（新建任务默认归属；兜底预置"待处理"） */
function firstStatusId(db: Database.Database): number {
  const row = db
    .prepare('SELECT id FROM task_statuses ORDER BY sort_order ASC, id ASC LIMIT 1')
    .get() as { id: number } | undefined
  if (row) return row.id
  const info = db
    .prepare(
      'INSERT INTO task_statuses (name, color, sort_order, is_system, created_at) VALUES (?, ?, ?, 1, ?)'
    )
    .run('待处理', '#8a94a6', 1, Date.now())
  return Number(info.lastInsertRowid)
}

// ── 任务 ───────────────────────────────────────────────────

const TASK_SELECT = `
  SELECT t.*, s.name AS status_name, s.color AS status_color
  FROM tasks t JOIN task_statuses s ON s.id = t.status_id`

/** 全部任务（按更新时间倒序） */
export function listTasks(): TaskRecord[] {
  return getDb()
    .prepare(`${TASK_SELECT} ORDER BY t.updated_at DESC, t.id DESC`)
    .all() as TaskRecord[]
}

/** 按 id 查询任务（含状态名/色） */
export function getTaskById(id: number): TaskRecord | undefined {
  return getDb().prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRecord | undefined
}

/** 新建任务；标题为空返回 null */
export function createTask(input: TaskInput): TaskRecord | null {
  const title = input.title.trim()
  if (!title) return null
  const db = getDb()
  const now = Date.now()
  const info = db
    .prepare(
      `INSERT INTO tasks
        (title, description, source_type, source_detail, priority,
         category, link, due_date, status_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description ?? null,
      input.source_type ?? 'internal',
      input.source_detail ?? null,
      input.priority ?? 'medium',
      input.category ?? null,
      input.link ?? null,
      input.due_date ?? null,
      input.status_id ?? firstStatusId(db),
      now,
      now
    )
  return getTaskById(Number(info.lastInsertRowid)) ?? null
}

/** 更新任务（仅更新传入字段）；任务不存在返回 null */
export function updateTask(id: number, patch: Partial<TaskInput>): TaskRecord | null {
  const db = getDb()
  const cur = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)
  if (!cur) return null

  const sets: string[] = []
  const vals: unknown[] = []
  const push = (col: string, v: unknown): void => {
    sets.push(`${col} = ?`)
    vals.push(v)
  }
  if (patch.title !== undefined) push('title', patch.title.trim() || '未命名任务')
  if (patch.description !== undefined) push('description', patch.description ?? null)
  if (patch.source_type !== undefined) push('source_type', patch.source_type)
  if (patch.source_detail !== undefined) push('source_detail', patch.source_detail ?? null)
  if (patch.priority !== undefined) push('priority', patch.priority)
  if (patch.category !== undefined) push('category', patch.category ?? null)
  if (patch.link !== undefined) push('link', patch.link ?? null)
  if (patch.due_date !== undefined) push('due_date', patch.due_date ?? null)
  if (patch.status_id !== undefined) push('status_id', patch.status_id)

  if (sets.length > 0) {
    push('updated_at', Date.now())
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  }
  return getTaskById(id) ?? null
}

/** 删除任务（进度日志级联删除） */
export function deleteTask(id: number): boolean {
  return getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0
}

/** 切换任务状态（记入进度时间线，可附备注） */
export function setTaskStatus(id: number, statusId: number, note?: string): TaskRecord | null {
  const db = getDb()
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)
  if (!task) return null
  const status = db.prepare('SELECT id FROM task_statuses WHERE id = ?').get(statusId)
  if (!status) return null
  const now = Date.now()
  const tx = db.transaction((): void => {
    db.prepare('UPDATE tasks SET status_id = ?, updated_at = ? WHERE id = ?').run(statusId, now, id)
    db.prepare(
      'INSERT INTO task_progress_logs (task_id, note, status_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, note ?? '', statusId, now)
  })
  tx()
  return getTaskById(id) ?? null
}

// ── 进度备注 ───────────────────────────────────────────────

/** 任务进度时间线（最新在前） */
export function listTaskLogs(taskId: number): TaskProgressLog[] {
  return getDb()
    .prepare(
      `SELECT l.*, s.name AS status_name, s.color AS status_color
       FROM task_progress_logs l LEFT JOIN task_statuses s ON s.id = l.status_id
       WHERE l.task_id = ? ORDER BY l.created_at DESC, l.id DESC`
    )
    .all(taskId) as TaskProgressLog[]
}

/** 追加进度备注（不改变状态） */
export function addTaskLog(taskId: number, note: string): TaskProgressLog | null {
  const trimmed = note.trim()
  if (!trimmed) return null
  const db = getDb()
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)
  if (!task) return null
  const now = Date.now()
  const info = db
    .prepare(
      'INSERT INTO task_progress_logs (task_id, note, status_id, created_at) VALUES (?, ?, NULL, ?)'
    )
    .run(taskId, trimmed, now)
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId)
  const row = db
    .prepare('SELECT * FROM task_progress_logs WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as TaskProgressLog | undefined
  return row ?? null
}
