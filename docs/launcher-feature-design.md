# 启动中心 / 分组与分类复用 设计

> 状态：已实现（2026-11-08），待打包/沙盒验收
> 版本：1.1.0（DB schema v6）
> 范围：新增「启动中心」；复用分组/分类组件改造剪贴板收藏与密码本；修复相关 bug

## 1. 命名

- 功能名：**启动中心**（侧栏「工作台」下）
- 单个条目：**启动项**
- 代码模块：`launcher`；IPC 前缀 `launcher:`；表 `launcher_entries`
- 与设置里的「开机自启」区分文案

## 2. 已确认需求

### 启动中心
- 仅支持 `.exe` / `.bat` / `.cmd`。
- 添加时**选择文件**，自动把文件所在目录作为工作目录（等同在文件夹双击）。
- 运行等同于双击：EXE 用 `spawn` + `cwd`；BAT/CMD 用 `cmd.exe /c` + `cwd`，显示控制台。
- 支持「默认以管理员身份启动」勾选项（保存到启动项）；启动时按保存值走 UAC。
- 分组：左侧分组列表，右侧启动项；分组可重命名（名称唯一，默认分组不可删除）；可新建、删除（删除需确认，组内启动项级联删除，不删除磁盘原文件）。
- 标签：多选/自由输入，用于展示和筛选。
- 行式列表：图标、名称、类型、文件路径（中间省略）、分组、标签、最近启动时间；最右侧「启动」按钮 + `▾` 下拉（以管理员身份启动（本次）/ 编辑 / 删除）。
- 同一文件允许添加多个启动项。
- 启动成功不弹提示（命令行自己有输出）；失败需反馈（toast + 行内"目标不存在"）。
- 启动项可在分组内拖拽排序；分组本身不参与排序。
- 不做导入导出、不做 lnk/URL/文件夹/自定义命令、不做参数/隐藏控制台、不做运行历史。

### 剪贴板收藏
- 收藏目录（分组）**允许重命名**（左侧目录名右侧「✎」；默认目录也可改名，但不可删除）。
- 「移出目录」修正：当这条收藏**只属于当前目录**时，弹窗：
  1. 选择要移动到的目录（可多选，剪贴板收藏本身支持多目录）
  2. 不移动、直接删除该收藏
  3. 取消
  若它还在其他目录，则直接移出当前目录（不弹窗、不删除）。
- 收藏条目在**目录内**拖拽排序；目录本身不排序。
- 不做导入导出。

### 密码本
- 新增/编辑条目时，分类改为**下拉选择**：已有分类 + 新建分类；默认「未分类」。
- 分类**允许重命名**：重命名时批量更新该分类下所有条目。
- 分类**允许删除**：删除前提示"该分类下的密码将移动到未分类"，确认后批量迁移到未分类。
- 密码本**不做拖拽排序**。
- 「未分类」为默认分类，不可删除、可重命名。

## 3. 复用方案

不合并数据库表（剪贴板收藏多对多、密码本分类是加密库字符串、启动中心单分组），统一抽共享 UI/逻辑，三处调用：

| 共享件 | 用途 |
|---|---|
| `CategorySelect.vue` | 已有分类下拉 + 新建；`multiple` 属性支持剪贴板多选 |
| `CategoryNav.vue` | 左侧分类/分组列表（名称、数量、选中态），可选编辑/删除按钮 |
| `MoveToCategoryDialog.vue` | 移出/移动弹窗（目标选择 / 不移动即删除 / 取消） |
| `useDragSort.ts` | 组内条目拖拽排序（HTML5 drag events + 持久化） |
| `ConfirmDialog.vue` | 删除分组/分类等确认弹窗 |

## 4. 数据模型（schema v6）

```sql
-- 启动中心
CREATE TABLE IF NOT EXISTS launcher_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,              -- exe | bat | cmd
  file_path    TEXT NOT NULL,
  dir_path     TEXT NOT NULL,              -- 工作目录 = 文件所在目录
  group_name   TEXT NOT NULL DEFAULT '默认分组',
  tags_json    TEXT NOT NULL DEFAULT '[]',
  run_as_admin INTEGER NOT NULL DEFAULT 0, -- 默认管理员启动
  icon_path    TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  last_run_at  INTEGER,
  run_count    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_launcher_group ON launcher_entries (group_name);
CREATE INDEX IF NOT EXISTS idx_launcher_sort  ON launcher_entries (sort_order, id);

-- 剪贴板：目录排序（目录本身不拖拽，但预留顺序字段）与目录内收藏排序
ALTER TABLE favorite_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE favorite_category_map ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
```

