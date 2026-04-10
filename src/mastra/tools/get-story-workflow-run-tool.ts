import { createTool } from '@mastra/core/tools';
import {
  artifactManifestSchema,
  storyWorkflowRunLookupSchema,
  storyWorkflowRunQueryResultSchema,
} from '../schemas/short-story-schema';
import { shortStoryWorkflow } from '../workflows/short-story-workflow';

export const getStoryWorkflowRunTool = createTool({
  id: 'get-story-workflow-run',
  description: '根据 runId 查询 shortStoryWorkflow 的当前状态，并在完成后返回生成产物清单。',
  inputSchema: storyWorkflowRunLookupSchema,
  outputSchema: storyWorkflowRunQueryResultSchema,
  execute: async ({ runId }) => {
    const workflowRun = await shortStoryWorkflow.getWorkflowRunById(runId, {
      fields: ['result', 'error'],
    });

    if (!workflowRun) {
      return {
        runId,
        found: false,
        status: null,
        manifest: null,
        errorMessage: '未找到对应的 shortStoryWorkflow 运行记录。',
      };
    }

    const manifestResult = artifactManifestSchema.safeParse(workflowRun.result);
    const errorMessage =
      getSerializedErrorMessage(workflowRun.error) ??
      (workflowRun.status === 'success' && !manifestResult.success
        ? 'workflow 已完成，但结果结构不符合 artifact manifest 预期。'
        : null);

    return {
      runId,
      found: true,
      status: workflowRun.status,
      manifest: manifestResult.success ? manifestResult.data : null,
      errorMessage,
    };
  },
});

function getSerializedErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}
