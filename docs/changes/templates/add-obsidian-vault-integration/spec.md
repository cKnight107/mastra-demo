# add-obsidian-vault-integration

## 背景

当前仓库已经具备 Mastra agent、tool、workflow 的基本组织结构，且用户已经确认本地 Obsidian vault 地址为 `D:\Administrator\Documents\Obsidian Vault`。本次变更目标是让项目内的短篇小说创作能力可以直接把 Markdown 笔记落到该 vault 中，供 Obsidian 自动索引和后续编辑。

## 代码现状

### 已有能力

- 项目已经通过 `src/mastra/index.ts` 统一注册 Mastra agents 和 workflows，新增 agent 只需在该入口导入并注册。
  - 代码出处：`src/mastra/index.ts`
- 当前仓库已有多个 `createTool()` 示例，说明项目已经采用 Mastra 官方工具模式，可直接扩展为本地文件写入型工具。
  - 代码出处：`src/mastra/tools/weather-tool.ts`
  - 代码出处：`src/mastra/tools/route-cities-tool.ts`
  - 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md`
- 当前仓库已有多个 agent 示例，并且 agent 可通过 `tools` 字段接入工具。
  - 代码出处：`src/mastra/agents/weather-agent.ts`
  - 代码出处：`src/mastra/agents/travel-agent.ts`
- 当前模型配置已集中在 `src/mastra/agents/models.ts`，可直接复用已有 DashScope 模型配置为小说 agent 提供模型。
  - 代码出处：`src/mastra/agents/models.ts`

### 明确缺口

- 当前仓库没有任何 Obsidian 或本地 Markdown vault 的配置项。
- 当前仓库没有文件系统写入型工具来保存笔记。
- 当前仓库没有面向短篇小说创作的 agent，也没有和 Obsidian 落库联动的实现。
- `.env.example` 和 `README.md` 尚未说明 Obsidian vault 的配置方式和使用路径。

## 目标

1. 新增一个可安全写入本地 Obsidian vault 的 Mastra tool。
2. 新增一个短篇小说 agent，能够创作并将结果保存到 Obsidian。
3. 补充 `OBSIDIAN_VAULT_PATH` 环境变量说明，并完成当前本地地址接入。
4. 更新 README，说明使用方式、默认落库目录和 agent 入口。

## 技术决策

- 采用“直接写入本地 vault 目录”的方式接入 Obsidian，不额外引入 MCP 或 REST API 依赖。
- 以 `OBSIDIAN_VAULT_PATH` 作为 vault 根目录配置；当前本地环境使用用户已确认的路径 `D:\Administrator\Documents\Obsidian Vault`。
- 新增 `saveObsidianStoryTool`，负责安全拼接路径、创建目录、写入 frontmatter 和 Markdown 正文。
- 第一版默认落库目录为 `小说库/短篇`，优先满足短篇小说场景，不扩展为通用知识库同步器。
- Agent 输出以自然语言创作为主，落库时由工具统一生成 frontmatter，避免模型直接拼 YAML 导致格式漂移。

## 变更范围

### 预计修改

- `src/mastra/tools/save-obsidian-story-tool.ts`
  - 新增本地 Obsidian Markdown 落库工具
- `src/mastra/agents/story-writer-agent.ts`
  - 新增短篇小说 agent，并接入保存工具
- `src/mastra/index.ts`
  - 注册新 agent
- `.env.example`
  - 增加 `OBSIDIAN_VAULT_PATH` 示例
- `README.md`
  - 增加 Obsidian 接入与使用说明
- `.env`
  - 在本地开发环境中补充已确认的 vault 路径

### 本次不修改

- 现有 weather、travel、lesson-prep 等 agent 的行为
- workflow、storage、鉴权和数据库结构
- Obsidian 社区插件、MCP server 或 Local REST API 接入

## 风险

- 本地路径写入属于有副作用操作，需要确保生成路径始终限制在 vault 根目录内，避免路径穿越。
- 文件命名与目录名需要做字符清洗，否则在 Windows 文件系统下可能写入失败。
- 如果用户后续迁移 vault 地址，需要同步更新 `OBSIDIAN_VAULT_PATH`。
- 当前默认是直接写本地文件，若未来需要多客户端共享或双向同步，可能需要再演进到 MCP 或 REST API 方案。
