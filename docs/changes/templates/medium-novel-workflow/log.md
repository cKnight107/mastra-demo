# log: medium-novel-workflow

## 提案阶段

### 2026-04-13 — 需求澄清记录

**背景**：用户通过 `1.md` 提出从短篇生成器升级到中篇生成器的架构讨论，经过多轮对话后进入 spec-propose 阶段。

**四轮澄清结论**：

| 轮次 | 问题 | 决策 |
|---|---|---|
| 第一轮 | 与短篇的关系 | 并存，新建独立模块 |
| 第二轮 | Suspend/resume | 由输入参数控制（`suspendAfterBible` / `suspendAfterChapterPlan`）|
| 第三轮 | Continuity 上下文方案 | 固定注入 + `obsidian-search-notes-tool` 关键词搜索 |
| 第四轮 | 规划 Agent 数量 | 合并为 `novelPlannerAgent` |

**讨论阶段关键设计决策**（进入 spec-propose 前）：

- 章节循环选 `foreach(ChapterWorkflow)` 而非 `dowhile`，原因：隔离性更好，state 污染风险低
- `chapterSummaries` 采用三级结构（recent + compressed + milestones），避免长篇 context 膨胀
- story bible 生成 full + compact 两版，drafter 只注入 compact 版
- `continuityCheckerAgent` 每 3 章 + 最后一章触发，由结构化检查清单驱动搜索行为
- `chapterBrief` 包含 `dependencyMode`（standalone / sequential），动态决定上下文注入量

**待实现阶段记录**：（Apply 阶段填写）

## Apply 阶段

### 2026-04-13 — 全量实现完成

**本次实现内容**：

- 新增 `src/mastra/schemas/novel-schema.ts`，补齐中篇请求、state、章节执行、连续性检查、全书摘要与 manifest 的完整 schema 链
- 新增 5 个 Agent：
  - `novelPlannerAgent`
  - `chapterDrafterAgent`
  - `chapterEditorAgent`
  - `continuityCheckerAgent`
  - `chapterSummarizerAgent`
- 新增 `chapterWorkflow`，实现单章闭环：brief → draft → edit → continuity → summary → Obsidian 落盘 → state 更新
- 新增 `novelWorkflow`，实现顶层编排：normalize → story bible → chapter plan → `foreach(chapterWorkflow)` → manuscript → parallel summaries/metadata/index → 全书级文件落盘 → manifest
- 更新 `src/mastra/index.ts`，完成 workflow 与 agent 注册

**实现期确认/落地的决策**：

- `foreach(ChapterWorkflow)` 直接采用 Mastra 1.24.0 当前文档支持的 nested workflow 形式，不回退到展开式 step 链
- `chapterSummaries` 采用“最近 5 章保留在 recent，较早章节滚动压入 compressed”的固定窗口策略
- `novelLauncherAgent` 继续保持不在本期范围内

**新增发现**：

- Mastra workflow 只要声明了 `stateSchema`，启动时就会校验初始 state；若直接使用严格 `novelStateSchema`，在没有 `initialState` 的情况下会启动失败
- 因此新增 `novelRuntimeStateSchema = novelStateSchema.partial().default({})` 作为 runtime state schema，内部再由 step 用 `ensureNovelState()` 填充默认结构
- 这个处理对 Studio/工具直接触发 workflow 是必要的，否则用户必须手工提供完整 `initialState`

**验证证据**：

- `npm run build`
  - 成功，Mastra 完整打包通过
- `npm run test`
  - 成功，既有短篇 workflow 测试通过；过程中上游 LLM 因故意无效地址触发 fallback，但短篇链路无回归
- 本地中篇 fallback 验证
  - 直接运行 `novelWorkflow` 的源代码 bundle，在 `OBSIDIAN_VAULT_PATH` 指向临时目录、`DASHSCOPE_BASE_URL=http://0.0.0.0.invalid` 的条件下，验证到：
    - `suspendAfterBible=true` 时 `start().status === "suspended"`
    - 非挂起模式下 `fullStatus === "success"`
    - 产物目录包含 `index.md`、`story-bible.md`、`act-outline.md`、`continuity.md`、`timeline.md`、`metadata.md`、`manuscript.md`、`revision-log.md`、`chapters/*`、`summaries/*`
    - manifest 返回 `chapterCount=7`

**未完成验证与阻塞**：

- `resume()` 的实跑仍缺少证据
  - 直接从源代码运行 workflow 时没有 snapshot storage，无法恢复挂起快照
  - 使用项目 `mastra` 实例时又依赖默认 PostgreSQL；当前沙箱环境无法连接 `localhost:5432`
- `continuityCheckerAgent` 的真实 tool round-trip 仍缺少证据
  - wiring 已进入请求层：continuity checker 失败请求里包含 `tools` 与 `tool_choice: "auto"`
  - 但当前环境无在线模型能力，无法确认模型实际发起 `obsidian-search-notes-tool` 调用并收到返回

**后续可沉淀规则候选**：

- 若仓库后续继续采用带 state 的 workflow，建议把“runtime state schema 允许空初始态，step 内再补默认值”沉淀到 `docs/knowledge/`，避免同类启动失败再次出现
