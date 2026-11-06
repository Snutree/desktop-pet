/**
 * 宠物窗口预加载桥：向渲染进程暴露白名单 API（window.pet）
 * API 定义在 api-common.ts（无副作用），本文件只负责 expose。
 */
import { contextBridge } from 'electron'
import { petApiObj, type PetApi } from './api-common'

contextBridge.exposeInMainWorld('pet', petApiObj)

export type { PetApi }
