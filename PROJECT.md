# 灵犀（desktop-pet）项目介绍

> 本文件用于向外部 AI（如 DeepSeek）介绍项目全貌，以便进行架构审查与优化方案设计。
> 最后更新：2026-11-08

## 一、项目概览

| 项 | 内容 |
|---|---|
| 产品名 | 灵犀（LingX） |
| 定位 | Windows 桌面效率工具：剪贴板收藏整理 + 密码本 + 消息中枢，常驻后台秒开 |
| 开发主体 | 河北省合光尘软件有限公司（邯郸，一人小微公司） |
| 技术栈 | Electron 33.4.11 + electron-vite 2.3.0 + Vue 3.5.13 + TypeScript 5.6.3 + better-sqlite3 11.7.0 |
| 打包 | electron-builder 25.1.8 / NSIS x64（1.0.0 已打包并验收：`release/LingX-Setup-1.0.0.exe`） |
| 代码位置 | `F:\GitHub\zhongshu\desktop-pet` |
| 当前状态 | v1.1.0 开发完成（启动中心 + 分组/分类复用改造；未打包验收） |

## 二、功能矩阵

控制板是统一入口：左侧功能导航 + 右侧内容区，页面随时切换。

| 模块 | 功能 | 状态 |
|---|---|---|
| 剪贴板 | 监听系统剪贴板，历史记录按日期分组；截图自动识别保存 | ✅ |
| 收藏整理 | 目录制收藏（可新建/重命名目录、多选目录弹框、默认目录）；收藏页按目录分组展示；支持一键复制、编辑、删除、目录内拖拽排序；移出最后一个目录时弹窗选择"移动 / 直接删除 / 取消" | ✅ |
| 密码本 | 集成独立保险库（加密存储 + 主密码 + 密码生成器）；常驻服务化，秒开；分类支持下拉选择、重命名、删除（条目迁移到「未分类」） | ✅ |
| 消息中心 | 接收自定义 API 消息（官网表单 → 桌面通知/桌宠气泡）；未读标记；消息可"转任务" | ✅ |
| 任务追踪 | 需求/任务记录与进度管理：自定义状态（增删改、排序、改色）、完整字段、状态切换 + 进度备注时间线 | ✅（0.5.0 新增，1.0.0 起随正式版） |
| 启动中心 | 管理 `.exe` / `.bat` / `.cmd` 启动项：选择文件自动取所在目录为工作目录，点击 = 等同双击；分组（默认分组不可改名）、标签、组内拖拽排序；行尾绿/黄/红三个按钮（启动/编辑/删除）；可保存"默认以管理员启动" | ✅（1.1.0 新增） |
| API 配置 | 可视化配置第三方 API（URL、Key、轮询间隔），连接器化接入 | ✅ |
| 桌宠 | 桌面宠物（当前静态橘猫形象），可选功能（默认隐藏）；点击/移动特效 | ✅（可选） |
| 设置 | 热键、开机自启、剪贴板保留时长等；滚轮滚动，不挤压 | ✅ |

## 三、技术架构

```
┌─────────────────────────────────────────────────────┐
│ 渲染层 renderer（Vue 3）                              │
│   panel.html  控制板（PanelApp.vue + 7 个视图；密码本为其中一个视图）      │
│   index.html  桌宠窗口（pet.svg 静态形象 + 特效）       │
│   screenshot.html 截图预览                            │
└───────────────┬─────────────────────────────────────┘
                │ contextBridge（preload，白名单 API）
┌───────────────┴─────────────────────────────────────┐
│ 主进程 main（Node.js）                                │
│   panel-window.ts   控制板窗口                        │
│   pet-window.ts     桌宠窗口                          │
│   clipboard/        剪贴板监听（轮询 + hash 去重）     │
│   screenshot/       截图捕获                          │
│   datahub/          消息中枢：Webhook 端口 8457 +      │
│                     轮询连接器（如官网表单 API）        │
│   vault/            密码本服务（常驻，秒开）           │
│   storage/          SQLite 数据层（better-sqlite3）   │
│   tray.ts           托盘                                 │
│   hotkeys/          全局热键                              │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────┴─────────────────────────────────────┐
│ 数据存储                                             │
│   %APPDATA%\clipboard-plus\clipboard-plus.db  SQLite │
│   %APPDATA%\desktop-pet\              Electron userData│
│   （vault.pvlt 加密保险库文件，默认在 userData；可打开/新建到任意位置）│
└─────────────────────────────────────────────────────┘
```

