/** 桌宠 IPC 通道常量（主进程 / preload / renderer 共用） */
export const IpcChannels = {
  /** renderer → main：开始拖拽（附带按下时鼠标位置，用于计算偏移） */
  PetDragStart: 'pet:drag-start',
  /** renderer → main：结束拖拽 */
  PetDragEnd: 'pet:drag-end',
  /** renderer → main：请求弹出右键菜单 */
  PetContextMenu: 'pet:context-menu',
  /** renderer → main：打开剪贴板面板 */
  PetOpenClipboard: 'pet:open-clipboard',
  /** renderer → main：打开密码本 */
  PetOpenVault: 'pet:open-vault',
  /** renderer → main：退出应用 */
  PetQuit: 'pet:quit',
  /** main → renderer：宠物气泡消息（后续数据源通知入口） */
  PetShowBubble: 'pet:show-bubble'
} as const

export type PetDragStartPayload = {
  /** 鼠标按下时相对屏幕的坐标 */
  mouseX: number
  mouseY: number
}

export type PetBubblePayload = {
  text: string
  durationMs?: number
}
