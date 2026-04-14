# spec: medium-novel-workflow

## 1. 代码现状

### 1.1 已有能力

| 模块 | 路径 | 说明 |
|---|---|---|
| 短篇 Workflow | `src/mastra/workflows/short-story-workflow.ts` | 8步线性流水线，单次生成短篇，无章节循环 |
| 故事 Agent x4 | `src/mastra/agents/story-{planner,drafter,editor,summarizer}-agent.ts` | 各自独立，无章节上下文感知能力 |
| Obsidian 工具组 | `src/mastra/tools/obsidian/` | 9个工具，含 `obsidian-search-notes-tool`（关键词搜索，可复用于 continuity checker）|
| Schema 链 | `src/mastra/schemas/short-story-schema.ts` | 分层 Zod Schema，设计模式可借鉴，不可直接扩展 |
| Story Launcher Agent | `src/mastra/agents/story-launcher-agent.ts` | 与 `shortStoryWorkflow` 紧耦合，中篇需单独处理 |
| 存储 | `src/mastra/storage.ts` | PostgreSQL + pgvector + `textEmbeddingV4Model` 已就绪 |
| 模型配置 | `src/mastra/agents/models.ts` | `qwen3.6-plus`（规划/写作）、`qwen3.5-flash`（摘要）、`textEmbeddingV4Model`（向量化）|

### 1.2 能力缺口

- 无章节循环机制（`foreach` + 嵌套 Workflow）
- 无跨章节状态管理（story bible、timeline、openLoops、三级摘要）
- 无 `continuityCheckerAgent`（设定冲突检查）
- 无中篇专用 Schema（现有 Schema 与 `shortStoryWorkflow` 紧耦合，不可复用）
- 无 suspend/resume 参数化控制

### 1.3 约束

- `short-story-schema.ts` Schema 链不可修改，中篇必须新建独立 Schema 文件
- 现有 `storyLauncherAgent`、测试脚本不受影响（并存方案）
- 全部使用 DashScope（Qwen 系列），不使用本地 Ollama 模型

---

## 2. 功能点

### 2.1 用户价值

从"一次性短篇生成"升级为"可控的多章节中篇生成"，支持 3万～10万字规模，具备跨章节连续性保障和关键节点人工确认能力。

### 2.2 行为变化

| 能力 | 短篇（现状） | 中篇（目标）|
|---|---|---|
| 章节数 | 1章 | N章（由规划决定）|
| 输入 | 单次 brief | brief + 可选 suspend 参数 |
| 连续性保障 | 无 | story bible + 三级摘要 + continuityCheckerAgent |
| 人工介入 | 无 | 可选：bible 后 / 章节规划后 |
| Obsidian 输出 | 单项目目录 | 项目包（chapters/、summaries/、独立索引文件）|
| 状态管理 | Step 间传参 | Workflow State（跨章节持久化）|

### 2.3 边界

**本次包含：**
- `novelWorkflow`（顶层，含 suspend 参数控制）
- `chapterWorkflow`（嵌套，单章流水线）
- 5个新 Agent：`novelPlannerAgent`、`chapterDrafterAgent`、`chapterEditorAgent`、`continuityCheckerAgent`、`chapterSummarizerAgent`
- 中篇专用 Schema 文件：`src/mastra/schemas/novel-schema.ts`
- Obsidian 项目包目录结构

**本次不包含（后续再议）：**
- `novelLauncherAgent`（对话式启动界面，可复用 storyLauncherAgent 模式后续添加）
- 向量语义搜索（pgvector 已就绪，但本期用关键词搜索）
- 全书总修订 step（`globalEdit`）
- 评分器（Scorers）

---

## 3. 架构设计

### 3.1 Workflow 结构

