# tasks: medium-novel-workflow

## 已完成

- [x] 分析代码现状，确认已有能力与缺口（出处：`short-story-workflow.ts`、`agents/`、`tools/obsidian/`、`schemas/`）
- [x] 澄清第一轮：确认并存方案（新建独立模块，不修改短篇）
- [x] 澄清第二轮：确认 suspend 由输入参数控制（`suspendAfterBible` / `suspendAfterChapterPlan`）
- [x] 澄清第三轮：确认 continuity 上下文方案（固定注入 + `obsidian-search-notes-tool` 搜索）
- [x] 澄清第四轮：确认规划 Agent 合并为 `novelPlannerAgent`

## 待确认

- [x] 用户确认 `spec.md` 内容可进入 Apply 阶段
- [x] **兼容性细节**：`foreach(ChapterWorkflow)` 是传入 Workflow 实例还是 Step，已通过 Mastra 1.24.0 本地文档确认支持 `foreach(workflow)`，并在 `novelWorkflow` 实现中落地
- [x] **compressed 触发时机**：采用固定窗口策略，始终保留最近 5 章在 `recent`，更早章节滚动压入 `compressed`
- [x] **novelLauncherAgent**：确认本期不实现，后续独立跟进

## 实施任务（确认后执行）

### Phase 1：Schema 与基础结构

- [x] 新建 `src/mastra/schemas/novel-schema.ts`
  - 前置：用户确认 spec
  - 内容：`novelRequestSchema`、`novelStateSchema`（含三级摘要）、`chapterBriefSchema`（含 `dependencyMode`）、`chapterResultSchema`、`novelManifestSchema`
  - 风险：Schema 体积较大，需覆盖全流程所有步骤的输入输出

### Phase 2：Agent 实现

- [x] 新建 `src/mastra/agents/novel-planner-agent.ts`
  - 模型：`qwen3.6-plus`；输出：structured（Zod）；无工具；无记忆
- [x] 新建 `src/mastra/agents/chapter-drafter-agent.ts`
  - 模型：`qwen3.6-plus`；输出：Markdown 正文；无工具；无记忆
- [x] 新建 `src/mastra/agents/chapter-editor-agent.ts`
  - 模型：`qwen3.6-plus`；输出：Markdown + revision notes；无工具；无记忆
- [x] 新建 `src/mastra/agents/continuity-checker-agent.ts`
  - 模型：`qwen3.6-plus`；输出：structured 检查报告；工具：`obsidian-search-notes-tool`
  - 注意：system prompt 需包含 5 条固定检查清单
- [x] 新建 `src/mastra/agents/chapter-summarizer-agent.ts`
  - 模型：`qwen3.5-flash`；输出：structured 摘要；无工具；无记忆

### Phase 3：Workflow 实现

- [x] 最小验证用例：确认 `@mastra/core@1.24.0` 支持 `foreach(nestedWorkflow)`
  - 前置：Phase 2 完成
  - 若不支持，回退方案：展开为顺序 Step 链
- [x] 新建 `src/mastra/workflows/chapter-workflow.ts`
  - 步骤：buildChapterBrief → draftChapter → editChapter → [conditionalContinuityCheck] → summarizeChapter → writeChapterFiles → updateState
  - `dependencyMode: 'sequential'` 时额外读取 `mustReadChapters` 对应文件
- [x] 新建 `src/mastra/workflows/novel-workflow.ts`
  - 步骤：normalizeBrief → buildStoryBible → [suspend?] → buildChapterPlan → [suspend?] → foreach(chapterWorkflow) → compileManuscript → parallel([buildBookSummaries, buildMetadata, buildIndex]) → writeVaultArtifacts → buildManifest
  - State 管理：每章更新三级摘要、openLoops、timeline、fileManifest

### Phase 4：注册与集成

- [x] 修改 `src/mastra/index.ts`：注册 `novelWorkflow`、`chapterWorkflow` 和 5 个新 Agent
- [x] 运行 `npm run build` 验证编译通过

### Phase 5：验收

- [ ] 手动触发 `novelWorkflow`，1.3万字规模（约 10 章）跑通全流程
  - 受限于当前环境无可用 DashScope 网络/密钥；已使用本地 fallback 跑通 `targetWords=12000` 的 7 章链路并完成 Obsidian 落盘
- [ ] 验证 `suspendAfterBible=true` 时正确暂停并可 resume
  - 已验证 `start()` 返回 `suspended`；`resume()` 受限于当前独立 workflow 运行缺少 snapshot storage，沙箱内又无法连接项目默认 PostgreSQL，暂未完成实跑
- [ ] 验证 `continuityCheckerAgent` 正确调用 `obsidian-search-notes-tool`
  - 已验证 agent wiring 已暴露到请求层（continuity checker 的失败请求包含 `tools`），但无在线模型环境时无法确认真实 tool call 往返
- [x] 验证 Obsidian 目录结构符合 spec 定义
- [x] 运行 `npm run test` 确认短篇 Workflow 无回归
