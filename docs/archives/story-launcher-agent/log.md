# log: story-launcher-agent

## 2026-04-09

- 用户在 spec-review 后提出对话式 launcher 需求
- 讨论两种方案（A: 直接 import workflow；B: 通过 mastra 实例查找）
- 用户确认采用方案 A
- 完成 spec-propose，生成三个文档，等待用户确认进入 Apply
- 用户明确要求“完成全部需求”，切换到 `feature/story-launcher-agent` 分支执行批量 Apply
- 按 `mastra` 技能校验当前安装版本的真实 API：
  - `createTool` / `Agent` / `Memory` / `workflow.createRun()` / `run.start({ inputData })` 当前签名均可直接使用
  - 发现 propose 阶段记录的 `run.start(...).output` 与当前安装版 `@mastra/core@1.24.0` 不一致，真实返回字段为 `result.result`，已按实际 API 实现并同步回 `tasks.md`
- 新增 `src/mastra/tools/launch-story-workflow-tool.ts`
  - `launchStoryWorkflowTool` 直接 import `shortStoryWorkflow`
  - 使用 `storyRequestSchema` / `artifactManifestSchema`
  - 对非 `success` 状态显式抛错
- 新增 `src/mastra/agents/story-launcher-agent.ts`
  - 绑定 `qwen36PlusModel`
  - 绑定 `launchStoryWorkflowTool`
  - 复用 `storage`，配置 `lastMessages: 20`
  - working memory 使用 `thread` scope，仅记录本轮故事启动上下文
  - instructions 明确要求：集中追问缺失必填字段、优先自动推导 `projectSlug`、用户明确要生成时直接调用 tool、结果按自然语言总结
- 更新 `src/mastra/index.ts`
  - 注册 `storyLauncherAgent`
  - 同时注册 `launchStoryWorkflowTool`，与仓库“新增工具需在 index.ts 注册”的规则保持一致

### 验证证据

- 构建验证
  - 运行 `npm run build`
  - Mastra CLI 返回 `Build successful`
- Studio 可见性验证
  - 启动 `npm run dev`
  - `http://localhost:4111/api/agents` 返回 `story-launcher-agent`
  - Playwright 快照在 `/agents` 页面中确认出现 `Story Launcher Agent`
- 对话触发验证
  - 调用 `POST http://localhost:4111/chat/story-launcher-agent`
  - SSE 事件返回 `tool-input-available`
  - 事件中可见 agent 自动组装的入参包含：
    - `projectSlug: "disillusioned-reporter-blackout"`
    - `exportProfile: "minimal"`
    - `targetWords: 1200`
  - 说明“自然语言 -> 补参 -> 触发 tool”链路成立，且未提供 `projectSlug` 时自动推导成功
- minimal 文件写入验证
  - 直接调用构建产物中的 `launchStoryWorkflowTool.execute(...)`
  - 使用真实 vault 路径，写入 `Stories/launcher-evidence-minimal`
  - 产物返回 5 个文件：
    - `index.md`
    - `brief.md`
    - `story.md`
    - `summary.md`
    - `metadata.md`
  - 实际文件已落盘到 `~/Documents/Obsidian Vault/Stories/launcher-evidence-minimal/`
  - `metadata.md` 中记录 `exportProfile: minimal`

### 新发现

- Mastra dev 环境中的 AI SDK chat 路由实际可用地址为 `/chat/:agentId`；`/api/openapi.json` 虽由 `/api` 暴露，但 path 级 `servers` 会覆盖到根路径，直接请求 `/api/chat/:agentId` 会得到 404
- 浏览器版 Playwright MCP 在当前桌面环境尝试写入 `/.playwright-mcp` 会失败；改用本地 `playwright_cli.sh` wrapper 可以稳定完成 Studio 页面验证

## 2026-04-10

- 进入 `spec-fix`，修复 review finding：`src/mastra/agents/models.ts` 使用不存在的 `dashscope` provider key，导致 Mastra 运行时在初始化 embedding model 时抛出 `Unknown provider: dashscope`
- 按 `mastra` skill 重新核对当前安装版 provider registry：
  - `dashscope` 不存在于 `node .agents/skills/mastra/scripts/provider-registry.mjs --list`
  - Dashscope 中国站在当前 registry 中对应 provider key 为 `alibaba-cn`
  - `qwen3.5-plus` / `qwen3.6-plus` / `qwen3.5-flash` 均存在于 `alibaba-cn` models 列表
