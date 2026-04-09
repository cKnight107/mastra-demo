# spec: short-story-workflow

## 代码现状

### 已有能力

| 资产 | 路径 | 说明 |
|------|------|------|
| `storyWriterAgent` | `src/mastra/agents/story-writer-agent.ts` | 单 Agent 直接写故事 + 调 `saveObsidianStoryTool` 落盘，无结构化多步流程 |
| `saveObsidianStoryTool` | `src/mastra/tools/save-obsidian-story-tool.ts` | 单文件写入 tool，含 frontmatter 构建、路径校验 |
| Obsidian 工具集 | `src/mastra/tools/obsidian/` | 9 个工具（create/read/update/append/delete/list/search/move/patch-frontmatter） |
| `shared.ts` | `src/mastra/tools/obsidian/shared.ts` | 核心文件系统工具函数：`getVaultPath`、`resolveVaultSubpath`、`writeNoteToVault`、`readNoteFromVault`、`buildNoteMarkdown`、`parseFrontmatter`、`serializeFrontmatter` 等 |
| `lesson-prep-workflow.ts` | `src/mastra/workflows/lesson-prep-workflow.ts` | 多 step workflow + agent structured output 完整范式（可作为参考） |
| `models.ts` | `src/mastra/agents/models.ts` | Dashscope（qwen3.6-plus / qwen3.5-plus / qwen3.5-flash）和 Ollama（gemma4:e4b）两个提供商 |
| Mastra v1.24.0 | `node_modules/@mastra/core` | 支持 `.parallel()`、`.branch()`、agent structured output、`createStep` |

### 缺口

- 无 story workflow，当前是纯 agent 模式（自由发挥，无结构化流程）
- `storyWriterAgent` 只写单文件，无多文件项目目录支持
- `saveObsidianStoryTool` 不支持批量/多文件写入

---

## 功能点

### 目标

将"短篇小说生成"从单 Agent 自由模式升级为固定结构的多步 Workflow，输出包含完整创作文件包的 Obsidian 项目目录。

### 用户价值

- 输入需求参数 → 自动生成结构化大纲、完整正文、摘要、角色表、元数据
- 所有文件自动落入 Obsidian vault 的固定项目目录
- 流程可重复、可观测、文件结构稳定

### 行为变化

| 变化点 | 旧行为 | 新行为 |
|--------|--------|--------|
| 入口 | `storyWriterAgent`（对话式） | `shortStoryWorkflow`（结构化输入） |
| 输出文件数 | 1 个 `.md` | `authoring` profile: 9 个；`minimal` profile: 5 个 |
| 文件目录 | `小说库/短篇/<日期-标题>.md` | `Stories/<projectSlug>/` |
| 大纲/角色/摘要 | 无 | 有独立文件 |
| 旧 agent | 注册于 `index.ts` | **废弃，从注册表移除** |

---

## Workflow 结构

```
shortStoryWorkflow
  1. normalizeBriefStep        纯代码 step：清洗输入、规范 projectSlug、补默认值
  2. loadReferenceNotesStep    纯代码 step：referenceNotes 非空则读取 vault 笔记；为空则跳过（返回空上下文）
  3. planStep                  plannerAgent → structured output（大纲 schema）
  4. draftStep                 drafterAgent → draftMarkdown（string）
  5. editStep                  editorAgent → finalMarkdown + revisionNotes
  6. parallel([
       summaryStep             summarizerAgent → logline + summaries + tags
       metadataStep            纯代码 step：从 plan/edit 结果组装 frontmatter metadata
     ])
  7. writeVaultStep            纯代码 step：批量写入 Obsidian（复用 shared.ts）
  8. manifestStep              纯代码 step：汇总返回 artifactManifest
```

---

## Schema 设计

### 顶层输入 `storyRequestSchema`

```ts
z.object({
  projectSlug: z.string(),
  language: z.enum(["zh-CN", "en"]).default("zh-CN"),
  premise: z.string(),
  genre: z.string(),
  tone: z.string(),
  pov: z.string().optional(),
  targetWords: z.number().int().positive(),
  endingStyle: z.string().optional(),
  mustInclude: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  referenceNotes: z.array(z.string()).default([]),
  exportProfile: z.enum(["minimal", "authoring"]).default("authoring"),
})
```

### 顶层输出 `artifactManifestSchema`

```ts
z.object({
  projectDir: z.string(),
  title: z.string(),
  primaryFile: z.string(),
  files: z.array(z.object({ path: z.string(), kind: z.string() })),
  stats: z.object({ wordCount: z.number() }),
  warnings: z.array(z.string()).default([]),
})
```

### plannerAgent structured output（`outlineSchema`）

