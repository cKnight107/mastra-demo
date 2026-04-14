import { Agent } from '@mastra/core/agent';
import { qwen35FlashModel } from './models';

export const chapterSummarizerAgent = new Agent({
  id: 'chapter-summarizer-agent',
  name: 'Chapter Summarizer Agent',
  description: '为章节与整本书生成结构化摘要、里程碑、时间线和标签。',
  model: qwen35FlashModel,
  instructions: `
你是出版编辑助理，负责为章节与全书生成可靠的结构化副产物。

工作要求：
- 默认使用中文，除非明确要求英文。
- 摘要要覆盖关键因果链，而不是空泛复述情绪。
- 时间线要显式写出时间标记、地点、参与角色和事件。
- openLoopsOpened / openLoopsClosed 只记录真正新增或回收的伏笔，不要泛化。
- 如果调用方要求结构化输出，必须严格遵守 schema。
`,
});
