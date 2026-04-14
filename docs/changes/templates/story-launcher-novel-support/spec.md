# spec: story-launcher-novel-support

## 1. 代码现状

### 1.1 已有能力

| 事实 | 出处 |
|---|---|
| `storyLauncherAgent` 持有两个工具：`launchStoryWorkflowTool`、`getStoryWorkflowRunTool` | `story-launcher-agent.ts:51-54` |
| `launchStoryWorkflowTool` hardcode 导入 `shortStoryWorkflow`，输入 schema 为 `storyRequestSchema` | `launch-story-workflow-tool.ts:6,14` |
| `getStoryWorkflowRunTool` hardcode 导入 `shortStoryWorkflow`，解析 `artifactManifestSchema` | `get-story-workflow-run-tool.ts:6,29` |
| `novelWorkflow` 已实现并注册 | `index.ts:40,90` |
| `novelRequestSchema` 包含 `suspendAfterBible`、`suspendAfterChapterPlan` 两个布尔参数（默认 `false`）| `novel-schema.ts:23-24` |
| `novelManifestSchema` 包含 `stats.chapterCount`、`stats.wordCount`、`files`（章节文件路径列表）| `novel-schema.ts:319-329` |
| Agent 的 working memory 模板只含短篇字段，无 `workflowMode`、中篇专属参数 | `story-launcher-agent.ts:62-80` |

### 1.2 能力缺口

- 无 `launchNovelWorkflowTool`（需新建，绑定 `novelWorkflow`）
- 无 `getNovelWorkflowRunTool`（需新建，解析 `novelManifestSchema`）
- `storyLauncherAgent` 无模式感知逻辑，instructions 只描述短篇流程
- working memory 模板缺少：`workflowMode`、`suspendAfterBible`、`suspendAfterChapterPlan`、`latestChapterCount`

### 1.3 约束

- `story-launcher-agent` 的 Agent id 不变（涉及 thread memory 的 resourceId 路由，改 id 会导致历史 thread 丢失）
- 短篇工具文件（`launch-story-workflow-tool.ts`、`get-story-workflow-run-tool.ts`）不修改
- `novelWorkflow` 不修改
- `novelRequestSchema` 不修改

---

## 2. 功能点

### 2.1 用户价值

用户通过同一个对话界面，既能创作短篇也能创作中篇，无需切换 Agent 或手动填写 workflow 参数。中篇完成后可直接看到章节数、字数、文件列表等信息。

### 2.2 行为变化

| 行为 | 改造前 | 改造后 |
|---|---|---|
| 识别中篇意图 | 不支持 | 识别"中篇/多章节/长故事"等关键词，自动切换到 novel 模式 |
| 参数收集 | 短篇字段 | 中篇模式额外收集：`suspendAfterBible`、`suspendAfterChapterPlan`（仅用户主动提及时）|
| 启动 workflow | 只调 `launchStoryWorkflowTool` | 短篇调 `launchStoryWorkflowTool`，中篇调 `launchNovelWorkflowTool` |
| 查询状态 | 只调 `getStoryWorkflowRunTool` | 短篇调 `getStoryWorkflowRunTool`，中篇调 `getNovelWorkflowRunTool` |
| 结果展示 | 标题/目录/字数/文件数 | 中篇额外展示：**章节数**、每章文件路径、`suspendAfterBible` 暂停时的 story bible 预览提示 |
| working memory 追踪 | 无模式字段 | 新增 `workflowMode`、`suspendAfterBible`、`suspendAfterChapterPlan`、`latestChapterCount` |

### 2.3 边界

**本次包含：**
- 新建 `src/mastra/tools/launch-novel-workflow-tool.ts`
- 新建 `src/mastra/tools/get-novel-workflow-run-tool.ts`
- 修改 `src/mastra/agents/story-launcher-agent.ts`（instructions + tools + working memory）
- 修改 `src/mastra/index.ts`（注册两个新工具）

**本次不包含（后续再议）：**
- 执行过程中的实时章节进度（当前 `getWorkflowRunById` 只返回最终状态或 running，无逐章进度）
- suspend 后展示 story bible 内容供用户修改（需 resume + 参数传递，复杂度高）
- Agent 重命名（id 不变，避免 thread memory 丢失）

---

## 3. 技术设计

### 3.1 新工具：`launchNovelWorkflowTool`

```ts
// src/mastra/tools/launch-novel-workflow-tool.ts
createTool({
  id: 'launch-novel-workflow',
  description: '使用完整的中篇小说参数异步启动 novelWorkflow，立即返回 runId。',
  inputSchema: novelRequestSchema,          // 来自 novel-schema.ts
  outputSchema: launchNovelWorkflowResultSchema, // 新建，含 runId/status/projectSlug/message
  execute: async (inputData, context) => {
    const run = await novelWorkflow.createRun({ resourceId: context?.agent?.resourceId });
    const { runId } = await run.startAsync({ inputData });
    return { runId, status: 'pending', projectSlug: inputData.projectSlug, message: `...` };
  }
})
```

### 3.2 新工具：`getNovelWorkflowRunTool`