### 数据流要点

- **剪贴板**：主进程轮询剪贴板 → hash 去重 → 写 `clip_history` → 历史页按日期展示 → 用户"保存"时写入 `favorites` + `favorite_category_map`（多选目录）
- **消息接入**：两种通道 —— ① 本地 Webhook 端口 8457（第三方 POST 任意 JSON / 表单编码，字段自动整理）② 轮询连接器（定时 GET/POST 外部 API，如官网 Halo 联系表单的提交记录接口）→ 统一入 `datahub store` → 系统通知 + 桌宠气泡 + 消息中心。旧版线索接口（已下线）不再作为示例。
- **任务**：消息中心"转任务"→ 预填消息标题/内容/来源 → `tasks` 表；状态变更与进度备注写 `task_progress_logs` 时间线
- **启动中心**：启动项存 `launcher_entries`（所属分组 `launcher_groups`）→ 点击启动时主进程按文件类型用 `spawn` + 工作目录执行（bat/cmd 显示控制台）→ 保存了"默认管理员"或选择本次管理员时走 PowerShell `Start-Process -Verb RunAs` 触发 UAC

## 四、数据存储设计（SQLite，schema_version = 6）

| 表 | 职责 |
|---|---|
| `clip_history` | 剪贴板历史（文本/图片/文件，去重 hash） |
| `favorites` | 收藏条目（内容 + 来源历史 ID） |
| `favorite_categories` | 收藏目录 |
| `favorite_category_map` | 收藏 ↔ 目录多对多映射（含目录内排序 `sort_order`） |
| `settings` | 应用设置键值 |
| `app_meta` | 元信息（schema_version 等） |
| `task_statuses` | 任务自定义状态（预置：待处理/进行中/已完成/已取消，is_system=1） |
| `tasks` | 任务（标题/描述/来源/优先级/分类/链接/期望完成时间/状态） |
| `task_progress_logs` | 任务进度时间线（状态变更 + 备注） |
| `launcher_groups` | 启动中心分组（默认分组 is_default=1，不可删除） |
| `launcher_entries` | 启动项（类型/文件路径/工作目录/分组/标签/默认管理员/图标/组内排序） |