```ts
z.object({
  title: z.string(),
  logline: z.string(),
  theme: z.string(),
  characters: z.array(z.object({
    name: z.string(), role: z.string(), motivation: z.string(), secret: z.string().optional()
  })),
  beats: z.array(z.object({ order: z.number(), summary: z.string() })),
  endingDesign: z.string(),
  titleCandidates: z.array(z.string()),
})
```

---

## Obsidian 目录结构

### authoring profile（9 文件）

```
Stories/<projectSlug>/
  index.md           入口页（标题、状态、wikilinks、概览）
  00-brief.md        原始需求快照
  01-outline.md      beat/scene outline
  02-characters.md   角色卡、关系、动机、秘密
  03-draft.md        初稿
  04-story.md        ★ 最终正文（primaryFile）
  05-summary.md      logline + 无剧透摘要 + 全剧透摘要
  06-metadata.md     genre/tone/POV/字数/状态/模型/时间
  07-revision-log.md 编辑意见与修订说明
```

### minimal profile（5 文件）

```
Stories/<projectSlug>/
  index.md
  story.md           ★ primaryFile
  summary.md
  metadata.md
  brief.md
```

---

## 模型分工（已确认）

| Agent | 模型 | 说明 |
|-------|------|------|
| plannerAgent | `qwen3.6-plus` | 结构化大纲，质量优先 |
| drafterAgent | `qwen3.6-plus` | 正文写作，质量优先 |
| editorAgent | `qwen3.6-plus` | 修辞/一致性，质量优先 |
| summarizerAgent | `qwen3.5-flash` | 摘要/tags，副产物，轻量 |

---

## 变更范围

### 会修改的文件

| 文件 | 变更类型 |
|------|---------|
| `src/mastra/index.ts` | 移除 `storyWriterAgent` 注册；注册 `shortStoryWorkflow` 和 4 个新 agent |
| `src/mastra/agents/story-writer-agent.ts` | **删除** |
| `src/mastra/tools/save-obsidian-story-tool.ts` | **删除**（被 `writeVaultStep` 纯代码替代） |

### 会新增的文件

| 文件 | 说明 |
|------|------|
| `src/mastra/agents/story-planner-agent.ts` | plannerAgent |
| `src/mastra/agents/story-drafter-agent.ts` | drafterAgent |
| `src/mastra/agents/story-editor-agent.ts` | editorAgent |
| `src/mastra/agents/story-summarizer-agent.ts` | summarizerAgent |
| `src/mastra/workflows/short-story-workflow.ts` | 主 workflow（含所有 step） |
| `src/mastra/schemas/short-story-schema.ts` | 所有共享 schema（输入/输出/大纲/manifest） |

### 不会修改的文件

- `src/mastra/tools/obsidian/` 所有文件（只读复用 `shared.ts`）
- 其余 agent、workflow、scorer、storage 配置

---

## 技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 顶层结构 | Workflow（非 supervisor agent） | 流程已知、顺序明确，workflow 比 supervisor 更稳定可观测 |
| 旧 storyWriterAgent | 废弃删除 | 用户选择 B，新 workflow 完全替代 |
| 写文件方式 | 纯代码 step 复用 `shared.ts` | 不走 tool call，确定性最高；obsidian 自定义工具集已有完整 frontmatter 能力 |
| 官方 Workspace | 不使用 | 无 Obsidian frontmatter 逻辑，对本需求无额外收益 |
| referenceNotes | 做成一个 step，判断参数是否为空再决定是否读取 | v1 即支持，但空数组时无开销 |
| 模型分工 | planner/drafter/editor → qwen3.6-plus；summarizer → qwen3.5-flash | 全 Dashscope，无外部服务依赖，按任务重要性分档 |
| `saveObsidianStoryTool` | 删除 | 单文件 tool 被 `writeVaultStep` 完全替代 |
| metadataStep | 纯代码 step（非 agent） | metadata 是确定性组装，不需要模型判断 |

---

## 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `plannerAgent` structured output 解析失败 | 中 | 捕获异常，`warnings` 字段记录，并回退为仍满足最小写作约束的大纲（至少 4 个 beats、3-5 个 `titleCandidates`），workflow 不中止 |
| `projectSlug` 重名覆盖已有目录 | 低 | `normalizeBriefStep` 检查目录是否已存在，冲突时 `warnings` 报告 |
| `qwen3.6-plus` 长文输出截断 | 中 | `drafterAgent` instructions 明确分段输出策略 |
| 删除旧 agent/tool 影响其他调用方 | 低 | 仓库内无其他代码引用 `storyWriterAgent` 和 `saveObsidianStoryTool` |
| `referenceNotes` 笔记路径不存在 | 低 | `loadReferenceNotesStep` 捕获读取错误，跳过该笔记并记录 warning |

---

## 待澄清

无。所有关键决策已在 propose 阶段确认。
