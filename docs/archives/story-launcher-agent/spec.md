# spec: story-launcher-agent

## 代码现状

### 已有能力

| 资产 | 路径 | 说明 |
|------|------|------|
| `shortStoryWorkflow` | `src/mastra/workflows/short-story-workflow.ts` | 已完整实现，export，接受 `storyRequestSchema` 输入，返回 `artifactManifestSchema` |
| `storyRequestSchema` | `src/mastra/schemas/short-story-schema.ts:7-20` | 12 字段，必填：`projectSlug`、`premise`、`genre`、`tone`、`targetWords`；其余有默认值 |
| `artifactManifestSchema` | `src/mastra/schemas/short-story-schema.ts:136-145` | 包含 `projectDir`、`title`、`primaryFile`、`files`、`stats.wordCount`、`warnings` |
| `@mastra/memory` | `package.json` `^1.15.0`，已安装 | 支持 `workingMemory`（thread/resource scope），`chef-teaching-agent` 已有完整使用范式 |
| Memory + storage 范式 | `src/mastra/agents/chef-teaching-agent.ts:72-93` | 含 `storage` 引用、`lastMessages`、`workingMemory` template 完整写法 |
| `storage` | `src/mastra/storage.ts`（被 `index.ts` 和 `chef-teaching-agent` 引用） | PostgreSQL 持久化存储，可直接复用 |
| `createTool` | `@mastra/core/tools` | 文档确认 API：`id`、`description`、`inputSchema`、`outputSchema`、`execute` |
| Workflow 启动 API | `@mastra/core/workflows` | `workflow.createRun()` → `run.start({ inputData })` → `result.result` |
| `qwen36PlusModel` | `src/mastra/agents/models.ts:20-22` | 通过 Mastra `alibaba-cn` provider + Dashscope compatible base URL 访问 qwen3.6-plus，现有 story agents 同款 |
| `index.ts` | `src/mastra/index.ts` | 已注册 `shortStoryWorkflow` 和 4 个 story agents，需追加新 agent |

### 缺口

- 无对话式入口：`shortStoryWorkflow` 只能通过 Studio 手动填参数触发，无法通过对话自然语言驱动
- 无参数采集 Tool：缺少把 LLM 决策转化为 `storyRequestSchema` 并执行 workflow 的 Tool
- 无 Launcher Agent 文件

---

## 功能点

### 目标

新增一个对话式 `storyLauncherAgent`，让用户通过自然语言描述故事需求，Agent 自动归纳参数并触发 `shortStoryWorkflow`，返回生成结果摘要。

### 用户价值

- 无需手动填写 JSON 参数，只需用自然语言说"我想写一个关于 X 的故事"
- Agent 自动追问缺失字段，最终组装完整入参
- 先异步启动长耗时 workflow，避免聊天链路被长时间阻塞
- 用户后续可按 runId 查询进度；完成后再展示文件路径、字数、primaryFile 等关键信息

### 行为变化

| 变化点 | 旧行为 | 新行为 |
|--------|--------|--------|
| Workflow 触发方式 | Studio 手动填参 | 对话式 Agent 自动组装 |
| 参数采集 | 无 | 多轮对话收集，缺失时追问 |
| 启动方式 | Tool 同步等待 workflow 结束 | Tool 异步返回 runId，后台执行 |
| 结果展示 | Studio 返回 JSON | Agent 可分两段：先确认已启动，再查询并总结结果 |

---

## Workflow 入参分级

| 字段 | 类型 | 是否必须追问 | 默认值 |
|------|------|-------------|--------|
| `premise` | string | **必须** | — |
| `genre` | string | **必须** | — |
| `tone` | string | **必须** | — |
| `targetWords` | number | **必须** | — |
| `projectSlug` | string | **必须** | 可由 Agent 从 premise 自动推导 |
| `language` | enum | 可选 | `zh-CN` |
| `exportProfile` | enum | 可选 | `authoring` |
| `pov` | string | 可选 | — |
| `endingStyle` | string | 可选 | — |
| `mustInclude` | string[] | 可选 | `[]` |
| `mustAvoid` | string[] | 可选 | `[]` |
| `referenceNotes` | string[] | 可选 | `[]` |

---

## 技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Workflow 调用方式 | 方案 A + async：Tool 直接 import `shortStoryWorkflow`，启动时使用 `createRun().startAsync()`，查询时使用 `getWorkflowRunById()` | 保留最简单引用关系，同时避免聊天请求长期等待 workflow 完成 |
| Tool 文件位置 | `src/mastra/tools/launch-story-workflow-tool.ts` | 与现有 tools 目录结构一致 |
| Agent 模型 | `qwen36PlusModel`（`alibaba-cn/qwen3.6-plus`，复用 Dashscope compatible URL） | 与现有 story agents 同款，且兼容当前安装版 Mastra provider registry |
| Memory 类型 | `workingMemory`（thread-scoped） + `lastMessages: 20` | thread-scoped：同一对话内记住已收集字段即可；resource-scoped 适合跨会话用户画像，本场景不需要 |
| Memory storage | 复用 `src/mastra/storage.ts` 的 pgStorage | 与 `chef-teaching-agent` 保持一致 |
| `projectSlug` 处理 | Agent instructions 中说明：可从 premise 自动推导英文/拼音 slug，或追问用户 | 减少用户摩擦，workflow 内部已有规范化逻辑 |
| 长耗时结果查询 | 新增独立状态查询 tool | Agent 后续可查询 runId 的完成态、失败态和最终 manifest |

---

## 变更范围

### 会新增的文件

| 文件 | 说明 |
|------|------|
| `src/mastra/tools/launch-story-workflow-tool.ts` | `launchStoryWorkflowTool`，inputSchema = `storyRequestSchema`，内部调用 `shortStoryWorkflow.createRun().startAsync()` |
| `src/mastra/tools/get-story-workflow-run-tool.ts` | `getStoryWorkflowRunTool`，inputSchema = `runId`，内部调用 `shortStoryWorkflow.getWorkflowRunById()` |
| `src/mastra/agents/story-launcher-agent.ts` | `storyLauncherAgent`，含 Memory、工具绑定、instructions |

### 会修改的文件

| 文件 | 变更类型 |
|------|---------|
| `src/mastra/index.ts` | 追加 `storyLauncherAgent` 到 `agents` 注册表 |

### 不会修改的文件

- `src/mastra/workflows/short-story-workflow.ts`（只读引用）
- `src/mastra/schemas/short-story-schema.ts`（只读引用）
- 现有 4 个 story agents
- `src/mastra/storage.ts`（只读引用）

---

## 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| Workflow 执行时间长（可能 > 1min），Agent 超时 | 中 | 启动工具改用 `startAsync()`，立即返回 runId；由独立状态查询 tool 查询完成态 |
| Agent 自动推导的 `projectSlug` 与已有目录冲突 | 低 | `normalizeBriefStep` 已有冲突检测并记录 warning |
| 状态查询时拿到的 `run.result` 结构异常 | 低 | 查询 tool 使用 `artifactManifestSchema.safeParse()` 二次校验，不符合预期则返回错误说明 |
| Memory storage（pg）未配置时 Agent 启动失败 | 低 | 与 `chef-teaching-agent` 相同依赖，环境已就绪 |
| Dashscope provider key 与 Mastra 当前 registry 不一致导致运行时启动失败 | 中 | `models.ts` 统一改为 `OpenAICompatibleConfig { providerId: 'alibaba-cn', modelId, url }`，避免使用不存在的 `dashscope` provider key |

---

## 待澄清

无。方案已在 propose 阶段与用户确认（方案 A），所有关键决策已锁定。
