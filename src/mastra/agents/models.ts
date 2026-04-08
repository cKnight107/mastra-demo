import { OpenAICompatibleConfig } from '@mastra/core/llm';

const createDashscopeModel = (id: `${string}/${string}`): OpenAICompatibleConfig => ({
  id,
  apiKey: process.env.DASHSCOPE_API_KEY,
  url: process.env.DASHSCOPE_BASE_URL,
});

export const qwen35PlusModel = createDashscopeModel('dashscope/qwen3.5-plus');

export const qwen36PlusModel = createDashscopeModel('dashscope/qwen3.6-plus');

export const qwen35FlashModel = createDashscopeModel('dashscope/qwen3.5-flash');

export const textEmbeddingV4Model = createDashscopeModel('dashscope/text-embedding-v4');
