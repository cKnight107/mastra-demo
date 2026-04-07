import { z } from 'zod';

export const knowledgePointSchema = z.object({
  name: z.string().min(1).describe('知识点名称'),
  module: z.string().min(1).describe('所属模块'),
  reason: z.string().min(1).describe('该知识点为何属于当前年级，且与本题存在直接或隐含关联'),
});

export const lessonPrepResultSchema = z.object({
  grade: z.enum(['初一', '初二', '初三']),
  problemType: z.string(),
  scopeBasis: z.string(),
  problemSummary: z.string().min(1).describe('对题目内容的简洁识别'),
  knowledgePoints: z.array(knowledgePointSchema).min(1).describe('当前年级范围内，与本题相关的所有知识点，包含显性与隐含知识点'),
  solutionApproach: z.array(z.string()).min(1).describe('学生可接受的解题思路'),
  // teacherExplanation: z.object({
  //   lectureFlow: z.array(z.string()).min(1).describe('教师课堂讲解顺序'),
  //   teachingSuggestions: z.array(z.string()).min(1).describe('教师讲解建议、追问点和板书建议'),
  // }),
  commonMistakes: z.array(z.string()).min(1).describe('学生易错点提炼'),
});

export type LessonPrepResult = z.infer<typeof lessonPrepResultSchema>;
