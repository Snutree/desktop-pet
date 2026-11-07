/// <reference types="vite/client" />

import type { DataSource, HubMessage, PanelTab } from '../../shared/datahub'
import type {
  AppInfo,
  LauncherEntry,
  LauncherGroup,
  LauncherInput,
  TaskInput,
  TaskRecord,
  TaskStatus,
  TaskProgressLog
} from '../../shared/types'

declare global {
  interface Window {
    panelApi: {
      getStatus(): Promise<{ port: number; running: boolean }>
      listConnectors(): Promise<DataSource[]>
      addConnector(
        data: Omit<DataSource, 'id' | 'createdAt'>
      ): Promise<{ ok: boolean; data?: DataSource; error?: string }>
      updateConnector(
        id: string,
        patch: Partial<DataSource>
      ): Promise<{ ok: boolean; error?: string }>
      deleteConnector(id: string): Promise<{ ok: boolean }>
      listMessages(): Promise<HubMessage[]>
      markRead(id: string): Promise<{ ok: boolean }>
      markAllRead(): Promise<{ ok: boolean }>
      clearMessages(): Promise<{ ok: boolean }>
      pushTest(): Promise<{ ok: boolean }>
      onMessageNew(callback: (msg: HubMessage) => void): () => void
      onConnectorsChanged(callback: () => void): () => void
      onSwitchTab(callback: (tab: PanelTab) => void): () => void
      onStatusChanged(callback: (status: { port: number; running: boolean }) => void): () => void
      getAppInfo(): Promise<AppInfo>
      openPath(
        target: 'clipboard' | 'userData' | 'logs' | 'vault'
      ): Promise<{ ok: boolean; error?: string }>
      notifyTest(): Promise<{ ok: boolean }>
      listTaskStatuses(): Promise<TaskStatus[]>
      addTaskStatus(
        name: string,
        color: string
      ): Promise<{ ok: boolean; data?: TaskStatus; error?: string }>
      updateTaskStatus(
        id: number,
        patch: { name?: string; color?: string; sort_order?: number }
      ): Promise<{ ok: boolean; error?: string }>
      removeTaskStatus(id: number): Promise<{ ok: boolean; error?: string }>
      listTasks(): Promise<TaskRecord[]>
      createTask(input: TaskInput): Promise<TaskRecord | null>
      updateTask(id: number, patch: Partial<TaskInput>): Promise<TaskRecord | null>
      deleteTask(id: number): Promise<boolean>
      setTaskStatus(id: number, statusId: number, note?: string): Promise<TaskRecord | null>
      listTaskLogs(taskId: number): Promise<TaskProgressLog[]>
      addTaskLog(taskId: number, note: string): Promise<TaskProgressLog | null>
    }
    launcherApi: {
      listGroups(): Promise<LauncherGroup[]>
      addGroup(name: string): Promise<{ ok: boolean; data?: LauncherGroup; error?: string }>
      renameGroup(id: number, name: string): Promise<{ ok: boolean; error?: string }>
      deleteGroup(
        id: number
      ): Promise<{ ok: boolean; error?: string; deletedItems?: number }>
      listEntries(groupId?: number | null): Promise<LauncherEntry[]>
      addEntry(
        input: LauncherInput
      ): Promise<{ ok: boolean; data?: LauncherEntry; error?: string }>
      updateEntry(
        id: number,
        patch: Partial<LauncherInput>
      ): Promise<{ ok: boolean; data?: LauncherEntry; error?: string }>
      deleteEntry(id: number): Promise<boolean>
      reorderEntries(groupId: number, orderedIds: number[]): Promise<{ ok: boolean }>
      run(id: number, forceAdmin?: boolean): Promise<{ ok: boolean; error?: string }>
      chooseFile(): Promise<{
        ok?: boolean
        canceled?: boolean
        path?: string
        dir?: string
        name?: string
        ext?: string
      }>
      reveal(id: number): Promise<{ ok: boolean }>
    }
  }
}

export {}
