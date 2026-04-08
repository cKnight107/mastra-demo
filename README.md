# mastra-demo

Welcome to your new [Mastra](https://mastra.ai/) project! We're excited to see what you'll build.

## Getting Started

Start the development server:

```shell
pnpm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/getting-started/studio). It provides an interactive UI for building and testing your agents, along with a REST API that exposes your Mastra application as a local service. This lets you start building without worrying about integration right away.

You can start editing files inside the `src/mastra` directory. The development server will automatically reload whenever you make changes.

## 本地模型提供商

当前项目已支持通过 Mastra 的 `OpenAICompatibleConfig` 接入本地 Ollama。

### 环境变量

复制 `.env.example` 到 `.env` 后，可以按需配置：

```shell
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

- `OLLAMA_BASE_URL`: 本地 Ollama 的 OpenAI-compatible 接口地址，默认按本机 `11434` 端口处理

### 已新增模型

项目已在 `src/mastra/agents/models.ts` 中导出：

```ts
gemma4E4bModel
```

对应本地模型名：

```shell
gemma4:e4b
```

如果需要让某个 agent 使用该模型，直接从 `src/mastra/agents/models.ts` 导入并替换对应 `model` 配置即可。


## Obsidian 接入

当前项目已新增一个面向短篇小说场景的本地 Obsidian 落库能力，采用“直接写入 vault 目录”的方式接入，不依赖额外 MCP 或 REST API。

### 环境变量

复制 `.env.example` 到 `.env` 后，配置：

```shell
OBSIDIAN_VAULT_PATH=D:\Obsidian\YourVault
```

- `OBSIDIAN_VAULT_PATH`: Obsidian vault 根目录的本地绝对路径

### 当前本地配置

当前开发环境已按本机 vault 地址接入：

```shell
D:\Administrator\Documents\Obsidian Vault
```

### 新增能力

- 新增 agent：`story-writer-agent`
- 新增 tool：`saveObsidianStoryTool`
- 默认落库目录：`小说库/短篇`

### 使用方式

启动开发服务后，可通过 Studio 或聊天路由与 `story-writer-agent` 交互。该 agent 在生成短篇小说成稿后，会默认将 Markdown 笔记保存到 Obsidian vault。

示例提示词：

```text
写一篇 2000 字左右的悬疑短篇，主角是一名夜班保安，结尾带一点反转，但整体要克制。写完后保存到 Obsidian。
```

保存后的 Markdown 文件会自动带有 frontmatter，包含标题、状态、题材、文风、摘要和标签，便于在 Obsidian 中继续改稿和管理。
## JWT 鉴权

当前仓库保留了 Mastra 官方 `MastraJwtAuth` 的接入代码，但默认仍处于注释状态，当前分支默认不会强制所有 `/api/*` 请求携带 JWT。

如果你准备重新启用 JWT，可按下面方式配置：

```shell
Authorization: Bearer <your-jwt>
```

### 1. 配置环境变量

复制 `.env.example` 到 `.env`，至少配置：

```shell
DASHSCOPE_API_KEY=your-dashscope-api-key
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=your-openai-api-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mastra_demo
DATABASE_SSL=false
MASTRA_JWT_SECRET=replace-with-a-long-random-secret
```

- `DASHSCOPE_API_KEY`: 主天气 Agent 使用的推理模型
- `OLLAMA_BASE_URL`: 本地 Ollama 兼容 OpenAI 的接口地址
- `OPENAI_API_KEY`: scorer、观察记忆、语义回忆 embedding 使用
- `DATABASE_URL`: PostgreSQL 连接串，消息历史、工作内存、观察记忆都会落到这里
- `DATABASE_SSL`: 本地 PostgreSQL 通常设为 `false`，云数据库要求 SSL 时再设为 `true`

### 1.1 PostgreSQL 准备

项目现在默认把 Mastra storage 切到了 PostgreSQL，并且启用了语义回忆，因此数据库里还需要开启 `pgvector`：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

如果你没有显式配置 `DATABASE_URL`，项目会默认尝试连接本地：

```shell
postgresql://postgres:postgres@localhost:5432/mastra_demo
```

### 2. 生成测试 JWT

JWT 必须使用 `MASTRA_JWT_SECRET` 签名，并且 payload 至少包含一个 `sub` 字段，因为项目会把 `sub` 作为用户资源隔离 ID。

你也可以直接运行项目内置命令生成本地调试 token：

```shell
npm run jwt:dev
```

如果你想指定用户，也可以追加参数：

```shell
npm run jwt:dev -- user-456 user456@example.com "User 456"
```

例如 payload 至少应类似：

```json
{
  "sub": "user-123",
  "email": "user@example.com",
  "name": "Demo User"
}
```

### 3. 在 Studio 中调试

如果你重新启用了 JWT 鉴权，启动开发服务器后，打开 Studio，进入 `Settings`，在 `Headers` 中添加：

```shell
Authorization: Bearer <your-jwt>
```

### 4. 调用 API

```shell
curl -X POST http://localhost:4111/api/agents/weatherAgent/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt>" \
  -d '{
    "messages": "Weather in London"
  }'
```

重新启用 JWT 后，项目会把 JWT 中的 `sub` 绑定到 Mastra 的 `MASTRA_RESOURCE_ID_KEY`，这样线程和记忆数据会按用户隔离。

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). Your bootstrapped project includes example code for [agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/using-tools), [workflows](https://mastra.ai/docs/workflows/overview), [scorers](https://mastra.ai/docs/evals/overview), and [observability](https://mastra.ai/docs/observability/overview).

If you're new to AI agents, check out our [course](https://mastra.ai/course) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy on Mastra Cloud

[Mastra Cloud](https://cloud.mastra.ai/) gives you a serverless agent environment with atomic deployments. Access your agents from anywhere and monitor performance. Make sure they don't go off the rails with evals and tracing.

Check out the [deployment guide](https://mastra.ai/docs/deployment/overview) for more details.

