# log

记录 apply 阶段的决策变更、用户反馈、实施过程中的发现等。

## 2026-04-08

- 用户通过“完成 docs/changes/templates/obsidian-crud-tools”显式确认进入 Apply，按批量模式一次性完成全部任务。
- 新增 `src/mastra/tools/obsidian/shared.ts`，集中封装 vault 根目录解析、路径越界防护、文件名清洗、frontmatter 解析/序列化、Markdown 读写、目录遍历、移动/删除等公共能力，避免 8 个 tool 重复实现。
- 新增 8 个通用 Obsidian CRUD/search/list/read tools：
  - `obsidian-read-note`
  - `obsidian-list-notes`
  - `obsidian-search-notes`
  - `obsidian-create-note`
  - `obsidian-update-note`
  - `obsidian-patch-frontmatter`
  - `obsidian-append-note`
  - `obsidian-delete-note`
  - `obsidian-move-note`
- 新增 `src/mastra/tools/obsidian/index.ts` 做统一导出，并在 `src/mastra/index.ts` 的 `tools` 字段内完成全局注册，使这些通用工具可被 Mastra 统一发现。
- 安全与行为实现要点：
  - 所有路径输入都经过 `resolveVaultSubpath()` 校验，限制在 `OBSIDIAN_VAULT_PATH` 根目录内。
  - `create/update/patch/append` 统一维护 `frontmatter.updated` 时间戳。
  - `create` 自动补齐 `title/tags/created/updated`。
  - `delete` 默认进入 `_trash/` 并保留原始相对路径结构，冲突时自动加后缀。
  - `move` 默认不覆盖目标文件，且明确声明不会自动修复 vault 内 wikilink。
- 验证证据：
  - `npm run build` 成功，Mastra CLI 输出 `Build successful, you can now deploy the .mastra/output directory to your target platform.`。
  - 额外执行 `./node_modules/.bin/tsc --noEmit 2>&1 | rg 'src/mastra/tools/obsidian|src/mastra/index.ts'`，没有来自本次新增文件或集成点的类型报错。
- 新发现：
  - 仓库当前存在与本次变更无关的历史 TypeScript 报错，主要位于 `travel-agent.ts`、`route-cities-tool.ts`、`save-obsidian-story-tool.ts`、`lesson-prep-workflow.ts`。这不会阻塞 `npm run build`，但会阻塞全量 `tsc --noEmit` 通过。

## 2026-04-08 / fix-2（第二轮 spec-review findings）

- 问题来源：`spec-review` 阶段二给出 2 个 Important + 2 个 Minor findings。
- 修正动作：
  1. **delete-note 路径分隔符（Important）**：`delete-note-tool.ts:38` 将 `.split(path.sep)` 改为 `.split(/[\\/]+/)`，避免 Windows 下 `_trash` 路径结构错误。
  2. **search-notes 性能说明（Important）**：在 tool description 中补充"即使不搜索正文，仍需读取每个文件以解析 frontmatter"，对用户透明。
  3. **create-note 时间戳格式统一（Minor）**：`create-note-tool.ts` 中 `updated` 字段改为 `formatDate(now)`，与 `created` 均输出 `YYYY-MM-DD` 本地日期，消除同一笔记内格式不一致问题。
  4. **parseNote 多余前导换行（Minor）**：`shared.ts:182` 将 `.replace(/^\n/, '')` 改为 `.replace(/^\n+/, '')`，兼容 frontmatter 关闭 `---` 后存在多个空行的笔记，避免 `append` 时意外多插换行。
- 验证证据：
  - `npm run build` 成功，输出 `Build successful`。
  - `./node_modules/.bin/tsc --noEmit 2>&1 | grep 'src/mastra/tools/obsidian|src/mastra/index.ts'` 无输出，本次改动范围无新增类型报错。



- 问题来源：`spec-review` 给出两个 finding。
  - `patch/update` 会把常见 inline YAML frontmatter 退化成字符串。
  - `move-note` 在 `overwrite: true` 且目标为目录时会删掉整个目录树。
- 修正动作：
  - 扩展 `shared.ts` 中的 frontmatter 标量解析，新增对 inline array/object 的解析支持，并复用到现有 frontmatter 读写流程。
  - 新增 `getPathStat()` 并收紧 `moveFile()` / `obsidianMoveNoteTool` 的覆盖边界：目标若为目录则直接拒绝，`overwrite` 只覆盖现有文件。
- 验证证据：
  - `./node_modules/.bin/tsc --noEmit 2>&1 | rg 'src/mastra/tools/obsidian|src/mastra/index.ts'` 无输出，说明本次改动范围没有新增类型报错。
  - `npm run build` 成功，Mastra CLI 输出 `Build successful, you can now deploy the .mastra/output directory to your target platform.`。
  - 运行验证 1：对 frontmatter 为 `tags: [alpha, beta]`、`aliases: ['A', 'B']`、`meta: { owner: 'team', score: 7 }` 的笔记执行 `patch-frontmatter` 后，输出为结构化 YAML 列表/对象，不再退化为字符串。
  - 运行验证 2：对已有目录 `existing-dir` 执行 `move-note` + `overwrite: true`，返回错误 `destinationPath 必须是笔记文件路径，不能指向目录：existing-dir`，且目录中的 `child.md` 仍存在。
- 文档同步：
  - `spec.md` 已补充 frontmatter 兼容范围与 `move-note` 的覆盖安全边界。
  - `tasks.md` 已新增 fix 任务并标记完成。
