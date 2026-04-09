---
title: 厨师教学 Agent（chef-teaching-agent）
status: confirmed
created: 2026-04-09
---

# Spec: 厨师教学 Agent

## 1. 代码现状

### 1.1 Obsidian 工具（已有能力）

工具集位于 `src/mastra/tools/obsidian/`，通过 `src/mastra/tools/obsidian/index.ts` 统一导出，共 9 个工具：

| 工具 ID | 文件 | 功能摘要 |
|---|---|---|
| `obsidian-create-note` | `create-note-tool.ts` | 在指定目录创建笔记，写入 frontmatter（title/tags/created/updated） |
| `obsidian-read-note` | `read-note-tool.ts` | 按相对路径读取笔记，返回 frontmatter + content |
| `obsidian-list-notes` | `list-notes-tool.ts` | 列出指定目录下所有 `.md` 文件 |
| `obsidian-search-notes` | `search-notes-tool.ts` | 按关键词搜索（文件名/frontmatter/可选正文），支持 tag 过滤 |
| `obsidian-update-note` | `update-note-tool.ts` | 覆盖更新笔记正文和 frontmatter |
| `obsidian-append-note` | `append-note-tool.ts` | 在笔记末尾追加内容 |
| `obsidian-patch-frontmatter` | `patch-frontmatter-tool.ts` | 只更新 frontmatter 字段，不改动正文 |
| `obsidian-delete-note` | `delete-note-tool.ts` | 删除指定笔记文件 |
| `obsidian-move-note` | `move-note-tool.ts` | 移动/重命名笔记 |

**共享依赖**：`shared.ts` 提供路径安全校验（`resolveVaultSubpath` 防路径穿越）、frontmatter 解析/序列化、文件读写工具函数。所有工具通过 `process.env.OBSIDIAN_VAULT_PATH` 定位 vault 根目录。

**已在 index.ts 注册**：9 个 obsidian 工具已在 `src/mastra/index.ts:69-79` 注册到 Mastra 全局工具列表，但**尚未被任何 Agent 使用**。

出处：`src/mastra/index.ts:27-36`（import）、`src/mastra/index.ts:69-79`（注册）

### 1.2 现有 Agent 结构

| Agent | 文件 | 特点 |
|---|---|---|
| `weather-agent` | `agents/weather-agent.ts` | 带 Memory（workingMemory + semanticRecall + observational）+ scorers |
| `lesson-prep-agent` | `agents/lesson-prep-agent.ts` | 带 structuredOutput schema，无 tools，无 memory |
| `story-writer-agent` | `agents/story-writer-agent.ts` | 待查 |
| `travel-agent` | `agents/travel-agent.ts` | 待查 |

Agent 构造规范：使用 `new Agent({...})` from `@mastra/core/agent`，model 从 `agents/models.ts` 引入（当前可用：`qwen35PlusModel`、`qwen35FlashModel`、`qwen36PlusModel`、`gemma4E4bModel`）。

出处：`src/mastra/agents/models.ts:15-23`

### 1.3 环境约束

- `OBSIDIAN_VAULT_PATH`：必须在 `.env` 中配置，工具启动时校验。
- 所有工具操作均为本地文件系统，不需要额外网络权限。

---

## 2. 功能点

### 用户价值

用户用自然语言描述想做的菜（或提供菜名），Agent 返回详细的制作流程。同时可以将菜谱保存、查询、更新到 Obsidian vault，实现菜谱知识库管理。

### 核心行为

1. **菜品制作流程讲解**：根据用户描述的菜名或食材，给出分步骤、详细的烹饪流程（食材准备、处理、火候、调味、摆盘等）。
2. **菜谱保存到 Obsidian**：用户要求保存时，将菜谱以 Markdown 格式写入 vault（`obsidian-create-note`）。
3. **菜谱检索**：从 vault 搜索已有菜谱（`obsidian-search-notes`、`obsidian-list-notes`）。
4. **菜谱查看**：读取已存菜谱详情（`obsidian-read-note`）。
5. **菜谱更新**：修改已有菜谱内容（`obsidian-update-note`、`obsidian-append-note`）。

> 这是为了**测试 obsidian 工具集**——Agent 需要覆盖尽量多的 obsidian 工具，在实际交互中验证工具的正确性。

### 边界

- Agent **不**负责图片识别或视频解析。
- Agent **不**负责订购食材等外部操作。
- 是否启用 Memory（对话历史、偏好记忆）为待澄清项（见第 6 节）。

---

## 3. 变更范围

### 会修改的文件

| 文件 | 变更类型 |
|---|---|
| `src/mastra/agents/chef-teaching-agent.ts` | **新建** Agent 文件 |
| `src/mastra/index.ts` | 新增 import + 在 `agents` 中注册 |

### 不会修改的文件

- `src/mastra/tools/obsidian/` 下所有文件（只读取、不修改工具）
- 现有其他 Agent
- `src/mastra/storage.ts`（除非决定加 Memory）
- `docs/` 中其他规格文档

---

## 4. 风险

| 类型 | 描述 | 应对 |
|---|---|---|
| 环境 | `OBSIDIAN_VAULT_PATH` 未配置时所有 obsidian 工具会抛出错误 | 在 Agent instructions 中说明需配置；工具内部已有错误提示 |
| 路径安全 | `resolveVaultSubpath` 已防路径穿越，已覆盖 | 无需额外处理 |
| 模型选择 | Agent 需要较强中文理解和步骤生成能力 | 使用 `qwen35PlusModel` 或 `qwen36PlusModel`（待确认） |
| 工具覆盖 | 部分工具（move/delete）在厨师场景下语义较弱 | instructions 中引导 Agent 合理调用，测试时手动触发 |

---

## 5. 技术决策

### 已确认

- Agent 文件放置于 `src/mastra/agents/chef-teaching-agent.ts`，命名规范与现有 agent 一致。
- 工具直接从 `src/mastra/tools/obsidian` import，不做二次包装。
- 菜谱默认保存到 vault 内 `菜谱/` 子目录（可由用户在对话中覆盖）。
- **Q1：加 workingMemory（记忆用户口味偏好），配置同 weather-agent 风格**（选项 B）
- **Q2：使用 `qwen35PlusModel`**（选项 A）
- **Q3：不加 scorers**（选项 A）

---

## 6. 待澄清

> 所有待澄清项已于 2026-04-09 由用户确认，无剩余待澄清项。
