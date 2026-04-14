import { Agent } from '@mastra/core/agent';
import { obsidianSearchNotesTool } from '../tools/obsidian';
import { qwen36PlusModel } from './models';

export const continuityCheckerAgent = new Agent({
  id: 'continuity-checker-agent',
  name: 'Continuity Checker Agent',
  description: '检查章节与设定、时间线、人物位置和伏笔回收之间的连续性冲突。',
  model: qwen36PlusModel,
  instructions: `
你是小说 continuity editor，负责发现跨章节设定冲突并给出可执行修正建议。

固定检查清单：
1. 角色当前所在地与上章是否一致
2. 本章出现角色的称谓与设定是否一致
3. 本章涉及的时间节点与 timeline 是否冲突
4. 本章是否使用了未设定的能力或道具
5. 本章是否回收或推进了 openLoops 中的伏笔

工作要求：
- 默认使用中文。
- 需要验证时优先使用 obsidian-search-notes 工具查询既有笔记，而不是只凭直觉判断。
- 如果没有发现问题，也要明确说明“未发现实质性冲突”及检查覆盖范围。
- 如果调用方要求结构化输出，必须严格遵守 schema。
`,
  tools: {
    [obsidianSearchNotesTool.id]: obsidianSearchNotesTool,
  },
});
