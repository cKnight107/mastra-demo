# tasks: short-story-workflow

## 已完成

- [x] 分析仓库现状（story-writer-agent、save-obsidian-story-tool、obsidian/shared.ts、lesson-prep-workflow 范式）
- [x] 确认关键决策：废弃旧 agent/tool、用已有 obsidian tools、全 Dashscope 模型、referenceNotes 做 step 内判断
- [x] 生成 spec.md、tasks.md、log.md

## 待确认

- [x] 用户显式确认 spec.md 内容，进入 Apply 阶段

## 实施任务（确认后执行）

### 清理旧代码
- [x] 删除 `src/mastra/agents/story-writer-agent.ts`
- [x] 删除 `src/mastra/tools/save-obsidian-story-tool.ts`
- [x] 更新 `src/mastra/index.ts`：移除旧 agent/tool 引用和注册

### 新增 Schema
- [x] 创建 `src/mastra/schemas/short-story-schema.ts`
  - `storyRequestSchema`（workflow 输入）
  - `outlineSchema`（plannerAgent structured output）
  - `artifactManifestSchema`（workflow 输出）
  - 各 step 间传递的中间 schema

### 新增 Agents（4 个）
- [x] `src/mastra/agents/story-planner-agent.ts`（qwen3.6-plus，structured output 大纲）
- [x] `src/mastra/agents/story-drafter-agent.ts`（qwen3.6-plus，正文写作）
- [x] `src/mastra/agents/story-editor-agent.ts`（qwen3.6-plus，修辞/一致性）
- [x] `src/mastra/agents/story-summarizer-agent.ts`（qwen3.5-flash，摘要/tags）

### 新增 Workflow
- [x] 创建 `src/mastra/workflows/short-story-workflow.ts`
  - step 1: `normalizeBriefStep`
  - step 2: `loadReferenceNotesStep`（判断 referenceNotes 是否为空）
  - step 3: `planStep`（调 plannerAgent + structuredOutput）
  - step 4: `draftStep`（调 drafterAgent）
  - step 5: `editStep`（调 editorAgent）
  - step 6: `.parallel([summaryStep, metadataStep])`
  - step 7: `writeVaultStep`（复用 shared.ts 批量写入，支持 authoring/minimal profile）
  - step 8: `manifestStep`

### 注册
- [x] 更新 `src/mastra/index.ts`：注册 4 个新 agent 和 `shortStoryWorkflow`

### 验收
- [x] `npm run build` 无 TypeScript 错误
- [x] Mastra Studio 可见 `shortStoryWorkflow` 和 4 个新 agent
- [x] 用 `minimal` profile 跑一次，检查 5 个文件写入 vault 成功
- [x] 用 `authoring` profile 跑一次，检查 9 个文件写入 vault 成功
- [x] `referenceNotes` 为空时流程正常（无报错）
- [x] `referenceNotes` 非空时笔记内容注入到 plannerAgent 上下文

## Fix 任务（2026-04-09）

- [x] 修复 `minimal` profile 文件命名与既有 `spec.md` 不一致的问题
  - `brief/story/summary/metadata` 改为 `brief.md`、`story.md`、`summary.md`、`metadata.md`
  - 同步修正 `primaryFile` 与 `index.md` 内部 wikilink 导航
- [x] 重新运行构建与针对 `minimal` 文件映射的验证，确认 `authoring` profile 仍保持编号命名
- [x] 补强 `plannerAgent` 失败回退的大纲质量下限
  - fallback outline 至少提供 4 个 beats
  - fallback `titleCandidates` 保持 3 到 5 个候选
- [x] 新增仓库内 `short-story-workflow` 回归验证脚本
  - `npm test` 直接执行 checked-in 验证
  - 覆盖 `minimal` / `authoring` 文件映射、`referenceNotes` 注入与 planner fallback 路径
