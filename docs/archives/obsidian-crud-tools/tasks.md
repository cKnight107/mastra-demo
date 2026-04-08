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

- [x] 用户显式确认提案文档，允许进入实现阶段

## 实施任务（确认后执行）

### 基础设施

- [x] 新建 `src/mastra/tools/obsidian/shared.ts`
  - 提取 vault 路径解析、安全校验（`resolveVaultSubpath`、`sanitizePathSegment`、`sanitizeFileName`）
  - 实现 frontmatter 解析器（`parseFrontmatter`）和序列化器（`serializeFrontmatter`）
  - 前置条件：无

### 各 Tool 实现

- [x] `read-note-tool.ts`：`obsidian-read-note`
  - 输入：`relativePath: string`
  - 输出：`content`（正文）、`frontmatter`（对象）、`rawContent`（原始文本）
  - 前置条件：`shared.ts` 完成

- [x] `list-notes-tool.ts`：`obsidian-list-notes`
  - 输入：`folder: string`（默认 vault 根目录）、`recursive: boolean`（默认 true）
  - 输出：`notes: Array<{ relativePath, fileName, size }>`
  - 前置条件：`shared.ts` 完成

- [x] `search-notes-tool.ts`：`obsidian-search-notes`
  - 输入：`query: string`、`folder?: string`、`searchContent: boolean`（默认 false）、`tags?: string[]`
  - 输出：`results: Array<{ relativePath, fileName, matchedIn, snippet? }>`
  - 前置条件：`list-notes-tool.ts` 完成（复用列举逻辑）

- [x] `create-note-tool.ts`：`obsidian-create-note`
  - 输入：`title`、`content`、`folder`、`tags?`、`frontmatter?`（自定义字段）
  - 输出：`relativePath`、`notePath`、`fileName`、`obsidianUri`
  - 前置条件：`shared.ts` 完成

- [x] `update-note-tool.ts`：`obsidian-update-note`
  - 输入：`relativePath`、`content`（新正文）、`mergeFrontmatter?`（追加字段）
  - 输出：`relativePath`、`updatedAt`
  - 前置条件：`read-note-tool.ts` 完成

- [x] `patch-frontmatter-tool.ts`：`obsidian-patch-frontmatter`
  - 输入：`relativePath`、`fields: Record<string, unknown>`
  - 输出：`relativePath`、`updatedFields`、`updatedAt`
  - 前置条件：`read-note-tool.ts` 完成

- [x] `append-note-tool.ts`：`obsidian-append-note`
  - 输入：`relativePath`、`content`、`separator?`（默认 `\n\n`）
  - 输出：`relativePath`、`appendedAt`、`newLength`
  - 前置条件：`shared.ts` 完成

- [x] `delete-note-tool.ts`：`obsidian-delete-note`
  - 输入：`relativePath`、`moveToTrash: boolean`（默认 true）
  - 输出：`deleted`、`destination?`（回收站路径，仅 moveToTrash 时返回）
  - 前置条件：`shared.ts` 完成

- [x] `move-note-tool.ts`：`obsidian-move-note`
  - 输入：`sourcePath`、`destinationPath`、`overwrite: boolean`（默认 false）
  - 输出：`oldPath`、`newPath`、`movedAt`
  - 前置条件：`shared.ts` 完成

### 集成

- [x] 新建 `src/mastra/tools/obsidian/index.ts`，统一导出所有 obsidian tools
- [x] 在 `src/mastra/index.ts` 或相关 agent 中注册新 tools
- [x] 运行 `npm run build` 验证编译通过

## Fix 任务（第二轮 spec-review 后）

- [x] 修复 `delete-note` 在 Windows 平台下 `_trash` 路径拼接 bug
  - 将 `.split(path.sep)` 改为 `.split(/[\\/]+/)` 以兼容 Windows 反斜杠
  - 验证：`npm run build` 通过，tsc --noEmit 无新增报错

- [x] 补充 `search-notes` tool description 性能说明
  - 明确标注"即使不搜索正文，仍需读取每个文件以解析 frontmatter"

- [x] 统一 `create-note` 中 `created` / `updated` 时间戳格式
  - `updated` 改为与 `created` 一致，均使用 `formatDate` 输出本地日期（`YYYY-MM-DD`）

- [x] 修复 `parseNote` 多余前导换行
  - 将 `.replace(/^\n/, '')` 改为 `.replace(/^\n+/, '')`，兼容 frontmatter `---` 后多个空行

## Fix 任务（review 后增量修正）

- [x] 修复 `patch/update` 对常见 inline YAML frontmatter 的结构破坏问题
  - 支持 inline list/object 的解析，避免 `[a, b]`、`{ key: value }` 在 patch/update 后退化为字符串
  - 验证：对含 inline `tags`、`aliases`、`meta` 的笔记执行 `patch-frontmatter`，输出保持为结构化 YAML

- [x] 修复 `move-note` 在 `overwrite: true` 时可能递归删除目标目录的问题
  - 将覆盖边界收紧为“只允许覆盖现有文件，不允许目录目标”
  - 验证：对已有目录执行 move + overwrite 时返回明确错误，且目录内文件保留
