# log

## 2026-04-08

- 创建 `add-obsidian-vault-integration` 变更记录，目标为新增 Obsidian 本地 vault 落库能力，并为短篇小说创作提供直接保存入口。
- 决定优先采用本地文件系统写入方式接入 Obsidian，不引入额外 MCP 或 REST API 依赖。
- 新增 `saveObsidianStoryTool`，实现 vault 根目录校验、路径清洗、目录创建、frontmatter 生成和 Markdown 写入。
- 新增 `story-writer-agent`，默认在用户未明确禁止保存时，将短篇小说成稿写入 Obsidian。
- 更新 `src/mastra/index.ts`、`.env.example`、`.env` 和 `README.md`，补齐注册、配置与使用说明。
- 运行 `npm run build` 成功，Mastra CLI 构建通过。
- 通过提权烟测真实写入一条测试笔记到 `D:\Administrator\Documents\Obsidian Vault\stories\smoke-tests\2026-04-08-obsidian-integration-smoke-test.md`，确认工具可实际落库。
