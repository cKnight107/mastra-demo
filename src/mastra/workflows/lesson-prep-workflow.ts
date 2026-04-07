import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { lessonPrepResultSchema } from '../schemas/lesson-prep-schema';

const lessonPrepInputSchema = z
  .object({
    grade: z.enum(['初一', '初二', '初三']).describe('当前授课年级'),
    problemType: z.string().min(1).describe('题型，如压轴题、函数综合题、几何综合题'),
    imageUrl: z.string().url().optional().describe('公网可访问的题目图片 URL'),
    imageData: z.string().min(1).optional().describe('题目图片内容，支持 Base64 或 data URL'),
  })
  .refine(input => Boolean(input.imageUrl || input.imageData), {
    message: 'imageUrl 和 imageData 至少提供一个',
    path: ['imageUrl'],
  });

const gradeScopeSchema = z.object({
  grade: z.enum(['初一', '初二', '初三']),
  scopeBasis: z.string(),
  allowedTopics: z.array(z.string()),
  forbiddenTopics: z.array(z.string()),
  validationRules: z.array(z.string()),
});

const scopedRequestSchema = z.object({
  request: lessonPrepInputSchema,
  gradeScope: gradeScopeSchema,
});

const draftAnalysisSchema = z.object({
  request: lessonPrepInputSchema,
  gradeScope: gradeScopeSchema,
  draftAnalysis: lessonPrepResultSchema,
});

const buildImagePart = (request: z.infer<typeof lessonPrepInputSchema>) => {
  if (request.imageData) {
    const dataUrlMatch = request.imageData.match(/^data:(.+?);base64,(.+)$/);
    if (dataUrlMatch) {
      return {
        type: 'image' as const,
        image: dataUrlMatch[2],
        mimeType: dataUrlMatch[1],
      };
    }

    return {
      type: 'image' as const,
      image: request.imageData,
      mimeType: 'image/*',
    };
  }

  if (!request.imageUrl) {
    throw new Error('Image input not found');
  }

  return {
    type: 'image' as const,
    image: new URL(request.imageUrl),
  };
};

const GRADE_SCOPE_MAP: Record<
  z.infer<typeof lessonPrepInputSchema>['grade'],
  {
    allowedTopics: string[];
    forbiddenTopics: string[];
    validationRules: string[];
  }
> = {
  初一: {
    allowedTopics: [
      '有理数及其运算',
      '整式的加减',
      '一元一次方程',
      '几何图形初步',
      '相交线与平行线',
      '平面直角坐标系基础',
      '三角形基础',
      '简单统计与数据整理',
    ],
    forbiddenTopics: [
      '二次函数',
      '反比例函数',
      '相似三角形',
      '圆',
      '锐角三角函数',
      '导数',
      '向量',
      '圆锥曲线',
      '竞赛结论或超常技巧',
    ],
    validationRules: [
      '若一个知识点通常在初二或初三系统学习，则不能列入结果',
      '若只能依赖结论记忆而无法用初一知识完整讲清，则按超纲处理',
    ],
  },
  初二: {
    allowedTopics: [
      '二次根式',
      '勾股定理',
      '全等三角形',
      '轴对称',
      '整式乘法与因式分解',
      '分式',
      '一次函数',
      '一元一次不等式与不等式组',
      '数据分析基础',
      '证明入门与图形变换基础',
    ],
    forbiddenTopics: [
      '二次函数',
      '相似三角形',
      '圆',
      '锐角三角函数',
      '导数',
      '向量',
      '圆锥曲线',
      '竞赛结论或超常技巧',
    ],
    validationRules: [
      '若知识点通常在初三系统学习，则不能列入结果',
      '若题目看似可用相似或三角函数秒解，也必须回退到初二可讲清的思路',
    ],
  },
  初三: {
    allowedTopics: [
      '一元二次方程',
      '反比例函数',
      '二次函数',
      '相似三角形',
      '圆',
      '锐角三角函数',
      '概率初步',
      '初中范围内的代数几何综合',
    ],
    forbiddenTopics: [
      '导数',
      '向量',
      '圆锥曲线',
      '复数',
      '高等函数思想',
      '竞赛结论或超常技巧',
    ],
    validationRules: [
      '不得引入高中知识与竞赛技巧',
      '若出现更高阶方法，必须改写为初中课标范围内可讲解的等价思路',
    ],
  },
};