```
NovelWorkflow（顶层）
  1. normalizeBrief          → 清洗输入、预检 vault 目录
  2. buildStoryBible         → novelPlannerAgent，structured output
     [suspend if suspendAfterBible=true]
  3. buildChapterPlan        → novelPlannerAgent，structured output
     [suspend if suspendAfterChapterPlan=true]
  4. .foreach(ChapterWorkflow, { concurrency: 1 })
       ChapterWorkflow（嵌套）
         a. buildChapterBrief      → novelPlannerAgent，读取 state
         b. draftChapter           → chapterDrafterAgent
         c. editChapter            → chapterEditorAgent
         d. [每3章 or 最后一章] continuityCheck → continuityCheckerAgent
         e. summarizeChapter       → chapterSummarizerAgent
         f. writeChapterFiles      → Obsidian 落盘（brief + final）
         g. updateState            → 更新三级摘要、openLoops、timeline
  5. compileManuscript        → 拼接所有 final 章节
  6. parallel([
       buildBookSummaries,   → chapterSummarizerAgent（全书摘要）
       buildMetadata,        → 纯代码组装
       buildIndex,           → 生成 index.md
     ])
  7. writeVaultArtifacts      → 落盘全书级文件
  8. buildManifest            → 汇总输出
```

### 3.2 State Schema

```ts
novelStateSchema = {
  projectSlug: string,
  title: string,
  storyBible: {
    full: StoryBible,       // 完整版，供 checker 和规划使用
    compact: string,        // 精简版，注入 drafter/editor prompt
  },
  actPlan: ActPlan,
  chapterPlan: ChapterBrief[],   // 含 dependencyMode 字段
  currentChapter: number,
  chapterSummaries: {
    recent: ChapterSummary[],    // 最近 3-5 章，完整摘要
    compressed: string,          // 第1章到N-5章的压缩摘要
    milestones: MilestoneSummary[] // 关键转折点，永久保留
  },
  openLoops: OpenLoop[],         // 未回收伏笔
  continuityNotes: string[],     // 连贯性警告记录
  timeline: TimelineEntry[],     // 章节事件时间线
  fileManifest: FileManifestEntry[], // 已写入文件路径
}
```

### 3.3 ChapterBrief 结构

```ts
ChapterBrief = {
  chapterNumber: number,
  title: string,
  synopsis: string,
  dependencyMode: 'standalone' | 'sequential',
  mustReadChapters: number[],  // sequential 模式下必须读取的前章
  keyEvents: string[],
  openLoopsToResolve: string[],
  openLoopsToIntroduce: string[],
}
```

### 3.4 continuityCheckerAgent 设计

- **触发时机**：每 3 章运行一次 + 最后一章强制运行
- **上下文注入**：story bible compact + 最近 2 章摘要 + 当前章 final draft
- **工具**：持有 `obsidian-search-notes-tool`，按结构化检查清单主动搜索
- **检查清单**（固定注入 system prompt）：
  1. 角色当前所在地与上章是否一致
  2. 本章出现角色的称谓与设定是否一致
  3. 本章涉及的时间节点与 timeline 是否冲突
  4. 本章是否使用了未设定的能力/道具
  5. 本章是否回收/推进了 openLoops 中的伏笔

### 3.5 Agent 分工

| Agent | 模型 | 输出类型 | 工具 |
|---|---|---|---|
| `novelPlannerAgent` | qwen3.6-plus | structured（Zod）| 无 |
| `chapterDrafterAgent` | qwen3.6-plus | Markdown 正文 | 无 |
| `chapterEditorAgent` | qwen3.6-plus | Markdown + revision notes | 无 |
| `continuityCheckerAgent` | qwen3.6-plus | structured 检查报告 | `obsidian-search-notes-tool` |
| `chapterSummarizerAgent` | qwen3.5-flash | structured 摘要 | 无 |

### 3.6 Obsidian 输出结构

```
Novels/
  {projectSlug}/
    index.md              ← 项目总览，含章节列表
    story-bible.md        ← 世界观/人物/主题/规则
    act-outline.md        ← 全书结构（三幕等）
    continuity.md         ← 设定冲突记录（checker 输出）
    timeline.md           ← 章节事件时间线
    metadata.md           ← 全书元数据
    manuscript.md         ← 拼接后的完整稿
    revision-log.md       ← 修订记录

    chapters/
      01-brief.md
      01-final.md
      02-brief.md
      02-final.md
      ...

    summaries/
      chapter-summaries.md     ← 每章一段摘要
      book-summary-short.md    ← 无剧透简介
      book-summary-full.md     ← 含剧透完整摘要
```

