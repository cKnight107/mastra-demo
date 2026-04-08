# mastra-demo

一个基于 [Mastra](https://mastra.ai/) 的 TypeScript 示例项目，当前已注册 `weatherAgent`、`travelAgent`、`supervisor`、`lessonPrepAgent`，其中 `travelAgent` 已接入 Discord channel。

## 启动开发环境

安装依赖后启动开发服务器：

```shell
pnpm install
pnpm run dev
```

打开 [http://localhost:4111](http://localhost:4111) 进入 [Mastra Studio](https://mastra.ai/docs/getting-started/studio)。
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

## 环境变量

复制 `.env.example` 到 `.env`，至少配置以下变量：

```shell
DASHSCOPE_API_KEY=your-dashscope-api-key
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=your-openai-api-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mastra_demo
DATABASE_SSL=false
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_PUBLIC_KEY=your-discord-public-key
DISCORD_APPLICATION_ID=your-discord-application-id
```

- `DASHSCOPE_API_KEY`: `travelAgent` 当前使用的 Qwen 模型凭证
- `OPENAI_API_KEY`: scorer、观察记忆和语义回忆 embedding 使用
- `DATABASE_URL`: Mastra storage 持久化地址
- `DISCORD_BOT_TOKEN`: Discord Bot token
- `DISCORD_PUBLIC_KEY`: Discord 应用公钥，用于 interactions 签名校验
- `DISCORD_APPLICATION_ID`: Discord 应用 ID
- `DISCORD_MENTION_ROLE_IDS`: 可选，逗号分隔的角色 ID；配置后这些角色的 mention 也会触发 agent
- `DISCORD_GATEWAY_DNS_SERVERS`: 可选，默认 `1.1.1.1,8.8.8.8`；当本机 DNS 对 `gateway.discord.gg` 解析异常时，启动阶段会优先用这些 DNS 查询
- `DISCORD_GATEWAY_IP`: 可选，手工指定 `gateway.discord.gg` 的 IPv4 兜底，仅在 DNS 仍异常时使用
- `DISCORD_PROXY_URL`: 可选，显式指定 Discord 流量代理，例如 `http://127.0.0.1:7897`；未填写时会尝试自动探测本机 Clash Verge 的 `mixed-port`

### PostgreSQL 准备

项目默认使用 PostgreSQL 存储，并启用了语义回忆，需要在数据库中开启 `pgvector`：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

如果未显式配置 `DATABASE_URL`，默认会尝试连接：

```shell
postgresql://postgres:postgres@localhost:5432/mastra_demo
```

## Discord 联调

当前首期 Discord 入口是 `travelAgent`，覆盖：

- Discord DM
- 频道 `@mention`
- 文本对话
- 图片附件输入

Mastra 会自动生成 Discord webhook：

```text
/api/agents/travel-agent/channels/discord/webhook
```

本地联调需要先暴露公网地址，例如：

```shell
ngrok http 4111
```

然后在 Discord Developer Portal 中完成以下配置：

1. 创建应用并记录 `Application ID`、`Public Key`
2. 在 Bot 页面生成 token，并开启 `Message Content Intent`
3. 将 `Interactions Endpoint URL` 配置为 `https://<your-public-host>/api/agents/travel-agent/channels/discord/webhook`
4. 用 `bot` 与 `applications.commands` scope 邀请机器人进服务器，并授予发送消息、线程发言、读取历史、添加反应、上传文件等权限

当前实现显式采用以下 channel 配置：

- `gateway: true`：支持 DM 与频道普通消息监听
- `cards: true`：保留 Discord 富卡片工具渲染
- `threadContext.maxMessages = 10`：首次在群聊线程 mention 时回补最近 10 条消息
- `inlineMedia = ['image/*']`：将图片附件以内联文件形式传给模型

注意：如果部署到无状态 serverless 环境，需要重新评估 `gateway` 方案；当前配置默认适合有持久连接的运行环境。

如果启动日志里出现 `Discord Gateway listener error`、`ConnectTimeoutError`、`ENOTFOUND gateway.discord.gg` 或解析到异常 IP，可以先保留默认的 `DISCORD_GATEWAY_DNS_SERVERS` 重启；若本机网络仍无法正确解析，再临时填写 `DISCORD_GATEWAY_IP` 作为兜底。

如果本机依赖 Clash/代理访问 Discord，当前运行时会自动探测 Clash Verge 的 `mixed-port` 并接管 Discord 请求；若你的代理不是 Clash Verge，或使用了非默认端口，可显式设置 `DISCORD_PROXY_URL`。

## JWT 鉴权

仓库里保留了 JWT 鉴权接线代码，但当前默认处于注释状态，开发环境不会强制要求所有 `/api/*` 请求携带 JWT。

如果后续重新启用 `MastraJwtAuth`，请保留以下公开路径：

```text
/api/openapi.json
/api/agents/travel-agent/channels/discord/webhook
```

恢复 JWT 后，再按下面方式携带 token：

```shell
Authorization: Bearer <your-jwt>
```

### 生成测试 JWT

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

### 在 Studio 中调试

如果你重新启用了 JWT 鉴权，启动开发服务器后，打开 Studio，进入 `Settings`，在 `Headers` 中添加：

```shell
Authorization: Bearer <your-jwt>
```

### 调用 API

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

