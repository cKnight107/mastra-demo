# log: story-launcher-novel-support

## 提案阶段

### 2026-04-14 — 需求澄清记录

**背景**：`novelWorkflow` 已在上一个 change（`medium-novel-workflow`）中完成实现，现需要将现有 `storyLauncherAgent` 改造为同时支持短篇和中篇的统一入口。

**三轮澄清结论**：

| 轮次 | 问题 | 决策 |
|---|---|---|
| 第一轮 | 如何判断短篇 vs 中篇 | 对话识别关键词，模糊时主动追问，不静默推断 |
| 第二轮 | 工具架构 | 新建两个独立工具文件，短篇工具零改动 |
| 第三轮 | suspend 参数收集 | 仅用户主动提及时收集，默认 false |

**关键约束**：Agent id `story-launcher-agent` 保持不变，避免历史 thread memory 丢失。

**待实现阶段记录**：（Apply 阶段填写）

## Apply 阶段

### 2026-04-14 — Phase 1：补齐 novel workflow schema

**执行前置**：

- 用户已显式要求按 `spec-apply` 开始实施，确认进入 Apply 阶段。
- 当前分支原为 `main`，按流程切换到 `feature/story-launcher-novel-support` 后再开始修改。

**本次实现**：

- 在 `src/mastra/schemas/novel-schema.ts` 末尾新增 `launchNovelWorkflowResultSchema`。
- 在 `src/mastra/schemas/novel-schema.ts` 末尾新增 `novelWorkflowRunLookupSchema`。
- 在 `src/mastra/schemas/novel-schema.ts` 末尾新增 `novelWorkflowRunQueryResultSchema`，其中 `status` 直接内联 workflow 状态枚举，避免超出本 task 约定的“三个 schema”范围。

**验证证据**：

- 运行 `npm run build` 成功，Mastra CLI 输出 `Build successful, you can now deploy the .mastra/output directory to your target platform.`

**新增发现**：

- `tasks.md` 中“待确认”里的 Apply 入口和 schema 落地项在用户显式进入 Apply 后可直接转为完成项，无需再额外等待确认。

### 2026-04-14 — Phase 2-5：工具、Agent、注册与验收

**本次实现**：

- 新增 `src/mastra/tools/launch-novel-workflow-tool.ts`，对称复用短篇启动工具模式，使用 `novelWorkflow.createRun({ resourceId }).startAsync()` 异步启动中篇 workflow。
- 新增 `src/mastra/tools/get-novel-workflow-run-tool.ts`，通过 `novelWorkflow.getWorkflowRunById(runId, { fields: ['result', 'error'] })` 查询状态，并解析 `novelManifestSchema`。
- 修改 `src/mastra/agents/story-launcher-agent.ts`：
  - instructions 增加 short/novel 模式识别规则、双工具路由规则、中篇暂停参数采集规则和中篇结果展示要求。
  - tools 增加 `launchNovelWorkflowTool`、`getNovelWorkflowRunTool`。
  - working memory template 增加 `workflowMode`、`suspendAfterBible`、`suspendAfterChapterPlan`、`latestChapterCount`。
- 修改 `src/mastra/index.ts`，注册 `launchNovelWorkflowTool` 与 `getNovelWorkflowRunTool`。

**验证证据**：

- 运行 `npm run build` 成功，Mastra CLI 输出 `Build successful, you can now deploy the .mastra/output directory to your target platform.`
- 运行临时 source 级验证脚本（esbuild 打包 `/tmp/validate-novel-workflow-tools.ts` 后执行）成功，输出：
  - `case: "novel-launcher-async-tools"`
  - `launchStatus: "pending"`
  - `queryStatus: "success"`
  - `chapterCount: 2`
- 运行 `npm test` 成功退出，并输出既有短篇回归用例：
  - `minimal-no-reference`
  - `authoring-with-reference`
  - `story-launcher-async-tools`

**未完成验证与阻塞**：

- 未能完成 story launcher 的真实对话级验收（“我想写一个中篇故事，大概 5 万字”“帮我写完大纲先暂停”等），因为当前环境中：
  - `DASHSCOPE_API_KEY` 未设置；
  - 短篇测试脚本的上游 LLM 地址解析为 `http://0.0.0.0.invalid/chat/completions`，请求报 `getaddrinfo ENOTFOUND 0.0.0.0.invalid`。
- 因此，本次只能确认代码接线、schema/工具/注册与短篇回归脚本无新增编译错误，不能在本地直接证明 LLM 会按新 instructions 选对 short/novel 工具。

**新增发现**：

- 现有 `npm test` 虽然最终成功，但依赖 fallback 路径完成，说明短篇回归脚本并不要求真实上游 LLM 可用。
- 若后续需要完成 story launcher 的真实对话验收，至少需要补齐可用的 DashScope 配置，或为 launcher agent 提供可控的 mock model 测试夹具。