数据库独立于 Electron userData（`%APPDATA%\clipboard-plus\`），与旧独立版剪贴板工具共用。

## 五、IPC 接口（40+ 个通道，preload 白名单）

- **剪贴板/收藏**：`clipboard:list/copy/delete/clearByDate/dates/listByDate/retentionCleanup`、`favorite:list/listByCategory/save/copy/remove/update/findByHistory/removeFromCategory/moveToCategories/reorder`、`favorite:categories:list/add/remove/rename`
- **密码本**：vault 系列（登录/条目/生成器/设置/分类重命名与删除）
- **启动中心**：`launcher:groups:list/add/rename/delete`、`launcher:entries:list/add/update/delete/reorder/run`、`launcher:chooseFile/reveal`
- **消息**：`datahub` 系列（连接器配置、消息列表、已读/删除、pushTest）
- **任务**：`task:statuses:list/add/remove`、`task:list/create/update/delete/setStatus/logs/addLog`
- **系统**：`settings:get/set/getAll`、`hotkey:update`、`app:setAutoStart`、`app:getDbStatus`、`app:getInfo`、`app:openPath`、`notify:test`、`dialog:chooseDirectory`、`screenshot:capture`

## 六、开发 / 构建 / 打包

```bash
npm run dev        # 开发模式（electron-vite dev）
npm run typecheck  # 类型检查（node + web）
npm run build      # 构建产物到 out/
npm run build:win  # 构建 + electron-builder 打包 NSIS
```

打包产物：`release/LingX-Setup-${version}.exe`，productName=灵犀，appId=com.heguangchen.deskpet，未代码签名。

## 七、v1 闭环状态

### 已完成（0.5.0）

1. **剪贴板图片不显示**：`panel.html` 的 CSP `img-src` 补 `clipimg:`；缩略图/大图加载失败有明确兜底提示。
2. **密码本上锁后无法解锁**：`Vault` 区分「已打开 / 已解锁」，锁定释放密文、再次解锁按需重读库文件；错误文案区分"密码错误 / 文件不存在 / 文件损坏"。
3. **密码本换机**：移除硬编码开发机路径；找不到库时不再静默进入新建，改为「新建 / 打开已有库 / 从备份恢复」三选一；默认库路径为 userData；支持"新建到指定位置"。
4. **运行环境隔离**：开发版 userData = `%APPDATA%\desktop-pet-dev`，打包版保持 `%APPDATA%\desktop-pet`；单实例锁互不干扰。
5. **开机自启**：默认关闭；仅在打包版写注册表；首启引导提示"可在设置 → 通用中开启"，不替用户做决定。
6. **系统通知**：新增 Windows Toast（受设置"消息通知"开关控制，点击直达消息中心）；同源 900ms 聚合；轮询首次拉取静默，不弹历史线索；设置页提供"测试通知"。
7. **消息去重持久化**：`datahub.json` 新增 `seenKeys`（与清空消息解耦），解决"清空消息/超过 500 条后重启会重放历史线索"。
8. **任意 JSON 消息接入**：Webhook 可直接 POST 任意 JSON / 表单编码，字段自动整理成标题、正文与结构化字段；轮询支持 GET/POST + 自定义请求头/请求体；消息中心展示键值字段。
9. **数据目录可见**：设置页展示剪贴板数据目录、应用数据目录、保险库目录、日志路径，并可一键打开。
10. **启动健壮性**：主进程日志落盘 `userData/logs/main.log`（2MB 轮转）；全局未捕获异常/未处理拒绝记录；初始化失败弹错误框；Webhook 端口被占用不再崩进程，界面显示真实状态。
11. **版本统一**：版本号由 `app.getVersion()` 动态显示（1.0.0）。

### 仍待跟进（v1.1+）

1. **数据一键备份/恢复**：目前靠"打开目录手动复制 + 密码本导出备份"，未做统一备份包。
2. **密码本自动同步**（网盘目录 / WebDAV / 自建服务）：v1 仅支持手动拷贝 `.pvlt`。
3. **安装包未签名**：Windows SmartScreen 会告警；正式分发建议代码签名。
4. **无自动更新机制**：手动分发安装包。
5. **通知增强**：免打扰时段、按消息类型分级、按连接器自定义"弹气泡 / 只入库"（当前是全局开关）。
6. **桌宠形象包**：当前为静态 SVG；上传形象（静态图/GIF/APNG）与状态映射列入后续。
7. **截图仅支持主显示器**；多显示器需遍历 `screen.getAllDisplays()`。
8. **数据目录分散**：DB/图片在 `%APPDATA%\clipboard-plus`，配置在 `%APPDATA%\desktop-pet`，保险库可自定义路径；后续考虑统一数据根目录 + 迁移。
9. **错误上报**：仅有本地日志，无远程上报。
10. **剪贴板与独立版 ClipboardPlus 共用 DB**：同时运行存在 WAL 并发写风险，建议只保留一个常驻。

## 八、版本历史

| 版本 | 内容 |
|---|---|
| 0.3.0 | 早期"桌面宠物控制板"：桌宠 + 剪贴板 + 密码本雏形（DeskPet） |
| 0.4.0 | 更名灵犀；剪贴板目录制收藏、消息中心（API 接入 + 轮询 + Webhook）、桌宠可选化、设置优化；已打包分发 |
| 0.5.0 | 新增任务追踪（自定义状态 + 进度时间线）、消息转任务；v1 闭环：图片显示修复、密码本锁定/换机、运行环境隔离、开机自启策略、系统通知、去重持久化、任意 JSON 消息接入、日志与启动健壮性 |
| 1.0.0 | 首个 v1 正式版：在 0.5.0 基础上完成发布工程（版本定版、README/LICENSE、NSIS 安装包），安装包 `release/LingX-Setup-1.0.0.exe`（未签名），已通过沙盒安装/卸载/首启/剪贴板捕获验收并发布 |
| 1.1.0 | 新增启动中心（exe/bat/cmd 启动项、分组、标签、组内拖拽排序、默认管理员启动、图标提取）；抽取共享分类组件，剪贴板目录支持重命名/目录内拖拽/移出弹窗，密码本分类支持选择/重命名/删除迁移；DB schema v6 |