const prepareGradeScope = createStep({
  id: 'prepare-grade-scope',
  description: '根据年级生成保守的初中数学知识范围约束',
  inputSchema: lessonPrepInputSchema,
  outputSchema: scopedRequestSchema,
  execute: async ({ inputData }) => {
    const scope = GRADE_SCOPE_MAP[inputData.grade];

    return {
      request: inputData,
      gradeScope: {
        grade: inputData.grade,
        scopeBasis: `按中国大陆初中数学通用教学进度做保守判定；如果某个知识点是否属于 ${inputData.grade} 无法确定，则按“可能超纲”处理，不写入最终结果。`,
        allowedTopics: scope.allowedTopics,
        forbiddenTopics: scope.forbiddenTopics,
        validationRules: scope.validationRules,
      },
    };
  },
});

const analyzeLessonPrep = createStep({
  id: 'analyze-lesson-prep',
  description: '结合题目图片和年级范围生成备课分析草稿',
  inputSchema: scopedRequestSchema,
  outputSchema: draftAnalysisSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('lessonPrepAgent');
    if (!agent) {
      throw new Error('Lesson prep agent not found');
    }

    const { request, gradeScope } = inputData;
    const response = await agent.generate(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
请根据题目图片完成初中数学备课分析。

输入信息：
- 年级：${request.grade}
- 题型：${request.problemType}
- 范围依据：${gradeScope.scopeBasis}
- 允许知识模块：${gradeScope.allowedTopics.join('；')}
- 禁止知识模块：${gradeScope.forbiddenTopics.join('；')}
- 复核规则：${gradeScope.validationRules.join('；')}

要求：
1. 先识别题目，再做分析。
2. knowledgePoints 必须覆盖当前年级内、与本题相关的所有知识点，既包含题干显性知识点，也包含解题所依赖的隐含知识点。
3. 不能出现任何高中知识、竞赛专题或高年级专题。
4. 如果题目图片信息有缺失，problemSummary 中要体现“按保守识别处理”。
5. solutionApproach 要写成教师可直接给学生讲的步骤，不要只写答案。
6. teacherExplanation.lectureFlow 强调课堂讲解顺序。
7. teacherExplanation.teachingSuggestions 强调教师讲解建议、板书顺序、追问设计和分层提示。
8. commonMistakes 要具体到学生可能错在哪一步、为什么会错。
9. 全部输出使用中文。
10. 不要遗漏与该题有关的同年级知识点，即使它不是最终列式的第一步，也应在 knowledgePoints 中体现。
11. 最终结果必须是严格的 JSON（json）对象，只输出结构化结果本身，不要附加解释文字或 markdown。
`,
            },
            buildImagePart(request),
          ],
        },
      ],
    );

    return {
      request,
      gradeScope,
      draftAnalysis: response.object,
    };
  },
});

const validateLessonPrep = createStep({
  id: 'validate-lesson-prep',
  description: '复核草稿分析，确保知识点不超纲并输出最终备课结果',
  inputSchema: draftAnalysisSchema,
  outputSchema: lessonPrepResultSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('lessonPrepAgent');
    if (!agent) {
      throw new Error('Lesson prep agent not found');
    }

    const { request, gradeScope, draftAnalysis } = inputData;
    const response = await agent.generate(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
你现在是备课分析复核员，请对下面的草稿做“只保留不超纲内容”的终审。

输入信息：
- 年级：${request.grade}
- 题型：${request.problemType}
- 范围依据：${gradeScope.scopeBasis}
- 允许知识模块：${gradeScope.allowedTopics.join('；')}
- 禁止知识模块：${gradeScope.forbiddenTopics.join('；')}
- 复核规则：${gradeScope.validationRules.join('；')}

草稿分析：
${JSON.stringify(draftAnalysis, null, 2)}

复核要求：
1. 任何可能超纲的知识点都必须删除或改写为当前年级可讲的表述。
2. knowledgePoints 中每一项都必须能被教师直接用于 ${request.grade} 课堂，不得模糊。
3. 如果草稿遗漏了当前年级内与本题有关的显性或隐含知识点，必须补全。
4. 若草稿中的思路依赖超纲方法，必须重写 solutionApproach 与 teacherExplanation。
5. 保留对教师最有用的信息密度，避免空话。
6. 输出结果中的 scopeBasis 使用当前输入给出的范围依据。
7. 全部输出使用中文。
8. 最终结果必须是严格的 JSON（json）对象，只输出结构化结果本身，不要附加解释文字或 markdown。
`,
            },
          ],
        },
      ],
    );

    return {
      ...response.object,
      grade: request.grade,
      problemType: request.problemType,
      scopeBasis: gradeScope.scopeBasis,
    };
  },
});

const lessonPrepWorkflow = createWorkflow({
  id: 'lesson-prep-workflow',
  inputSchema: lessonPrepInputSchema,
  outputSchema: lessonPrepResultSchema,
})
  .then(prepareGradeScope)
  .then(analyzeLessonPrep)
  // .then(validateLessonPrep)
  ;

lessonPrepWorkflow.commit();

export { lessonPrepWorkflow };