- 收藏排序按"目录内"独立：`favorite_category_map.sort_order`。
- 启动项排序按"分组内"独立：`launcher_entries.sort_order`（相对 group_name）。
- 分组/目录/分类名称的创建、重命名、删除规则见上。

## 5. 启动执行（主进程 `src/main/launcher/runner.ts`）

| 场景 | 实现 |
|---|---|
| EXE 普通 | `spawn(file, [], { cwd: dir, windowsHide: false })` |
| BAT/CMD 普通 | `spawn(ComSpec, ['/d','/s','/c', '"file"'], { cwd: dir, windowsHide: false })` |
| 管理员（保存了默认管理员） | PowerShell `Start-Process -FilePath <file> -WorkingDirectory <dir> -Verb RunAs` |
| 失败 | 捕获 `error`/`exit`；文件不存在→行内标记；权限不足/启动异常→toast；写 `main.log` |

- 不做参数输入、不做隐藏控制台。
- 管理员启动由保存的勾选项决定，不再每次从下拉选择（下拉仍保留"本次以管理员身份启动"作为临时覆盖）。
- 同一文件多个启动项互不影响。

## 6. 代码改动清单

- `src/shared/types.ts`：Launcher 类型、分类相关共享类型
- `src/shared/datahub.ts`：PanelTab 增加 `'launcher'`
- `src/main/storage/db.ts`：schema v6 + 迁移（launcher 表、收藏排序字段）
- `src/main/storage/launcherRepo.ts`：启动项 CRUD/排序/运行信息
- `src/main/storage/favoriteRepo.ts`：目录重命名、移动收藏、目录内排序、移出逻辑修正
- `src/main/vault/database.ts` + `src/main/vault/service.ts`：分类重命名/删除（批量更新/迁移到未分类）
- `src/main/launcher/runner.ts`、`src/main/launcher/icon.ts`
- `src/main/ipc/index.ts`、`src/preload/api-common.ts`、`src/renderer/*/env.d.ts`
- 新增共享组件：`src/renderer/components/CategorySelect.vue`、`CategoryNav.vue`、`ConfirmDialog.vue`、`MoveToCategoryDialog.vue`、`composables/useDragSort.ts`
- `src/renderer/panel/views/PanelLauncher.vue`、`PanelApp.vue`（导航/标题/页面）
- `src/renderer/clipboard/views/FavoritesView.vue`、`FavoriteItem.vue`
- `src/renderer/vault/components/EntryDialog.vue`、`MainView.vue`、`SettingsDialog.vue`（分类管理入口）
- `src/main/storage/settings.ts`、`PanelSettings.vue`：本版**不加**启动中心热键（先做页面）

## 7. 拖拽排序规则

- 启动中心：左边分组固定，右边组内启动项可拖动排序（持久化 `launcher_entries.sort_order`）。
- 剪贴板：目录内收藏可拖动排序（持久化 `favorite_category_map.sort_order`，每个目录独立顺序）。
- 密码本：不做拖拽排序。
- 搜索/筛选状态下不启用拖拽（避免顺序歧义）。

## 8. 已确认决策（2026-11-08）

1. 分组/目录/分类都允许改名，但**名称不能重复**；启动中心分组、剪贴板目录、密码本分类规则一致。
2. 删除启动中心分组：确认后**级联删除组内启动项**（文案写明数量），不删除磁盘原文件；想把启动项挪走，需单独编辑启动项换分组（迁移独立）。
3. 剪贴板多目录收藏排序：**每个目录独立顺序**（`favorite_category_map.sort_order`）。

## 9. 分阶段

| 阶段 | 内容 | 估时 |
|---|---|---|
| M1 | 共享组件 + DB v6 + 启动中心（页面/CRUD/运行/图标/分组/标签/拖拽） | 3 天 |
| M2 | 剪贴板：目录改名、移出弹窗、目录内拖拽排序 | 1–2 天 |
| M3 | 密码本：分类下拉选择、重命名、删除并迁移到未分类 | 1 天 |
| M4 | 回归测试（剪贴板/密码本/启动中心）+ typecheck/build + 沙盒冒烟 | 1 天 |
