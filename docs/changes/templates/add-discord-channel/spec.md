# add-discord-channel

## 背景

目标是在本仓库中评估并规划 Mastra `channels` 能力的接入方式，为接入 Discord Bot 做实现前提案，不进入编码阶段。

## 代码现状

### 已有能力

- 当前项目已使用 Mastra `@mastra/core@^1.23.0`、`@mastra/server@^1.23.0`，而本地内嵌文档显示 `channels` 功能在 `@mastra/core@1.22.0` 起已提供，因此当前安装版本具备该能力。
  - 代码出处：`package.json:21-39`
  - 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:1-5`
- 当前 Mastra 入口已经集中注册 agent、workflow、scorer，并使用 `MastraCompositeStore` 挂接默认存储；这满足 channel 需要持久化线程状态的前置条件。
  - 代码出处：`src/mastra/index.ts:46-115`
  - 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:35-48`
  - 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:38-45`
- 当前仓库已有四个已注册 agent：`weatherAgent`、`travelAgent`、`supervisor`、`lessonPrepAgent`。其中 `travelAgent` 当前职责相对收敛，更适合作为 Discord 首期接入目标。
  - 代码出处：`src/mastra/index.ts:48-50`
  - 代码出处：`src/mastra/agents/travel-agent.ts:7-43`

### 明确缺口

- 当前任一 agent 均未配置 `channels` 字段，也没有 Discord 适配器导入。
  - 代码出处：`src/mastra/agents/weather-agent.ts:9-89`
  - 代码出处：`src/mastra/agents/travel-agent.ts:7-43`
  - 代码出处：`src/mastra/agents/team-agent.ts:8-19`
  - 代码出处：`src/mastra/agents/lesson-prep-agent.ts:5-32`
- 当前依赖中没有 `@chat-adapter/discord` 包，因此尚不具备 Discord channel 的运行依赖。
  - 代码出处：`package.json:21-39`
- 当前 `server.apiRoutes` 只显式注册了 `chatRoute('/chat/:agentId')`；但 Mastra 官方文档说明 channel webhook 路由由框架按 agent/channel 自动生成，不需要手写额外 REST 路由。
  - 代码出处：`src/mastra/index.ts:51-56`
  - 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:56-65`

### 约束与风险前置信息

- 当前仓库中的 JWT 鉴权逻辑处于注释状态；若后续重新启用，Discord webhook 路径需要被放入公开白名单，或单独做 Discord 签名校验，否则平台回调会被鉴权拦截。
  - 代码出处：`src/mastra/index.ts:57-107`
- 当前 README 声明“所有 `/api/*` 都需要 JWT”，与代码实际状态不一致；这会影响 Discord 接入时对外暴露 webhook 的运维认知。
  - 文档出处：`README.md:17-101`
  - 代码出处：`src/mastra/index.ts:57-107`

## Mastra Channels 调研结论

### 1. Channels 在 Mastra 中的接入位置

- `channels` 是 `new Agent({...})` 的一部分，而不是 `Mastra` 顶层配置。
- `channels` 可直接传配置对象，也可传 `AgentChannels` 实例。
- 最核心配置是：
  - `adapters`: 平台适配器集合，如 `discord: createDiscordAdapter()`
  - `handlers`: 自定义 DM、Mention、订阅线程消息处理
  - `inlineMedia` / `inlineLinks`: 多模态附件和链接提升
  - `tools`: 是否注入 channel 专属工具
  - `state`: channel 状态适配器
  - `threadContext`: 首次提及时回补最近消息条数
  - `chatOptions`: 透传到 Chat SDK 的高级配置
- 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:28-47`
- 类型出处：`node_modules/@mastra/core/dist/agent/types.d.ts:269-292`

### 2. Discord 的接入方式

- 官方示例使用 `createDiscordAdapter`，包名为 `@chat-adapter/discord`。
- 最小形态是在目标 agent 上增加：

```ts
channels: {
  adapters: {
    discord: createDiscordAdapter(),
  },
}
```

- 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:130-151`
- 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:9-26`
- 官方适配器文档：[Discord adapter](https://vercel-chat.mintlify.app/adapters/discord)

### 3. Discord 与 webhook / gateway 的职责边界

- Mastra 会为 Discord 自动生成 webhook 路径：
  - `/api/agents/{agentId}/channels/discord/webhook`
- 这条路径主要用于平台回调接入。
- 若需要 Bot 持续监听普通消息、DM、`@mention` 和 reaction，参考官方 reference，应保留 `gateway: true` 或显式开启；若部署环境是无状态 serverless，只做 interaction/webhook，可设置 `gateway: false`。
- 这意味着“是否要支持普通频道对话，而不是只支持 slash/interactions”是架构级澄清项。
- 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:56-78`
- 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:48-83`
- 官方适配器文档：[Discord adapter](https://vercel-chat.mintlify.app/adapters/discord)

### 4. Thread / 上下文 / 多人群聊处理

- 在群聊线程中首次 `@mention` agent 时，Mastra 默认会回补最近 10 条平台消息，再把这些消息作为上下文拼到当前轮次里。
- 响应后 agent 会订阅该线程，后续消息改走 Mastra 自身记忆，不会再次从平台反查历史。
- 群聊中 Mastra 会自动在消息前注入用户名和平台 ID，帮助模型识别不同发言者。
- 这意味着 Discord Bot 并不只是“把一条消息发给 agent”，而是已经包含线程订阅、多用户区分、跨重启状态恢复。
- 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:80-124`
- 类型出处：`node_modules/@mastra/core/dist/channels/types.d.ts:18-48`

### 5. 工具调用与卡片交互

