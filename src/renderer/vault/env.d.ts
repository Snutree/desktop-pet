/// <reference types="vite/client" />

/** 密码本条目（与主进程 vault/database.ts 的 VaultEntry 一致） */
export interface VaultEntry {
  id: number
  name: string
  category: string
  account: string
  password: string
  url: string
  note: string
  created_at: string
  updated_at: string
}

/** 密码生成选项（与主进程 vault/generator.ts 的 GenerateOptions 一致） */
export interface GenerateOptions {
  length: number
  use_lower?: boolean
  use_upper?: boolean
  use_digit?: boolean
  use_symbol?: boolean
  custom?: string
  avoid_ambiguous?: boolean
}

declare global {
  interface Window {
    vaultApi: {
      getState(): Promise<{
        exists: boolean
        unlocked: boolean
        path: string
        entryCount: number
        autoLockMinutes: number
      }>
      create(password: string): Promise<{ ok: boolean; path?: string; error?: string }>
      unlock(password: string): Promise<{ ok: boolean; error?: string }>
      lock(): Promise<{ ok: boolean }>
      activity(): void
      search(keyword: string, category: string | null): Promise<VaultEntry[]>
      categories(): Promise<{ category: string; count: number }[]>
      get(id: number): Promise<VaultEntry | null>
      add(data: Partial<VaultEntry>): Promise<{ ok: boolean; id?: number; error?: string }>
      update(
        id: number,
        data: Partial<VaultEntry>
      ): Promise<{ ok: boolean; error?: string }>
      delete(id: number): Promise<{ ok: boolean; error?: string }>
      generate(
        opts: GenerateOptions
      ): Promise<{ ok: boolean; password?: string; error?: string }>
      copy(
        id: number,
        field: 'account' | 'password'
      ): Promise<{ ok: boolean; error?: string }>
      changePassword(
        oldPassword: string,
        newPassword: string
      ): Promise<{ ok: boolean; error?: string }>
      exportBackup(): Promise<{
        ok: boolean
        path?: string
        error?: string
        canceled?: boolean
      }>
      openFile(): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
      createFile(): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
      getSettings(): Promise<{ vaultPath: string; autoLockMinutes: number }>
      setAutoLock(minutes: number): Promise<{ ok: boolean }>
      onAutoLocked(callback: (reason: string) => void): () => void
    }
  }
}

export {}
