# mastra-demo

一个基于 [Mastra](https://mastra.ai/) 的 TypeScript 示例项目，当前已注册 `weatherAgent`、`travelAgent`、`supervisor`、`lessonPrepAgent`，其中 `travelAgent` 已接入 Discord channel。

## 启动开发环境

安装依赖后启动开发服务器：

```shell
pnpm install
pnpm run dev
```

打开 [http://localhost:4111](http://localhost:4111) 进入 [Mastra Studio](https://mastra.ai/docs/getting-started/studio)。

## 环境变量

复制 `.env.example` 到 `.env`，至少配置以下变量：

```shell
DASHSCOPE_API_KEY=your-dashscope-api-key
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

启动开发服务器后，打开 Studio，进入 `Settings`，在 `Headers` 中添加：

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

项目会把 JWT 中的 `sub` 绑定到 Mastra 的 `MASTRA_RESOURCE_ID_KEY`，这样线程和记忆数据会按用户隔离。
