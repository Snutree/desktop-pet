import { BrowserWindow, screen, app, ipcMain } from 'electron'
import { join } from 'path'
import { IpcChannels, type PetDragStartPayload } from '@shared/ipc'

/** 宠物窗口默认尺寸（含透明留白，SVG 实际形象居中） */
export const PET_WINDOW_W = 220
export const PET_WINDOW_H = 260

/** 拖拽时窗口跟随光标的刷新间隔（ms） */
const DRAG_TICK_MS = 16

let petWindow: BrowserWindow | null = null
let dragTimer: NodeJS.Timeout | null = null
let dragOffsetX = 0
let dragOffsetY = 0
let lastMoveTick = 0

function stateFile(): string {
  return join(app.getPath('userData'), 'pet-window-state.json')
}

function loadState(): { x: number; y: number } {
  try {
    const file = stateFile()
    const raw = require('fs').readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw)
    console.log(`[pet] loadState from ${file}: ${raw}`)
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch (err) {
    console.warn(`[pet] loadState failed: ${String(err)}`)
  }
  // 默认放到主显示器右下角
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - PET_WINDOW_W - 40, y: wa.y + wa.height - PET_WINDOW_H - 30 }
}

function saveState(x: number, y: number): void {
  try {
    require('fs').writeFileSync(stateFile(), JSON.stringify({ x, y }))
  } catch {
    /* 写失败不影响运行 */
  }
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

/** 销毁宠物窗口（设置中关闭桌宠时调用）；状态已保存则无需保留 */
export function destroyPetWindow(): void {
  stopDrag()
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy()
  }
  petWindow = null
}

export function createPetWindow(): BrowserWindow {
  const pos = loadState()

  petWindow = new BrowserWindow({
    width: PET_WINDOW_W,
    height: PET_WINDOW_H,
    x: pos.x,
    y: pos.y,
    icon: join(__dirname, '../../resources/icon.png'),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false, // 拖拽由我们手动实现，禁用系统拖拽避免双重移动
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 置顶级别提到最高（可盖过全屏应用，如游戏/演示）
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 点掉窗口本身（任务栏不显示、Alt+Tab 不出现）
  petWindow.setSkipTaskbar(true)

  if (process.env['ELECTRON_RENDERER_URL']) {
    petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  petWindow.webContents.on('console-message', (_e, level, message) => {
    console.log(`[pet-renderer:${level}] ${message}`)
  })
  petWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[pet] did-fail-load code=${code} desc=${desc}`)
  })

  petWindow.once('ready-to-show', () => {
    petWindow?.show()
  })

  petWindow.on('closed', () => {
    petWindow = null
  })

  registerDragHandlers()
  return petWindow
}

/** 拖拽 IPC 监听只注册一次（多次开关桌宠不会重复叠加监听） */
let dragHandlersRegistered = false

/** 拖拽：renderer 按下后主进程按光标位置移动窗口（鼠标移出窗口后仍可跟随） */
function registerDragHandlers(): void {
  if (dragHandlersRegistered) return
  dragHandlersRegistered = true
  ipcMain.on(IpcChannels.PetDragStart, (_evt, payload: PetDragStartPayload) => {
    if (!petWindow || petWindow.isDestroyed()) return
    const [wx, wy] = petWindow.getPosition()
    dragOffsetX = payload.mouseX - wx
    dragOffsetY = payload.mouseY - wy
    lastMoveTick = Date.now()

    if (dragTimer) clearInterval(dragTimer)
    dragTimer = setInterval(() => {
      if (!petWindow || petWindow.isDestroyed()) {
        stopDrag()
        return
      }
      const cursor = screen.getCursorScreenPoint()
      petWindow.setPosition(cursor.x - dragOffsetX, cursor.y - dragOffsetY)
      lastMoveTick = Date.now()
    }, DRAG_TICK_MS)
  })

  ipcMain.on(IpcChannels.PetDragEnd, () => {
    stopDrag()
  })
}

function stopDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  if (petWindow && !petWindow.isDestroyed()) {
    const [x, y] = petWindow.getPosition()
    saveState(x, y)
  }
}
