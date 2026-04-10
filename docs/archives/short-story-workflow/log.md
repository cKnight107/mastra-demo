# log: short-story-workflow

_Apply 阶段开始后记录决策变更、用户反馈、实施过程中的发现。_

## 2026-04-09

### 执行概况

- 用户明确要求“完成所有需求”，按批量模式执行全部 task。
- 按 `spec-apply` 要求先检查分支；初始分支为 `main`，已切换到 `feature/short-story-workflow`。
- 新增 `short-story-workflow`、4 个专用 story agents、共享 schema，并从注册表中移除旧 `storyWriterAgent` / `saveObsidianStoryTool`。

### 代码实现

- 新增 `src/mastra/schemas/short-story-schema.ts`，统一定义 workflow 输入、planner structured output、manifest 输出以及中间 step schema。
- 新增 4 个 agents：
  - `storyPlannerAgent`
  - `storyDrafterAgent`
  - `storyEditorAgent`
  - `storySummarizerAgent`
- 新增 `src/mastra/workflows/short-story-workflow.ts`，实现：
  - `normalizeBriefStep`
  - `loadReferenceNotesStep`
  - `planStep`
  - `draftStep`
  - `editStep`
  - `.parallel([summaryStep, metadataStep])`
  - `writeVaultStep`
  - `manifestStep`
- `writeVaultStep` 复用 `src/mastra/tools/obsidian/shared.ts` 批量写入 `Stories/<projectSlug>/`。
- `minimal` profile 输出 5 文件；`authoring` profile 输出 9 文件。

### 运行时发现

- `planStep` 已按 spec 实现 structured output 失败回退。
- 额外补充了 `draftStep` 的本地兜底初稿逻辑：当 Dashscope 不可达时，workflow 仍能完成写盘，避免整条流程在外部模型故障时中断。
- `editStep` / `summaryStep` 同样保留了已有兜底路径，因此 runtime 验证可以覆盖文件结构、referenceNotes 注入和 manifest 组装。

### 验证证据

- 构建验证：
  - 运行 `npm run build`
  - 结果：`Build successful`
- Studio 启动验证：
  - 脱离沙箱运行 `npm run dev`
  - 日志出现：
    - `Mastra API running`
    - `Studio: http://localhost:4112`
    - `API: http://localhost:4112/api`
  - 随后出现 `mastra.duckdb` 锁冲突（PID 81270），说明启动后本地已有另一个 DuckDB 占用者；但在报错前 Studio/API 已进入 ready 状态。
- Workflow 验证：
  - 使用临时脚本 `/tmp/short-story-workflow-validate.ts` + `esbuild` bundle 到 `/tmp/short-story-workflow-validate.bundle.cjs`
  - 为了让验证稳定且快速，命令行覆写 `DASHSCOPE_BASE_URL=http://0.0.0.0.invalid`，强制触发 fallback 路径，验证核心产品行为而非外部模型可用性
  - 验证结果：
    - `minimal-no-reference`：`status=success`，写入 5 个文件
    - `authoring-with-reference`：`status=success`，写入 9 个文件
    - `authoring-with-reference` 中：
      - `referenceContextIncludesNeedle=true`
      - `primaryFileContainsNeedle=true`
  - 说明：
    - `referenceNotes` 非空时，笔记内容已成功进入 planner 上下文
    - reference 内容在 fallback 初稿中也成功影响最终正文

### 残余风险

- 真实 Dashscope 在线生成链路做过两类探测：
  - 沙箱内：DNS 被限制，无法直连外部 API
  - 脱离沙箱：`curl -I https://dashscope.aliyuncs.com/compatible-mode/v1/models` 可连通，但完整双用例生成脚本在当前环境下耗时过长，未拿到稳定的实时在线模型证据
- 因此当前“功能链路”验证基于 fallback 路径完成；若后续要验收在线模型质量，需要在更稳定的外网环境中单独跑一次真实 Dashscope 生成。

### fix-1（minimal profile 文件命名修正）

- 问题来源：对照 `spec.md` 与当前实现发现，`minimal` profile 按 spec 应输出 `brief.md` / `story.md` / `summary.md` / `metadata.md`，但代码仍沿用 authoring profile 的 `00-brief.md` / `04-story.md` / `05-summary.md` / `06-metadata.md`。
- 修正动作：
  - 在 `src/mastra/workflows/short-story-workflow.ts` 引入按 profile 切换的文件名映射。
  - 将 `metadata.primaryFile` 改为依据 `exportProfile` 动态生成。
  - 同步修正 `index.md` 主文件 wikilink 与文件导航链接，确保 minimal profile 指向非编号文件名。
  - `authoring` profile 继续保留编号命名，不改变既有结构。