- 对 `src/mastra/agents/models.ts` 做最小闭环修正：
  - `createDashscopeModel()` 改为返回 `OpenAICompatibleConfig { providerId: 'alibaba-cn', modelId, url, apiKey }`
  - 为 Dashscope compatible API 补默认 base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
  - 同步将 `textEmbeddingV4Model` 也切到同一条兼容配置路径，避免启动阶段再次因 provider 解析失败中断

### 修正后验证证据

- 构建验证
  - 再次运行 `npm run build`
  - Mastra CLI 返回 `Build successful`
- 运行时加载验证
  - 执行 `node -e "import('./.mastra/output/mastra.mjs')..."`
  - 进程已不再抛出 `Unknown provider: dashscope`
  - 当前新的失败点为 PostgreSQL 连接 `EPERM`（沙箱阻止连接 `127.0.0.1:5432` / `::1:5432`），说明 provider 配置问题已被绕开，剩余是环境访问限制而非本次 finding 未修复
- 端口监听验证
  - 执行 `node .mastra/output/index.mjs`
  - 当前失败为监听 `0.0.0.0:4111` 的 `EPERM`
  - 同样未再出现 provider 解析错误

### fix-2（launcher 改为异步 workflow 启动）

- 问题来源：
  - 用户在归档需求上线后发现，`storyLauncherAgent` 通过对话触发 `shortStoryWorkflow` 时，因为 workflow 执行很慢，聊天链路会在同步等待期间超时。
  - 根因是 `src/mastra/tools/launch-story-workflow-tool.ts` 使用 `run.start({ inputData })`，把长耗时 workflow 完整绑在单次 tool call 内。
- 修正动作：
  - 按当前安装版 Mastra 文档改用 `Run.startAsync()` 启动后台执行。
  - `launchStoryWorkflowTool` 现在返回：
    - `runId`
    - `status: pending`
    - `projectSlug`
    - 用于提示后续查询的 message
  - 新增 `src/mastra/tools/get-story-workflow-run-tool.ts`
    - 使用 `shortStoryWorkflow.getWorkflowRunById(runId, { fields: ['result', 'error'] })`
    - 对 `result` 用 `artifactManifestSchema.safeParse()` 做二次校验
    - 返回 success / in-progress / not-found / failed 场景所需的结构化信息
  - 更新 `src/mastra/agents/story-launcher-agent.ts`
    - 绑定新查询 tool
    - 指令新增“优先判断是新启动还是查状态”
    - working memory 增加 `latestRunId` / `latestRunStatus` / `latestRunProjectSlug`
  - 更新 `src/mastra/index.ts`，注册新查询 tool。

### 修正后验证证据

- 文档验证
  - 重新核对当前安装版 Mastra embedded docs：
    - `Run.startAsync()` 文档存在于 `node_modules/@mastra/core/dist/docs/references/reference-workflows-run-methods-startAsync.md`
    - `Workflow.getWorkflowRunById()` 类型存在于 `node_modules/@mastra/core/dist/workflows/workflow.d.ts`
- 代码验证
  - 扩展 `scripts/validate-short-story-workflow.ts`
  - 在脚本中 mock：
    - `shortStoryWorkflow.createRun()`，验证 `launchStoryWorkflowTool` 立即返回 `runId: async-run-123`
    - `shortStoryWorkflow.getWorkflowRunById()`，验证 `getStoryWorkflowRunTool` 能返回：
      - `status: success` + manifest
      - `found: false` + not-found errorMessage
  - 同时校验 `launchStoryWorkflowTool` 会把 tool context 中的 `resourceId` 透传给 `createRun({ resourceId })`

### 文档同步

- `spec.md`
  - 将 launcher 的长耗时执行模式从“同步等待完成”改为“异步启动 + 轮询查询”
  - 增加状态查询 tool 的行为与风险缓解
- `tasks.md`
  - 新增本轮 async fix 任务并标记完成
- `log.md`
  - 记录问题来源、Mastra 文档依据、修正动作与验证方式
