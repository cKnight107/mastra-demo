import { createTool } from '@mastra/core/tools';
import {
  artifactManifestSchema,
  storyRequestSchema,
} from '../schemas/short-story-schema';
import { shortStoryWorkflow } from '../workflows/short-story-workflow';

export const launchStoryWorkflowTool = createTool({
  id: 'launch-story-workflow',
  description: '使用完整的故事参数启动 shortStoryWorkflow，并返回生成产物清单。',
  inputSchema: storyRequestSchema,
  outputSchema: artifactManifestSchema,
  execute: async inputData => {
    const run = await shortStoryWorkflow.createRun();
    const result = await run.start({ inputData });

    if (result.status !== 'success' || !result.result) {
      throw new Error(`shortStoryWorkflow 执行失败，状态: ${result.status}`);
    }

    return result.result;
  },
});
