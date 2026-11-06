/**
 * DataHub 本地 Webhook 服务（仅监听 127.0.0.1）
 *
 * 路由：
 *  - GET  /health                  → 健康检查
 *  - POST /webhook/:sourceId       → 接收第三方推送（JSON 或表单编码，可选 X-Token 校验）
 *
 * v1 闭环要点：
 *  - 第三方只需把回调地址配成 http://127.0.0.1:8457/webhook/<连接器ID>?token=xxx，
 *    POST 任意结构的 JSON 即可：字段自动整理（见 normalize.ts），无需按固定 schema 对接。
 *  - listen 失败（端口被占用等）不再抛未捕获异常导致主进程崩溃：
 *    记录日志后把服务标记为未运行，并通过 onStatus 通知界面。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { DataSource, HubMessageKind } from '../../shared/datahub'
import { normalizePayload } from './normalize'

export const WEBHOOK_PORT = 8457
const MAX_BODY = 1024 * 1024

let server: Server | null = null

export function isServerRunning(): boolean {
  return server !== null
}

export function stopWebhookServer(): void {
  if (server) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }
}

type OnMessage = (m: {
  sourceId: string
  sourceName: string
  kind: HubMessageKind
  title: string
  body: string
  dedupKey: string
  fields: { label: string; value: string }[]
}) => boolean

/** 启动 Webhook 服务；返回是否成功发起监听（异步错误通过 onStatus(false) 通知） */
export function startWebhookServer(
  onMessage: OnMessage,
  getConnector: (id: string) => DataSource | undefined,
  onStatus?: (running: boolean) => void,
  port: number = WEBHOOK_PORT
): boolean {
  if (server) return true
  try {
    server = createServer((req, res) => {
      void handle(req, res, onMessage, getConnector)
    })
    // 端口被占用等 listen 错误的兜底：不允许它变成未捕获异常（会崩主进程）
    server.on('error', (err) => {
      console.error(`[datahub] Webhook 服务无法启动（端口 ${port}）：`, err)
      try {
        server?.close()
      } catch {
        /* ignore */
      }
      server = null
      onStatus?.(false)
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`[datahub] Webhook 已监听 http://127.0.0.1:${port}`)
      onStatus?.(true)
    })
    return true
  } catch (err) {
    console.error('[datahub] Webhook 服务创建失败：', err)
    server = null
    onStatus?.(false)
    return false
  }
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  onMessage: OnMessage,
  getConnector: (id: string) => DataSource | undefined
): void {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${WEBHOOK_PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'lingx-datahub', running: isServerRunning() })
    return
  }

  if (req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
    const sourceId = url.pathname.slice('/webhook/'.length)
    const connector = getConnector(sourceId)
    if (!connector || !connector.enabled) {
      json(res, 404, { error: 'unknown or disabled connector' })
      return
    }
    // Token 校验：header X-Token 优先，其次 query token
    const token = String(req.headers['x-token'] ?? '') || String(url.searchParams.get('token') ?? '')
    if (connector.token && token !== connector.token) {
      json(res, 401, { error: 'invalid token' })
      return
    }

    let raw = ''
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf-8')
      if (raw.length > MAX_BODY) {
        tooLarge = true
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooLarge) {
        json(res, 413, { error: 'payload too large' })
        return
      }
      let payload: unknown
      try {
        payload = parseBody(raw, String(req.headers['content-type'] ?? ''))
      } catch {
        json(res, 400, { error: 'invalid JSON body' })
        return
      }

      const kind = normalizeKind((payload as Record<string, unknown> | null)?.kind)
      // 任意 JSON → 0..n 条消息；字段自动整理
      const messages = normalizePayload(sourceId, connector.name, payload, { kind })
      let accepted = 0
      for (const m of messages) {
        if (onMessage(m)) accepted++
      }
      json(res, 200, { ok: true, received: messages.length, accepted })
    })
    return
  }

  json(res, 404, { error: 'not found' })
}

/** 解析请求体：优先 JSON，兼容 application/x-www-form-urlencoded 表单提交 */
function parseBody(raw: string, contentType: string): unknown {
  const text = raw.trim()
  if (!text) return {}
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const obj: Record<string, string> = {}
    for (const pair of text.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const key = decodeURIComponent((eq >= 0 ? pair.slice(0, eq) : pair).replace(/\+/g, ' '))
      const value = decodeURIComponent((eq >= 0 ? pair.slice(eq + 1) : '').replace(/\+/g, ' '))
      obj[key] = value
    }
    return obj
  }
  return JSON.parse(text)
}

function normalizeKind(k: unknown): HubMessageKind {
  if (k === 'lead' || k === 'system' || k === 'info') return k
  return 'info'
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}
