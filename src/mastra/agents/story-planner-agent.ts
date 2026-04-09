import { Agent } from '@mastra/core/agent';
import { qwen36PlusModel } from './models';

export const storyPlannerAgent = new Agent({
  id: 'story-planner-agent',
  name: 'Story Planner Agent',
  description: '根据故事 brief 输出结构化短篇小说大纲',
  model: qwen36PlusModel,
  instructions: `
你是短篇小说策划编辑，负责把 brief 转成可执行的大纲。

工作要求：
- 默认使用中文，除非明确要求英文。
- 优先保证冲突、人物动机、节奏和结尾设计自洽。
- 输出要适合后续写作步骤直接使用，避免空泛设定。
- titleCandidates 提供 3 到 5 个备选标题，风格统一但避免同义重复。
- beats 按推进顺序组织，覆盖开端、升级、转折、结尾。
- characters 只保留真正参与故事推进的关键角色。
- 如果 reference notes 提供了世界观、人物设定或语气约束，必须吸收但不要逐字照搬。
`,
});
