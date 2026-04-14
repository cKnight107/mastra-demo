# tasks: story-launcher-novel-support

## 已完成

- [x] 分析 `story-launcher-agent.ts` 现状，确认工具绑定、instructions、working memory 结构（出处：`story-launcher-agent.ts:1-84`）
- [x] 确认 `novelWorkflow` 已实现并注册（出处：`index.ts:40,90`）
- [x] 确认 `novelManifestSchema` 含 `stats.chapterCount`（出处：`novel-schema.ts:319-329`）
- [x] 澄清第一轮：模式判断方式 → 对话识别关键词，模糊时追问
- [x] 澄清第二轮：工具架构 → 新建两个独立工具文件，短篇工具零改动
- [x] 澄清第三轮：suspend 参数 → 仅用户主动提及时收集，默认 false

## 待确认

- [ ] 用户确认 `spec.md` 内容可进入 Apply 阶段
- [ ] `launchNovelWorkflowResultSchema` 等新 schema 加在 `novel-schema.ts` 末尾（无阻塞，Apply 阶段直接落地）

## 实施任务（确认后执行）

> 全部处于 pending 状态，等待用户显式确认后方可开始。

### Phase 1：新增 Schema

- [ ] 在 `src/mastra/schemas/novel-schema.ts` 末尾追加三个 schema：
  - `launchNovelWorkflowResultSchema`：`{ runId, status, projectSlug, message }`
  - `novelWorkflowRunLookupSchema`：`{ runId: z.string() }`
  - `novelWorkflowRunQueryResultSchema`：`{ runId, found, status, manifest: novelManifestSchema | null, errorMessage }`

### Phase 2：新建工具

- [ ] 新建 `src/mastra/tools/launch-novel-workflow-tool.ts`
  - 输入：`novelRequestSchema`；输出：`launchNovelWorkflowResultSchema`
  - 执行：`novelWorkflow.createRun().startAsync()`
- [ ] 新建 `src/mastra/tools/get-novel-workflow-run-tool.ts`
  - 输入：`novelWorkflowRunLookupSchema`；输出：`novelWorkflowRunQueryResultSchema`
  - 执行：`novelWorkflow.getWorkflowRunById()`，解析 `novelManifestSchema`

### Phase 3：修改 Agent

- [ ] 修改 `src/mastra/agents/story-launcher-agent.ts`
  - instructions：追加模式识别规则、中篇参数收集规则、中篇工具调用规则、中篇结果展示规则（含章节数）
  - tools：新增 `launchNovelWorkflowTool`、`getNovelWorkflowRunTool`
  - working memory template：追加 `workflowMode`、`suspendAfterBible`、`suspendAfterChapterPlan`、`latestChapterCount`

### Phase 4：注册与集成

- [ ] 修改 `src/mastra/index.ts`：注册 `launchNovelWorkflowTool`、`getNovelWorkflowRunTool`
- [ ] 运行 `npm run build` 验证编译通过

### Phase 5：验收

- [ ] 向 Agent 发送"我想写一个中篇故事，大概 5 万字"，确认 Agent 切换到 novel 模式并调用 `launchNovelWorkflowTool`
- [ ] 向 Agent 发送短篇请求，确认仍调用 `launchStoryWorkflowTool`（无回归）
- [ ] 中篇 workflow 完成后，查询结果包含 `stats.chapterCount` 展示
- [ ] 发送"帮我写完大纲先暂停"，确认 Agent 设置 `suspendAfterBible=true`
- [ ] 运行 `npm run test` 确认短篇无回归
