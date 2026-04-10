import { createTool } from '@mastra/core/tools';
import {
  launchStoryWorkflowResultSchema,
  storyRequestSchema,
} from '../schemas/short-story-schema';
import { shortStoryWorkflow } from '../workflows/short-story-workflow';

export const launchStoryWorkflowTool = createTool({
  id: 'launch-story-workflow',
  description: '使用完整的故事参数异步启动 shortStoryWorkflow，并立即返回 runId。',
  inputSchema: storyRequestSchema,
  outputSchema: launchStoryWorkflowResultSchema,
  execute: async (inputData, context) => {
    const run = await shortStoryWorkflow.createRun({
      resourceId: context?.agent?.resourceId,
    });
    const { runId } = await run.startAsync({ inputData });

    return {
      runId,
      status: 'pending',
      projectSlug: inputData.projectSlug,
      message: `shortStoryWorkflow 已转入后台执行，可稍后用 runId ${runId} 查询状态。`,
    };
  },
});