---

## 4. 变更范围

### 4.1 新增文件

| 文件 | 说明 |
|---|---|
| `src/mastra/schemas/novel-schema.ts` | 中篇全流程 Zod Schema |
| `src/mastra/agents/novel-planner-agent.ts` | 合并规划 Agent |
| `src/mastra/agents/chapter-drafter-agent.ts` | 章节写作 Agent |
| `src/mastra/agents/chapter-editor-agent.ts` | 章节编辑 Agent |
| `src/mastra/agents/continuity-checker-agent.ts` | 连续性检查 Agent |
| `src/mastra/agents/chapter-summarizer-agent.ts` | 章节摘要 Agent |
| `src/mastra/workflows/chapter-workflow.ts` | 单章嵌套 Workflow |
| `src/mastra/workflows/novel-workflow.ts` | 中篇顶层 Workflow |

### 4.2 修改文件

| 文件 | 变更内容 |
|---|---|
| `src/mastra/index.ts` | 注册 `novelWorkflow`、`chapterWorkflow` 和 5 个新 Agent |

### 4.3 不变文件

- `src/mastra/workflows/short-story-workflow.ts`（不修改）
- `src/mastra/schemas/short-story-schema.ts`（不修改）
- `src/mastra/agents/story-*.ts`（不修改）
- `src/mastra/tools/obsidian/`（不修改，直接复用）

---

## 5. 风险

| 风险 | 等级 | 说明 | 缓解措施 |
|---|---|---|---|
| State 在长篇（10万字）时体积膨胀 | 中 | `chapterSummaries` 随章节线性增长 | 三级压缩结构；compressed 每 5 章触发一次滚动压缩 |
| `novelPlannerAgent` 单 agent 双职责 prompt 混淆 | 低 | 两个 Step 共用一个 Agent 实例，prompt 在 Workflow 层控制 | Step 各自持有完整 system prompt override，不依赖 Agent 默认 prompt |
| `foreach` 嵌套 Workflow 的 Mastra 版本兼容性 | 中 | 需确认当前 `@mastra/core@1.24.0` 支持 `foreach(workflow)` | 实现前先写最小验证用例 |
| continuityCheckerAgent 漏检 | 低 | 关键词搜索召回率依赖摘要写作质量 | 检查清单固定注入 + 摘要要求结构化写法（角色名、地点、道具显式标注）|
| token 成本在 10 万字规模显著增加 | 中 | 每章多次 agent 调用，story bible compact 注入每章 | story bible compact 控制在 500 token 以内；drafter 不注入历史正文 |

---

## 6. 技术决策

| 决策 | 选择 | 放弃方案 |
|---|---|---|
| 与短篇关系 | 并存，新建独立模块 | 扩展/替换现有短篇 |
| 章节循环 | `foreach(ChapterWorkflow, { concurrency: 1 })` | `dowhile`（调试困难，隔离性差）|
| Suspend 控制 | 输入参数（`suspendAfterBible` / `suspendAfterChapterPlan`）| 固定节点 / 不支持 |
| Continuity 上下文 | 固定注入 + `obsidian-search-notes-tool` 搜索 | 全量注入 / 向量搜索 |
| 规划 Agent 数量 | 合并为 `novelPlannerAgent`，Step 层传入不同 prompt | 两个独立 Agent |
| 模型 | DashScope Qwen（qwen3.6-plus + qwen3.5-flash） | Ollama 本地模型 |
| 搜索机制 | 关键词搜索（现有工具）| 向量语义搜索（后续再议）|

---

## 7. 待澄清

> 所有核心决策已在四轮问答中确认，以下为实现前需确认的细节项。

- [ ] **`foreach(ChapterWorkflow)` 兼容性**：需要在实现前用最小用例验证 `@mastra/core@1.24.0` 是否支持 `foreach` 传入嵌套 Workflow 实例（而非 Step 数组）
- [ ] **compressed 摘要触发时机**：每 5 章自动触发一次滚动压缩，还是由 Workflow 在超出 token 阈值时触发？（建议固定 5 章，实现更简单）
- [ ] **novelLauncherAgent**：本期不实现，后续是否作为独立需求跟进？
