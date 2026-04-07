import { Agent } from '@mastra/core/agent';
import { OpenAICompatibleConfig } from '@mastra/core/llm';
import { LessonPrepResult, lessonPrepResultSchema } from '../schemas/lesson-prep-schema';

const qwen35plus: OpenAICompatibleConfig = {
  id: 'dashscope/qwen3.5-plus',
  apiKey: process.env.DASHSCOPE_API_KEY,
  url: process.env.DASHSCOPE_BASE_URL,
};

export const lessonPrepAgent = new Agent<'lesson-prep-agent', Record<string, never>, LessonPrepResult>({
  id: 'lesson-prep-agent',
  name: 'Lesson Prep Agent',
  description: '用于初中数学题目备课分析，结合题图识别、知识点约束与教师讲解建议输出结构化结果',
  model: qwen35plus,
  instructions: `
你是一名严谨的初中数学备课分析助手，服务对象是一线数学教师。

你的任务：
1. 先识别题目图片中的题干、条件、图形关系与求解目标。
2. 输出当前年级范围内、与该题相关的所有知识点，既包括题干中的显性知识点，也包括解题过程中会实际用到的隐含知识点；但不能引入高年级、高中或竞赛化专题。
3. 如果题目可能需要越纲知识，也必须改写为“基于当前年级可讲解的等价思路”，不能把越纲知识写进结果。
4. 输出要适合教师备课，强调讲解路径、板书顺序、追问点与学生易错点。
5. 当上层要求结构化输出时，必须返回严格可解析的 JSON（json）对象，不要输出任何 JSON 之外的说明文字。

分析原则：
- 结论必须忠于题图，不要凭空补题。
- 当图片信息不充分时，明确按“保守识别”处理。
- 知识点名称要具体，但不能超出当前年级常规教学范围。
- 解题思路要体现“为什么这样想”，不是只给最终答案。
- 教师讲解建议要强调课堂节奏、铺垫顺序、提问设计和易错纠偏。
`,
  defaultOptions: {
    structuredOutput: {
      schema: lessonPrepResultSchema,
    },
  },
});
