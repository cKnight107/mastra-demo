import { createTool } from '@mastra/core/tools';
import {
  novelManifestSchema,
  novelWorkflowRunLookupSchema,
  novelWorkflowRunQueryResultSchema,
} from '../schemas/novel-schema';
import { novelWorkflow } from '../workflows/novel-workflow';

export const getNovelWorkflowRunTool = createTool({
  id: 'get-novel-workflow-run',
  description: '根据 runId 查询 novelWorkflow 的当前状态，并在完成后返回含章节数的产物清单。',
  inputSchema: novelWorkflowRunLookupSchema,
  outputSchema: novelWorkflowRunQueryResultSchema,
  execute: async ({ runId }) => {
    const workflowRun = await novelWorkflow.getWorkflowRunById(runId, {
      fields: ['result', 'error'],
    });

    if (!workflowRun) {
      return {
        runId,
        found: false,
        status: null,
        manifest: null,
        errorMessage: '未找到对应的 novelWorkflow 运行记录。',
      };
    }

    const manifestResult = novelManifestSchema.safeParse(workflowRun.result);
    const errorMessage =
      getSerializedErrorMessage(workflowRun.error) ??
      (workflowRun.status === 'success' && !manifestResult.success
        ? 'workflow 已完成，但结果结构不符合 novel manifest 预期。'
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
