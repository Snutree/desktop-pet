/**
 * 控制板统一预加载桥
 *
 * 控制板窗口承载剪贴板/密码本/宠物/消息中枢全部功能，
 * 这里一次性暴露全部 API（window.clipboardPlus / vaultApi / pet / panelApi）。
 * API 定义在 api-common.ts（无副作用），本文件只负责 expose。
 */
import { contextBridge } from 'electron'
import {
  clipboardPlusApi,
  vaultApiObj,
  petApiObj,
  panelApi,
  type ClipboardPlusApi,
  type VaultApi,
  type PetApi,
  type PanelApi
} from './api-common'

contextBridge.exposeInMainWorld('clipboardPlus', clipboardPlusApi)
contextBridge.exposeInMainWorld('vaultApi', vaultApiObj)
contextBridge.exposeInMainWorld('pet', petApiObj)
contextBridge.exposeInMainWorld('panelApi', panelApi)

export type { ClipboardPlusApi, VaultApi, PetApi, PanelApi }
