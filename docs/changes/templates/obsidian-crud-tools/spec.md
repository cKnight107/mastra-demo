# obsidian-crud-tools

## 背景

项目已有 `saveObsidianStoryTool`（专为短篇小说落库设计），但缺乏通用的 Obsidian vault CRUD 操作能力。本次目标是新增一套与场景无关的通用 Obsidian 笔记工具，与现有 story tool 并存、各司其职。

## 代码现状

### 已有能力

- `saveObsidianStoryTool`：写入 Markdown 笔记，含 frontmatter 自动生成、路径安全校验（路径穿越防护）、文件名去重、字符清洗。
  - 代码出处：`src/mastra/tools/save-obsidian-story-tool.ts`
- 安全基础设施已经成熟：`resolveVaultSubpath`、`sanitizePathSegment`、`sanitizeFileName`、`ensureTrailingSeparator` 等函数均可复用。
  - 代码出处：`src/mastra/tools/save-obsidian-story-tool.ts:88-103`
- `OBSIDIAN_VAULT_PATH` 环境变量已在项目中使用，约定为 vault 根目录绝对路径。
  - 代码出处：`src/mastra/tools/save-obsidian-story-tool.ts:72-79`
- Mastra tool 注册模式已成熟，`createTool()` + `inputSchema` + `outputSchema` + `execute` 是标准结构。
  - 代码出处：`src/mastra/tools/weather-tool.ts`、`src/mastra/tools/route-cities-tool.ts`
- `src/mastra/index.ts` 统一注册所有 agents/tools/workflows，新 tools 需在此处或 agent 的 `tools` 字段中引用。
  - 代码出处：`src/mastra/index.ts:54-57`

### 明确缺口

- 没有读取笔记内容的工具
- 没有列举目录笔记的工具
- 没有全局搜索工具
- 没有更新已有笔记内容的工具
- 没有仅更新 frontmatter 的工具
- 没有追加内容的工具
- 没有删除笔记的工具
- 没有移动/重命名笔记的工具
- 现有工具绑定小说场景（genre、style、summary 字段），无法直接复用为通用接口

## 功能点

新增以下 8 个通用 Obsidian 笔记 tool，文件统一放在 `src/mastra/tools/obsidian/` 目录：

| Tool ID | 文件 | 功能 |
|---|---|---|
| `obsidian-read-note` | `read-note-tool.ts` | 按 vault 相对路径读取笔记完整内容（frontmatter + 正文）|
| `obsidian-list-notes` | `list-notes-tool.ts` | 列出指定目录下的所有 `.md` 文件，返回相对路径列表 |
| `obsidian-search-notes` | `search-notes-tool.ts` | 按关键词搜索笔记；默认只搜文件名+frontmatter，`searchContent: true` 时扩展到正文 |
| `obsidian-create-note` | `create-note-tool.ts` | 创建通用 Markdown 笔记，支持任意 folder/tags，不绑定小说字段 |
| `obsidian-update-note` | `update-note-tool.ts` | 替换已有笔记的正文内容，自动更新 frontmatter 中的 `updated` 字段 |
| `obsidian-patch-frontmatter` | `patch-frontmatter-tool.ts` | 仅更新 frontmatter 中的指定字段，不修改正文 |
| `obsidian-append-note` | `append-note-tool.ts` | 在笔记末尾追加文本内容 |
| `obsidian-delete-note` | `delete-note-tool.ts` | 删除笔记；`moveToTrash: true`（默认）移入 `_trash/` 目录，`false` 直接删除 |
| `obsidian-move-note` | `move-note-tool.ts` | 移动笔记到新路径或重命名文件 |

> **注意**：`obsidian-create-note` 与 `saveObsidianStoryTool` 并存，前者通用，后者专用（含小说专有字段）。

## 变更范围

### 预计新增

- `src/mastra/tools/obsidian/` 目录，包含以下文件：
  - `read-note-tool.ts`
  - `list-notes-tool.ts`
  - `search-notes-tool.ts`
  - `create-note-tool.ts`
  - `update-note-tool.ts`
  - `patch-frontmatter-tool.ts`
  - `append-note-tool.ts`
  - `delete-note-tool.ts`
  - `move-note-tool.ts`
  - `index.ts`（统一导出所有 obsidian tools）
- `src/mastra/tools/obsidian/shared.ts`：提取公共函数（vault 路径解析、安全校验、frontmatter 解析/序列化），避免各 tool 重复实现

### 预计修改

- `src/mastra/index.ts`：注册新 tools（如有全局注册需求）或在相关 agent 的 `tools` 字段中引用

### 本次不修改

- `src/mastra/tools/save-obsidian-story-tool.ts`（保持不动，专用 story 场景继续使用）
- 现有 agent、workflow、storage、鉴权结构
- Obsidian 社区插件、MCP server 接入方式

## 技术决策

| 决策点 | 选择 | 原因 |
|---|---|---|
| 工具通用程度 | 通用 CRUD，不绑定场景 | 用户确认选项 A：与 story tool 并存，各司其职 |
| 删除策略 | 双模式：`moveToTrash`（默认 true）+ 直接删除 | 用户确认选项 C：灵活，默认安全 |
| 搜索范围 | 双模式：默认仅元数据，`searchContent: true` 扩展到正文 | 用户确认选项 C：兼顾性能与覆盖面 |
| 路径安全 | 复用现有 `resolveVaultSubpath` 逻辑，所有路径操作均限制在 vault 根目录内 | 与现有安全实践保持一致 |
| frontmatter 解析 | 手动解析 YAML（不引入外部依赖），与现有 `toYamlString` 风格保持一致 | 避免增加依赖，项目现有实现可参照 |
| 回收站路径 | vault 根目录下 `_trash/`，保留原始相对路径结构 | 便于恢复，不污染其他目录 |

## 风险

| 风险 | 等级 | 缓解方式 |
|---|---|---|
| 删除操作不可逆（直接删除模式） | 中 | 默认 `moveToTrash: true`，tool 描述中明确标注风险 |
| `search-notes` 全文模式在大 vault 下性能差 | 中 | 默认关闭全文搜索；tool 描述中说明性能影响 |
| frontmatter 手动解析可能遗漏边缘格式 | 低 | 仅处理本工具集自身生成的标准 frontmatter 格式；对异常格式做容错处理 |
| `move-note` 后 Obsidian 内部链接失效 | 低 | tool 描述中注明"不会自动更新 vault 内的 wikilink" |
| 路径穿越攻击 | 低 | 所有路径操作均经过 `resolveVaultSubpath` 校验 |

## 待澄清

无。所有关键问题已在提案阶段确认：

- ✅ 工具通用程度：选项 A（通用 CRUD）
- ✅ 操作范围：全部 8 个操作
- ✅ 删除策略：选项 C（双模式，默认移入回收站）
- ✅ 搜索范围：选项 C（双模式，默认仅元数据）
