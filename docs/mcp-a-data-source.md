# MCP 数据源（A）— 消息中心接入

> 状态：草案（待你补充「待确认」部分）
> 定位：灵犀作为 **MCP 客户端**，从支持 MCP 的平台拉数据，整理进消息中心。
> 关联代码：`src/main/datahub/`、`src/renderer/panel/views/PanelApi.vue`、`src/main/notify/desktop.ts`

## 1. 目标

- 灵犀通过 MCP 协议连接数据源，调用对方的工具（如"列出需求提交"），把返回 JSON 自动整理成消息。
- 首个样本：Halo 联系表单插件提供的 MCP。
- 不做：通用 cURL 导入、任意表单后台逆向、字段/分页的通吃式适配引擎。

## 2. 本期范围

**做**
- MCP 客户端最小实现：传输（HTTP / stdio 二选一先做）、工具列表、调用工具、结果解析。
- 新增数据源类型「MCP」，在「API 配置」里可添加/启停/删除。
- 工具返回 JSON → 复用现有 `normalizePayload()` → 消息中心（字段自动整理）。
- token 用 Electron `safeStorage` 加密存储。

**不做**
- OAuth、MCP resources/prompts、写操作（往对方系统提交数据）。
- 多 MCP 服务器集群管理、自动发现。

## 3. 配置草案（API 配置 → 添加数据源 → MCP）

| 字段 | 说明 | 示例 |
|---|---|---|
| 名称 | 显示用 | 官网表单（MCP） |
| 传输方式 | HTTP 端点 / 本地命令 | HTTP |
| Endpoint / 命令 | HTTP 地址，或可执行命令 + 参数 | `https://.../mcp` |
| 鉴权 | 无 / Bearer Token / 自定义 Header | Bearer |
| Token | 加密存储 | `***` |
| 工具名 | 拉数据用的工具 | `list_submissions` |
| 工具参数 | JSON，支持 `{{page}}` `{{size}}` 占位 | `{"limit":50}` |
| 轮询间隔（秒） | 复用现有轮询 | 30 |
| 记录路径 / id 字段 | 可选，覆盖自动探测 | `items` / `name` |

## 4. 数据流

```
定时触发
  → MCP initialize（一次）
  → tools/call(工具名, 参数)
  → 结果 JSON（可能包一层 content[0].text）
  → normalizePayload() → HubMessage
  → 入库 / 未读角标 / 系统通知 / 宠物气泡 / 托盘未读数
```

## 5. Halo 待确认（请补充）

- [ ] 联系表单插件是否提供 MCP？
- [ ] 传输方式：HTTP Endpoint 还是本地命令（stdio）？
- [ ] 地址 / 命令是什么？
- [ ] 鉴权方式（Token？API Key？无？）
- [ ] 工具名和用途（列表 / 详情 / 是否含全部答案）
- [ ] 返回 JSON 示例（可脱敏贴一条）
- [ ] 是否需要购买插件许可证
- [ ] 与现有 PAT + Console API 方式相比，MCP 是否更省事

## 6. 验收标准

- [ ] 能添加一个 MCP 数据源，连接成功后列出工具
- [ ] 定时调用工具，新记录进入消息中心，字段显示正确
- [ ] 重复数据不重复入库（沿用 dedupKey）
- [ ] 工具调用失败 / Token 过期：数据源显示异常状态，不影响其他连接器
- [ ] Token 不以明文出现在 `datahub.json`
- [ ] 不阻塞主进程（超时、并发限制）

## 7. 风险与安全

- MCP 生态仍在演进，传输/鉴权各家不一致；实现要薄，方便替换。
- 云端 MCP 返回的数据可能含客户手机号，进入系统通知前考虑脱敏开关。
- 本地 stdio 方式需要客户机器上有对应运行时（Node/Python），需要提前说明。

## 8. 评审记录

**已从你的补充拿到（详情工具，够用了）**：`PluginContactForm__get_submission` 的 Input/Output Schema。

- `answers[]` 自带 `id`（字段 id）、`label`（中文名）、`value`、`choices`（枚举 code→中文）、`redacted`（隐藏时不返回 value）
  → 中文标签和"零售/官网小程序"这类枚举翻译可以**自动完成**，不用再拉表单定义接口。
- `submission` 自带 `name`、`status`、`read`、`spamState`、`acceptedAt`、`contactName`、`answerCount`
  → 元数据、垃圾过滤（`spamState`）、时间排序都有原料。
- 明确写了"读取不会自动标记已读" → 可以安全地定时轮询。
- 输入只要 `name` → 说明**必须先有列表工具**拿到每条 submission 的 name，再做详情（两级调用）。

**仍然缺、且是动手前的必要条件**：

