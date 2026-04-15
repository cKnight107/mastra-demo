import { createTool } from '@mastra/core/tools';
import {
  launchNovelWorkflowResultSchema,
  novelRequestSchema,
} from '../schemas/novel-schema';
import { novelWorkflow } from '../workflows/novel-workflow';

export const launchNovelWorkflowTool = createTool({
  id: 'launch-novel-workflow',
  description: '使用完整的中篇小说参数异步启动 novelWorkflow，并立即返回 runId。',
  inputSchema: novelRequestSchema,
  outputSchema: launchNovelWorkflowResultSchema,
  execute: async (inputData, context) => {
    const run = await novelWorkflow.createRun({
      resourceId: context?.agent?.resourceId,
    });
    const { runId } = await run.startAsync({ inputData });

    return {
      runId,
      status: 'pending',
      projectSlug: inputData.projectSlug,
      message: `novelWorkflow 已转入后台执行，可稍后用 runId ${runId} 查询状态。`,
    };
  },
});
