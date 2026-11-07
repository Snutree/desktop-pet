/// <reference types="vite/client" />

import type { ClipRecord, FavoriteRecord, FavoriteWithCategories, AppSettings } from '../../../shared/types'

declare global {
  /** preload 通过 contextBridge 暴露到 window 的白名单 API（与 src/preload/index.ts 保持一致） */
  interface Window {
    clipboardPlus: {
      getDbStatus(): Promise<{
        tables: { name: string }[]
        counts: Record<string, number>
        path: string
      }>
      listClips(limit?: number): Promise<ClipRecord[]>
      copyClip(id: number): Promise<boolean>
      deleteClip(id: number): Promise<boolean>
      clearByDate(date: string): Promise<number>
      onClipboardNew(callback: (record: ClipRecord) => void): () => void
      listFavorites(): Promise<FavoriteRecord[]>
      listFavoritesByCategory(categoryId: number): Promise<FavoriteWithCategories[]>
      listCategories(): Promise<{
        id: number
        name: string
        is_default: number
        created_at: number
      }[]>
      addCategory(
        name: string
      ): Promise<{ id: number; name: string; is_default: number; created_at: number } | null>
      removeCategory(id: number): Promise<boolean>
      renameCategory(id: number, name: string): Promise<{ ok: boolean; error?: string }>
      moveFavoriteToCategories(
        favoriteId: number,
        fromCategoryId: number,
        targetCategoryIds: number[]
      ): Promise<{ ok: boolean; error?: string }>
      reorderFavorites(categoryId: number, orderedIds: number[]): Promise<{ ok: boolean }>
      saveFavorite(
        historyId: number,
        categoryIds: number[]
      ): Promise<{ favoriteId: number; categoryIds: number[] } | null>
      removeFavoriteFromCategory(favoriteId: number, categoryId: number): Promise<boolean>
      copyFavorite(id: number): Promise<boolean>
      removeFavorite(id: number): Promise<boolean>
      updateFavorite(id: number, patch: { text?: string; note?: string }): Promise<FavoriteRecord | null>
      findFavoriteByHistory(historyId: number): Promise<FavoriteRecord | null>
      captureScreenshot(): Promise<boolean>
      listClipDates(): Promise<string[]>
      listClipsByDate(date: string): Promise<ClipRecord[]>
      runRetentionCleanup(): Promise<number>
      getSetting(key: string): Promise<string | null>
      setSetting(key: string, value: string): Promise<boolean>
      exportByDate(
        date: string,
        format: 'html' | 'pdf'
      ): Promise<{
        dir: string
        file: string
        format: 'html' | 'pdf'
        imageCount: number
        recordCount: number
      } | null>
      getSettings(): Promise<AppSettings>
      updateHotkey(
        kind: 'screenshot' | 'panel',
        accelerator: string
      ): Promise<{ ok: boolean; error?: string }>
      setAutoStart(enabled: boolean): Promise<boolean>
      chooseDirectory(): Promise<string | null>
    }
  }
}

export {}
