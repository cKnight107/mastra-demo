import { OpenAICompatibleConfig } from '@mastra/core/llm';

const DASHSCOPE_PROVIDER_ID = 'alibaba-cn';
const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const createDashscopeModel = (modelId: string): OpenAICompatibleConfig => ({
  providerId: DASHSCOPE_PROVIDER_ID,
  modelId,
  apiKey: process.env.DASHSCOPE_API_KEY,
  url: DASHSCOPE_BASE_URL,
});

const createOllamaModel = (modelId: string): OpenAICompatibleConfig => ({
  providerId: 'ollama',
  modelId,
  url: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
});

export const qwen35PlusModel = createDashscopeModel('qwen3.5-plus');

export const qwen36PlusModel = createDashscopeModel('qwen3.6-plus-2026-04-02');

export const qwen35FlashModel = createDashscopeModel('qwen3.5-flash');

export const textEmbeddingV4Model = createDashscopeModel('text-embedding-v4');

export const gemma4E4bModel = createOllamaModel('gemma4:e4b');