- 验证证据：
  - 运行 `npm run build`，结果：`Build successful`。
  - 运行临时脚本 `/tmp/short-story-fix-validate.bundle.cjs`（`OBSIDIAN_VAULT_PATH=/tmp/short-story-fix-vault.k2iS2f`，`DASHSCOPE_BASE_URL=http://0.0.0.0.invalid` 强制走 fallback）。
  - 验证结果：
    - `minimal`：`primaryFile=Stories/fix-minimal-case/story.md`，文件列表为 `brief.md/index.md/metadata.md/story.md/summary.md`
    - `authoring`：`primaryFile=Stories/fix-authoring-case/04-story.md`，文件列表仍为 `00-brief.md` 至 `07-revision-log.md` + `index.md`
- 文档同步：
  - `spec.md` 无需修改：本次仅让实现重新符合既有 spec。
  - `tasks.md` 新增 fix 任务并标记完成。
  - `log.md` 记录问题来源、修正动作与验证证据。

### fix-2（review findings 收敛）

- 问题来源：
  - review 指出 `plannerAgent` 失败回退只生成 2 个 beats、1 个 `titleCandidates`，低于当前 prompt 契约。
  - review 指出 `short-story-workflow` 缺少随仓库提交的回归保护，`package.json` 中 `npm test` 仍是占位命令。
- 修正动作：
  - 在 `src/mastra/workflows/short-story-workflow.ts` 补强 fallback outline 生成逻辑：
    - 固定输出开端 / 升级 / 转折 / 结尾四段 beats
    - 固定生成 3 到 5 个 `titleCandidates`
    - 将 `endingDesign` 与结尾 beat 保持一致，避免 fallback 结构再次弱化
  - 新增 `scripts/validate-short-story-workflow.ts` 作为 checked-in 验证脚本，覆盖：
    - `minimal` profile 输出 5 文件
    - `authoring` profile 输出 9 文件
    - `referenceNotes` 注入到 `load-reference-notes` / `plan-story` 路径
    - `plannerAgent` 失败时 fallback outline 仍满足 beats / `titleCandidates` 下限
  - 新增 `scripts/run-short-story-workflow-tests.mjs`，在执行时用本地 `esbuild` bundle 验证脚本并运行。
  - 将 `package.json` 的 `npm test` 接入上述验证，不再保留占位命令。
- 验证证据：
  - 运行 `npm test`
  - 预期验证点：
    - `minimal-no-reference`：`primaryFile=Stories/review-minimal-case/story.md`
    - `authoring-with-reference`：`primaryFile=Stories/review-authoring-case/04-story.md`
    - `load-reference-notes` 输出包含参考笔记 needle
    - `plan-story` 命中 fallback warning，且 fallback beat 数量 `>= 4`、`titleCandidates` 数量在 `3..5`
  - 运行 `npm run build`
- 文档同步：
  - `spec.md`：将 planner fallback 的最小结构下限写明到风险缓解。
  - `tasks.md`：新增本轮 fix 任务并标记完成。
  - `log.md`：记录 review finding 来源、修正动作与验证口径。

### fix-3（编辑阶段回退链路修正）

- 问题来源：
  - 用户在已归档需求的实际运行中观察到 `07-revision-log.md` 固定写出“编辑阶段结构化输出失败，已直接使用初稿作为终稿。”
  - 根因是 `src/mastra/workflows/short-story-workflow.ts` 的 `editStep` 让长篇终稿直接走 `structuredOutput` JSON 解析，模型一旦在转义或换行上失配，就会整体回退为初稿。
- 修正动作：
  - 将 `editStep` 改为调用 `storyEditorAgent.generate()` 的纯文本返回协议，不再强依赖 JSON structured output。
  - 在 prompt 中明确要求输出 `<final_markdown>...</final_markdown>` 与 `<revision_notes>...</revision_notes>` 两段。
  - 新增解析链路：
    - 先兼容 JSON 响应（防止旧行为残留）
    - 再解析标签包裹内容
    - 仅在两种格式都无法解析时才回退为初稿
  - 同步更新 `src/mastra/agents/story-editor-agent.ts` 指令，约束返回标签格式。
  - 调整默认 revision log 文案为中性回退说明，不再把“structured output 失败”写成固定终稿描述。
- 验证证据：
  - 更新 `scripts/validate-short-story-workflow.ts`，在脚本内 mock `storyEditorAgent.generate()` 返回标签格式终稿。
  - 验证项：
    - `04-story.md` 包含 mock 编辑后的追加句子“这一版经过编辑润色，句子更紧凑。”
    - `07-revision-log.md` 包含“收紧了叙事节奏”
    - `07-revision-log.md` 不再包含“编辑阶段结构化输出失败”
- 文档同步：
  - `spec.md` 无需修改：输出契约仍是 `finalMarkdown + revisionNotes`，本次只调整实现手段以重新满足既有行为目标。
  - `tasks.md`：新增本轮 fix 任务并标记完成。
  - `log.md`：记录问题来源、根因、修正动作与验证方式。