- Channel 默认支持 channel-specific tools，并可将工具调用渲染为富卡片。
- 若工具 `requireApproval: true`，默认会显示 Approve / Deny 交互卡片。
- 若 Discord 端不希望使用卡片，可对适配器设置 `cards: false`，改为纯文本格式化输出。
- 当前仓库的 `travelAgent` 依赖工具，因此 Discord 端如何呈现工具结果是必须提前确认的体验问题。
- 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:91-116`
- 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:74-83`

### 6. 多模态与附件能力

- `inlineMedia` 默认仅内联图片：`['image/*']`。
- 对 Discord 这类公开 CDN 平台，文档说明附件 URL 可直接传给模型。
- 首期已确认需要支持图片附件，因此实现时应优先把图片作为 file part 送入模型，而不是只做文本摘要。
- 文档出处：`node_modules/@mastra/core/dist/docs/references/docs-agents-channels.md:126-163`
- 文档出处：`node_modules/@mastra/core/dist/docs/references/reference-agents-channels.md:131-158`

## 功能点

本次需求提案聚焦以下能力：

1. 为本仓库规划 `travelAgent` 的 Discord 接入。
2. 首期先跑通 Discord，并支持正常对话。
3. 首期交互按最小可用范围覆盖：DM + 频道 `@mention`。
4. 首期支持图片附件输入。
5. 说明文档与环境变量说明需一并补齐。
6. 为未来恢复 JWT 鉴权预留 Discord webhook 公共白名单扩展口子。

## 建议方案

### 已确认方案

已确认首期以 `travelAgent` 作为 Discord 入口，范围只覆盖：

- Discord DM
- Discord 频道中的 `@mention`
- 正常文本对话
- 图片附件输入

确认原因与影响：

- `travelAgent` 当前职责边界明确，首期更适合验证 Discord channel 接入链路是否跑通。
- 首期目标是“先跑通 Discord 并正常对话”，因此不引入额外 agent 路由复杂度。
- 由于已确认需要支持图片附件，后续实现时需要为 `travelAgent` 增加合适的 `channels.inlineMedia` 配置，并评估当前模型是否满足图片输入场景。

### 暂不建议首期纳入

- 自定义 `handlers`
- `cards: false` 之外的复杂渲染定制
- `inlineLinks` 的视频/外链增强
- 新增专用 `discord-agent`
- 多 Discord 平台并行（如同时 Slack/Telegram）

这些能力都已经被 Mastra `channels` 支持，但属于第二阶段优化项。

## 变更范围

### 确认后预计修改

- `package.json`
  - 增加 Discord 适配器依赖
- `src/mastra/agents/travel-agent.ts`
  - 为 `travelAgent` 增加 `channels.discord`、DM / `@mention` 和图片输入配置
- `src/mastra/index.ts`
  - 仅在需要补充说明、公开路径或鉴权白名单预留点时调整
- `.env.example` / README
  - 增加 Discord 相关环境变量和联调说明

### 本提案阶段不修改

- 业务工具逻辑
- workflow 逻辑
- 数据库 schema / migration
- 现有 scorer 逻辑

## 外部依赖与环境

接入 Discord 至少需要确认以下外部条件：

- 安装 `@chat-adapter/discord`
- 准备 Discord Bot 应用配置
- 为本地联调提供公网地址，例如 `ngrok http 4111`
- 将 Discord 平台侧回调指向：
  - `/api/agents/{agentId}/channels/discord/webhook`

参考资料：

- [Mastra Channels 指南](https://mastra.ai/docs/agents/channels)
- [Mastra Channels Reference](https://mastra.ai/reference/agents/channels)
- [Chat SDK Discord Adapter](https://vercel-chat.mintlify.app/adapters/discord)

## 风险

- 若未来重新启用 JWT 鉴权而未同步放开 Discord webhook 公共路径，平台回调会直接失败。
- 若目标部署环境不支持持久进程，默认 `gateway: true` 可能不合适，需要退回 webhook/interactions 模式。
- 首期纳入图片输入后，需要确认当前模型和 prompt 是否能稳定处理图片内容，否则会出现“能收图但不会用图”的体验问题。
- 当前 README 与实际鉴权状态不一致，容易造成环境配置误判。

## 技术决策

### 当前已确认

- 使用 Mastra 官方 `channels` 能力，而不是自建 Discord webhook 路由。
- 使用 Chat SDK 的 Discord 适配器，而不是自行对接 Discord SDK。
- 保持提案阶段，不进入实现。
- 首期 Discord 入口绑定 `travelAgent`。
- 首期目标是先跑通 Discord，并支持正常对话。
- 首期交互按默认最小可用范围处理为：DM + 频道 `@mention`。
- 首期纳入图片附件输入能力。
- 说明文档需与实现一起补齐。
- 若后续恢复 JWT 鉴权，需要预留 Discord webhook 公共路径白名单扩展点。

### 当前默认实现假设

- 使用默认 `threadContext.maxMessages = 10`，保留线程上下文回补。
- 默认保留 `gateway: true`，以支持 DM 与频道 `@mention` 的正常实时接入。
- 图片输入先按 `inlineMedia` 覆盖图片类型处理，不在首期扩展到视频、音频或外链内联。

### 已放弃方案

- 方案：在 `server.apiRoutes` 下自建 Discord webhook 路由再手动调用 agent。
  - 放弃原因：与 Mastra `channels` 的现成能力重复，且会绕过其线程订阅、上下文回补、channel tool、state adapter 等机制。
- 方案：首期以 `supervisor` 作为 Discord 统一入口。
  - 放弃原因：当前目标是优先验证 Discord 链路与基础对话，不需要引入多 agent 路由复杂度。

## 待澄清

1. 是否基于当前已确认范围进入 Apply 阶段。
