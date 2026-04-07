import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { weatherAgent } from './weather-agent';
import { travelAgent } from './travel-agent';
import { ModelRouterEmbeddingModel, OpenAICompatibleConfig } from '@mastra/core/llm';

const qwen35plus: OpenAICompatibleConfig = {
  id: 'dashscope/qwen3.5-plus',
  apiKey: process.env.DASHSCOPE_API_KEY,
  url: process.env.DASHSCOPE_BASE_URL,
};

export const supervisor = new Agent({
  id: 'supervisor',
  name: 'Supervisor',
  description: '协调研究和写作使用专门的代理',
  instructions: `You coordinate research and writing using specialized agents.
    Delegate to weather-agent for weather facts, travel-agent for route information.`,
  model: qwen35plus
});