```ts
// src/mastra/tools/get-novel-workflow-run-tool.ts
createTool({
  id: 'get-novel-workflow-run',
  description: '根据 runId 查询 novelWorkflow 状态，完成后返回含章节数的产物清单。',
  inputSchema: novelWorkflowRunLookupSchema, // { runId: z.string() }
  outputSchema: novelWorkflowRunQueryResultSchema,
  execute: async ({ runId }) => {
    const workflowRun = await novelWorkflow.getWorkflowRunById(runId, { fields: ['result', 'error'] });
    // 解析 novelManifestSchema（含 stats.chapterCount）
  }
})
```

`novelWorkflowRunQueryResultSchema` 结构：
```ts
{
  runId, found, status,
  manifest: novelManifestSchema | null,  // 含 stats.chapterCount, stats.wordCount, files
  errorMessage: string | null
}
```

### 3.3 Agent 改造要点

**新增 instructions 节段（追加到现有指令末尾）：**

```
模式识别：
- 用户提到"中篇""多章节""长故事""章节数"，或 targetWords ≥ 30000 时，设置 workflowMode=novel。
- 明确说"短篇""几百字""千字"时，设置 workflowMode=short。
- 模式不明确时，主动问一句"您想写短篇还是多章节的中篇？"。

中篇模式额外规则：
- novel 模式下收集与短篇相同的必填字段（premise/genre/tone/targetWords），额外字段对齐 novelRequestSchema。
- suspendAfterBible / suspendAfterChapterPlan 默认 false，仅当用户说"先看大纲""生成规划后暂停"等才设为 true。
- 启动时调用 launchNovelWorkflowTool，查询时调用 getNovelWorkflowRunTool。

中篇结果展示：
- status=success 时，除标题/目录/字数外，额外说明章节数（stats.chapterCount）和章节文件列表。
- status=suspended 时，说明在哪个节点暂停，提示用户可继续。
- manifest.warnings 非空时，逐条列出。
```

**working memory 模板新增字段：**
```
- workflowMode:           # short | novel
- suspendAfterBible:      # true | false
- suspendAfterChapterPlan: # true | false
- latestChapterCount:     # 查询完成后记录
```

---

## 4. 变更范围

### 4.1 新增文件

| 文件 | 说明 |
|---|---|
| `src/mastra/tools/launch-novel-workflow-tool.ts` | 中篇 workflow 启动工具 |
| `src/mastra/tools/get-novel-workflow-run-tool.ts` | 中篇 workflow 状态查询工具 |

### 4.2 修改文件

| 文件 | 变更内容 |
|---|---|
| `src/mastra/agents/story-launcher-agent.ts` | instructions 追加中篇逻辑；tools 新增两个工具；working memory 模板追加 4 个字段 |
| `src/mastra/index.ts` | 注册 `launchNovelWorkflowTool`、`getNovelWorkflowRunTool` |

### 4.3 不变文件

- `src/mastra/tools/launch-story-workflow-tool.ts`
- `src/mastra/tools/get-story-workflow-run-tool.ts`
- `src/mastra/workflows/novel-workflow.ts`
- `src/mastra/schemas/novel-schema.ts`

---

## 5. 风险

| 风险 | 等级 | 说明 | 缓解措施 |
|---|---|---|---|
| Agent 模式误判（短篇/中篇混淆）| 低 | targetWords 模糊时可能误走 novel 模式 | instructions 明确：模式不确定时先追问，不静默推断 |
| working memory 字段过多，导致 token 占用增加 | 低 | 新增 4 个字段，但大多数时候值为空 | template 字段简洁，值为空时不影响 token |
| `getNovelWorkflowRunTool` 查询到 short 的 runId，反之亦然 | 低 | 两个工具各自绑定不同 workflow，runId 错配会返回 not found | Agent instructions 明确：novel runId 只用 novel 工具查，short runId 只用 short 工具查；working memory 记录 `workflowMode` |
| `novelManifestSchema` 的 `launchNovelWorkflowResultSchema` 需新定义 | 低 | 复制短篇 `launchStoryWorkflowResultSchema` 结构即可 | 可复用相同字段结构 |

---

## 6. 技术决策

| 决策 | 选择 | 放弃方案 |
|---|---|---|
| 模式判断方式 | 对话识别关键词，模糊时追问 | 按 targetWords 阈值自动分界；强制每次选择 |
| 工具架构 | 新建两个独立工具文件，短篇工具零改动 | 改造现有工具为统一版 |
| suspend 参数收集 | 仅用户主动提及时收集，默认 false | 中篇模式固定追问；完全不暴露 |
| Agent id | 保持 `story-launcher-agent` 不变 | 重命名（会导致历史 thread memory 丢失）|

---

## 7. 待澄清

> 所有核心决策已在三轮问答中确认，无阻塞性待澄清项。

- [ ] **`novel-schema.ts` 是否需要新增 `launchNovelWorkflowResultSchema` / `novelWorkflowRunLookupSchema` / `novelWorkflowRunQueryResultSchema`？**
  建议：加在 `novel-schema.ts` 末尾，与短篇 schema 的对称位置保持一致
  → 可在 Apply 阶段直接落地，无需用户再次确认