- [ ] MCP 连接方式：HTTP Endpoint 地址，还是本地命令（stdio）？
- [ ] 鉴权：Token 放在哪（Header 名 / Bearer 格式 / query），是不是就是后台的个人访问令牌？
- [ ] **列表工具**：名称 + Input/Output Schema（怎么枚举 submissions、分页/排序、能不能只看 new/unread）
- [ ] 工具完整清单（估计还有 `list_submissions`、`mark_read` 等，`PluginContactForm__` 前缀下的全部工具）
- [ ] 一条脱敏的 `get_submission` 返回示例（确认 `choices` 的具体形状、`value` 实际类型）
- [ ] 是否需要购买插件许可证，社区版是否可用 MCP

**去哪里找**：Halo 后台 → 联系表单插件设置页里通常有「MCP」或「AI 接入」区块，会给出 Endpoint（或命令）和 Token；插件市场详情页/插件文档里一般也有工具清单。

## 9. 开放问题（你补充）

1.PluginContactForm__get_submission
读取提交答案、附件信息及分页处理历史，隐藏敏感答案和下载链接；读取不会自动标记已读。
2.Input Schema

{
  "properties": {
    "name": {
      "minLength": 1,
      "maxLength": 253,
      "type": "string"
    },
    "timelinePage": {
      "maximum": 10000,
      "type": "integer",
      "minimum": 1
    }
  },
  "type": "object",
  "required": [
    "name"
  ],
  "additionalProperties": false
}
3.Output Schema
{
  "properties": {
    "submission": {
      "properties": {
        "name": {
          "type": "string"
        },
        "version": {
          "type": "integer",
          "minimum": 0
        },
        "formName": {
          "type": "string"
        },
        "formTitle": {
          "type": "string"
        },
        "revisionNumber": {
          "type": "integer",
          "minimum": 1
        },
        "receiptId": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "new",
            "open",
            "pending",
            "closed",
            "spam"
          ]
        },
        "read": {
          "type": "boolean"
        },
        "assignee": {
          "type": "string"
        },
        "labels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "contactName": {
          "type": "string"
        },
        "submitterUserName": {
          "type": "string"
        },
        "submitterDisplayName": {
          "type": "string"
        },
        "spamState": {
          "type": "string",
          "enum": [
            "unchecked",
            "clean",
            "suspected",
            "blocked"
          ]
        },
        "acceptedAt": {
          "type": "string",
          "format": "date-time"
        },
        "answerCount": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "formName",
        "formTitle",
        "status",
        "answerCount"
      ],
      "type": "object"
    },
    "answers": {
      "type": "array",
      "items": {
        "properties": {
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "required": {
            "type": "boolean"
          },
          "redacted": {
            "type": "boolean",
            "description": "True when the answer is withheld."
          },
          "choices": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          },
          "value": {
            "type": [
              "string",
              "number",
              "boolean",
              "array",
              "object",
              "null"
            ],
            "description": "Answer shape depends on the field type, including custom field providers. Omitted when redacted or unanswered; repeater rows contain only permitted children."
          },
          "attachments": {
            "type": "array",
            "items": {
              "properties": {
                "displayName": {
                  "type": "string"
                },
                "mediaType": {
                  "type": "string"
                },
                "size": {
                  "type": "integer",
                  "minimum": 0
                },
                "available": {
                  "type": "boolean"
                }
              },
              "additionalProperties": false,
              "required": [
                "available"
              ],
              "type": "object"
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "id",
          "type",
          "required",
          "redacted",
          "choices"
        ],
        "type": "object",
        "if": {
          "properties": {
            "redacted": {
              "const": true
            }
          }
        },
        "then": {
          "not": {
            "anyOf": [
              {
                "required": [
                  "value"
                ]
              },
              {
                "required": [
                  "attachments"
                ]
              }
            ]
          }
        }
      }
    },
    "timeline": {
      "properties": {
        "page": {
          "type": "integer",
          "minimum": 1
        },
        "size": {
          "const": 20
        },
        "notes": {
          "type": "array",
          "items": {
            "properties": {
              "name": {
                "type": "string"
              },
              "direction": {
                "type": "string",
                "enum": [
                  "internal"
                ]
              },
              "author": {
                "type": "string"
              },
              "content": {
                "type": "string"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "additionalProperties": false,
            "required": [
              "name",
              "direction",
              "author",
              "content",
              "createdAt"
            ],
            "type": "object"
          }
        },
        "notesTotal": {
          "type": "integer",
          "minimum": 0
        },
        "events": {
          "type": "array",
          "items": {
            "properties": {
              "actor": {
                "type": "string"
              },
              "action": {
                "type": "string"
              },
              "occurredAt": {
                "type": "string",
                "format": "date-time"
              },
              "summary": {
                "type": "string"
              },
              "changes": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false,
            "required": [
              "action"
            ],
            "type": "object"
          }
        },
        "eventsTotal": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false,
      "required": [
        "page",
        "size",
        "notes",
        "notesTotal",
        "events",
        "eventsTotal"
      ],
      "type": "object"
    }
  },
  "type": "object",
  "required": [
    "submission",
    "answers",
    "timeline"
  ],
  "additionalProperties": false
}