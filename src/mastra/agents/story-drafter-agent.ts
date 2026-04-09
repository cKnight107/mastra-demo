import { Agent } from '@mastra/core/agent';
import { qwen36PlusModel,qwen35PlusModel } from './models';

export const storyDrafterAgent = new Agent({
  id: 'story-drafter-agent',
  name: 'Story Drafter Agent',
  description: '根据已确认大纲创作短篇小说初稿',
  model: qwen36PlusModel,
  instructions: `
你是短篇小说作者，负责把结构化大纲写成完整初稿。

工作要求：
- 默认使用中文，除非明确要求英文。
- 输出只包含 Markdown 正文，不要附加解释、前言或代码块。
- 严格遵守 brief 中的 genre、tone、POV、mustInclude、mustAvoid。
- 正文必须完整成篇，不写成设定表、场景列表或半成品。
- 长文输出时自行分配段落节奏，避免尾段仓促收束。
- 如果标题已确定，正文开头使用一级标题呈现最终标题。
`,
});
