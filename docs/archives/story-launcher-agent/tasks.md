# tasks: story-launcher-agent

## 已完成

- [x] 分析仓库现状（shortStoryWorkflow、storyRequestSchema、chef-teaching-agent Memory 范式、createTool API、Workflow 启动 API）
- [x] 确认方案 A（Tool 直接 import workflow）
- [x] 生成 spec.md、tasks.md、log.md

## 待确认

- [x] 用户显式确认 spec.md 内容，进入 Apply 阶段

## 实施任务（确认后执行）

### 新增 Tool
- [x] 创建 `src/mastra/tools/launch-story-workflow-tool.ts`
  - `id`: `launch-story-workflow`
  - `inputSchema`: `storyRequestSchema`
  - `outputSchema`: `artifactManifestSchema`
  - `execute`: `shortStoryWorkflow.createRun()` → `run.start({ inputData })` → return `result.result`

### 新增 Agent
- [x] 创建 `src/mastra/agents/story-launcher-agent.ts`
  - model: `qwen36PlusModel`
  - tools: `{ launchStoryWorkflowTool }`
  - memory: `Memory({ storage, options: { lastMessages: 20, workingMemory: { enabled: true, scope: 'thread', template: ... } } })`
  - instructions: 覆盖参数采集流程、必填字段列表、确认后调用 tool、结果展示

### 注册
- [x] 更新 `src/mastra/index.ts`：追加 `storyLauncherAgent` 到 `agents`

### 验收
- [x] `npm run build` 无 TypeScript 错误
- [x] Mastra Studio 可见 `storyLauncherAgent`
- [x] 通过对话触发 workflow，检查 5 个文件写入 vault 成功（minimal profile）
- [x] 用户未提供 `projectSlug` 时，Agent 自动推导并正确传入

## Fix 任务（review 后）

- [x] 修复 `src/mastra/agents/models.ts` 中 Dashscope provider 与 Mastra 当前 registry 不兼容的问题
  - 将 Dashscope 模型声明改为 `OpenAICompatibleConfig { providerId: 'alibaba-cn', modelId, url, apiKey }`
  - 统一为 Dashscope compatible API 提供默认 base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
  - 同步覆盖聊天模型与 `textEmbeddingV4Model`
- [x] 重新验证构建与运行时加载
  - `npm run build` 通过
  - 加载 `.mastra/output/mastra.mjs` 时不再出现 `Unknown provider: dashscope`
  - 当前剩余阻塞变为沙箱环境下的 PostgreSQL 连接 `EPERM`，不属于本次 provider fix 未关闭项
