/** DataHub：第三方消息中枢的共享类型（主进程 / preload / renderer 共用） */

/** 连接器接收方式：Webhook（推送）/ 轮询（拉取） */
export type DataSourceKind = 'webhook' | 'poll'

/** 轮询请求方法 */
export type HttpMethod = 'GET' | 'POST'

export interface DataSource {
  id: string
  name: string
  kind: DataSourceKind
  /** Webhook：本地接收路径标识；轮询：第三方接口 URL */
  url: string
  /** 鉴权 token（Webhook 用 header X-Token 校验；轮询用 X-Token） */
  token?: string
  /** 轮询间隔（秒），仅 poll 有效 */
  pollIntervalSec?: number
  /** 轮询请求方法，默认 GET；POST 时可配合 requestBody 传 JSON */
  method?: HttpMethod
  /** 轮询请求头（JSON 字符串，如 {"X-Api-Key":"xxx"}） */
  requestHeaders?: string
  /** 轮询请求体（仅 POST；JSON 字符串，原样发送） */
  requestBody?: string
  enabled: boolean
  createdAt: number
}

/** 消息类型：lead=业务线索（高优先），system=系统通知，info=普通信息 */
export type HubMessageKind = 'lead' | 'system' | 'info'

/** 自动整理出的结构化字段（任意 JSON → 键值对，便于阅读与复制） */
export interface MessageField {
  label: string
  value: string
}

export interface HubMessage {
  id: string
  sourceId: string
  sourceName: string
  kind: HubMessageKind
  title: string
  body: string
  /** 从原始 JSON 整理出的字段（可选，历史消息可能没有） */
  fields?: MessageField[]
  /** 去重键（同键不重复入库） */
  dedupKey: string
  read: boolean
  createdAt: number
}

/** 控制板可切换的页面 */
export type PanelTab = 'clipboard' | 'vault' | 'messages' | 'tasks' | 'launcher' | 'api' | 'settings'
