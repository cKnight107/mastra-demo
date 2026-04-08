# add-local-ollama-provider

## 背景

当前仓库的模型配置集中在 `src/mastra/agents/models.ts`，已接入 DashScope 兼容接口模型，但尚未提供本地 Ollama 作为推理提供商的统一配置入口。

本次变更目标是补齐本地 Ollama provider，并新增一个可复用模型导出：`gemma4:e4b`。

## 代码现状

### 已有能力

- 当前 agent 模型配置通过 `OpenAICompatibleConfig` 统一描述，说明项目已经采用 Mastra 支持的 OpenAI-compatible provider 接入方式。
  - 代码出处：`src/mastra/agents/models.ts`
- 当前多个 agent 都从 `src/mastra/agents/models.ts` 导入模型配置，模型入口已经集中。
  - 代码出处：`src/mastra/agents/weather-agent.ts`
  - 代码出处：`src/mastra/agents/travel-agent.ts`
  - 代码出处：`src/mastra/agents/team-agent.ts`
  - 代码出处：`src/mastra/agents/lesson-prep-agent.ts`
- Mastra 当前安装版本允许 `Agent.model` 使用 `OpenAICompatibleConfig`，可通过 `providerId/modelId` 或 `id` + `url` 的形式配置自定义兼容 provider。
  - 文档出处：`node_modules/@mastra/core/dist/agent/types.d.ts`
  - 文档出处：`node_modules/@mastra/core/dist/llm/model/shared.types.d.ts`

### 明确缺口

- 当前项目没有本地 Ollama 的 provider 工厂方法。
- 当前项目没有导出 `gemma4:e4b` 模型配置。
- `.env.example` 与 `README.md` 没有说明本地 Ollama 的接入方式。
- `README.md` 中“JWT 鉴权已启用”的描述与当前 `src/mastra/index.ts` 中默认注释状态不一致。

## 目标

1. 新增本地 Ollama 的统一 provider 配置入口。
2. 新增 `gemma4:e4b` 模型导出，便于后续 agent 直接复用。
3. 补充环境变量与本地运行说明。
4. 修正 README 中与当前代码不一致的 JWT 描述。

## 技术决策

- 沿用现有 `OpenAICompatibleConfig` 模式接入本地 Ollama，不新增额外 provider 包。
- Ollama 基础地址默认使用本地 OpenAI-compatible 端点：`http://127.0.0.1:11434/v1`，同时允许通过 `OLLAMA_BASE_URL` 覆盖。
- 本次只新增 provider 与模型导出，不主动替换现有 agent 默认模型，避免引入额外行为变化。

## 变更范围

### 预计修改

- `src/mastra/agents/models.ts`
  - 增加 Ollama provider 工厂方法与 `gemma4E4bModel`
- `.env.example`
  - 增加 `OLLAMA_BASE_URL`
- `README.md`
  - 增加本地 Ollama 说明
  - 修正 JWT 默认状态描述

### 本次不修改

- 现有 agent 默认模型选择
- scorer 模型配置
- storage、workflow 与工具逻辑
