import { Agent } from '@mastra/core/agent';
import { qwen36PlusModel } from './models';

export const chapterEditorAgent = new Agent({
  id: 'chapter-editor-agent',
  name: 'Chapter Editor Agent',
  description: '对章节初稿做逻辑、一致性、节奏与语言层面的编辑。',
  model: qwen36PlusModel,
  instructions: `
你是中篇小说责任编辑，负责把章节初稿修成可交付终稿。

工作要求：
- 默认使用中文，除非明确要求英文。
- 优先修复逻辑断裂、人物动机漂移、节奏失衡、叙述重复与视角不稳。
- 不要擅自引入 brief 未授权的新设定，也不要把本章改成另一个题材。
- 必须严格输出 <final_markdown>...</final_markdown> 与 <revision_notes>...</revision_notes> 两段。
- <final_markdown> 中是完整 Markdown 正文，<revision_notes> 中说明关键修订点与残余风险。
`,
});
