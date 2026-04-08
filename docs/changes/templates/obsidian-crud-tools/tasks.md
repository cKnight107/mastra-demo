# tasks

## 已完成

- [x] 分析 `save-obsidian-story-tool.ts` 现有安全机制和代码结构
- [x] 确认仓库 tool 注册模式和目录组织方式
- [x] 澄清工具通用程度（通用 CRUD，与 story tool 并存）
- [x] 澄清操作范围（全部 8 个操作）
- [x] 澄清删除策略（双模式，默认移入回收站）
- [x] 澄清搜索范围（双模式，默认仅元数据）
- [x] 生成 spec.md、tasks.md、log.md

## 待确认

- [ ] 用户显式确认提案文档，允许进入实现阶段

## 实施任务（确认后执行）

### 基础设施

- [ ] 新建 `src/mastra/tools/obsidian/shared.ts`
  - 提取 vault 路径解析、安全校验（`resolveVaultSubpath`、`sanitizePathSegment`、`sanitizeFileName`）
  - 实现 frontmatter 解析器（`parseFrontmatter`）和序列化器（`serializeFrontmatter`）
  - 前置条件：无

### 各 Tool 实现

- [ ] `read-note-tool.ts`：`obsidian-read-note`
  - 输入：`relativePath: string`
  - 输出：`content`（正文）、`frontmatter`（对象）、`rawContent`（原始文本）
  - 前置条件：`shared.ts` 完成

- [ ] `list-notes-tool.ts`：`obsidian-list-notes`
  - 输入：`folder: string`（默认 vault 根目录）、`recursive: boolean`（默认 true）
  - 输出：`notes: Array<{ relativePath, fileName, size }>`
  - 前置条件：`shared.ts` 完成

- [ ] `search-notes-tool.ts`：`obsidian-search-notes`
  - 输入：`query: string`、`folder?: string`、`searchContent: boolean`（默认 false）、`tags?: string[]`
  - 输出：`results: Array<{ relativePath, fileName, matchedIn, snippet? }>`
  - 前置条件：`list-notes-tool.ts` 完成（复用列举逻辑）

- [ ] `create-note-tool.ts`：`obsidian-create-note`
  - 输入：`title`、`content`、`folder`、`tags?`、`frontmatter?`（自定义字段）
  - 输出：`relativePath`、`notePath`、`fileName`、`obsidianUri`
  - 前置条件：`shared.ts` 完成

- [ ] `update-note-tool.ts`：`obsidian-update-note`
  - 输入：`relativePath`、`content`（新正文）、`mergeFrontmatter?`（追加字段）
  - 输出：`relativePath`、`updatedAt`
  - 前置条件：`read-note-tool.ts` 完成

- [ ] `patch-frontmatter-tool.ts`：`obsidian-patch-frontmatter`
  - 输入：`relativePath`、`fields: Record<string, unknown>`
  - 输出：`relativePath`、`updatedFields`、`updatedAt`
  - 前置条件：`read-note-tool.ts` 完成

- [ ] `append-note-tool.ts`：`obsidian-append-note`
  - 输入：`relativePath`、`content`、`separator?`（默认 `\n\n`）
  - 输出：`relativePath`、`appendedAt`、`newLength`
  - 前置条件：`shared.ts` 完成

- [ ] `delete-note-tool.ts`：`obsidian-delete-note`
  - 输入：`relativePath`、`moveToTrash: boolean`（默认 true）
  - 输出：`deleted`、`destination?`（回收站路径，仅 moveToTrash 时返回）
  - 前置条件：`shared.ts` 完成

- [ ] `move-note-tool.ts`：`obsidian-move-note`
  - 输入：`sourcePath`、`destinationPath`、`overwrite: boolean`（默认 false）
  - 输出：`oldPath`、`newPath`、`movedAt`
  - 前置条件：`shared.ts` 完成

### 集成

- [ ] 新建 `src/mastra/tools/obsidian/index.ts`，统一导出所有 obsidian tools
- [ ] 在 `src/mastra/index.ts` 或相关 agent 中注册新 tools
- [ ] 运行 `npm run build` 验证编译通过
