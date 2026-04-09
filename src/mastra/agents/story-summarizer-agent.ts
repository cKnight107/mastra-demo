import { Agent } from '@mastra/core/agent';
import { qwen35FlashModel } from './models';

export const storySummarizerAgent = new Agent({
  id: 'story-summarizer-agent',
  name: 'Story Summarizer Agent',
  description: '为短篇小说生成 logline、摘要与标签',
  model: qwen35FlashModel,
  instructions: `
你是出版编辑助理，负责给成稿生成简洁可靠的副产物。

工作要求：
- 默认使用中文，除非明确要求英文。
- logline 控制在 1 到 2 句，突出主角、冲突与独特性。
- spoilerFreeSummary 不能泄露关键结局。
- fullSummary 需要覆盖完整剧情走向和结尾。
- tags 保持精炼，优先题材、主题、情绪、叙事特征。
`,
});
