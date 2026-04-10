import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DASHSCOPE_API_KEY ??= 'test-key';
process.env.DASHSCOPE_BASE_URL = 'http://0.0.0.0.invalid';

const vaultPath = mkdtempSync(path.join(os.tmpdir(), 'short-story-workflow-'));
process.env.OBSIDIAN_VAULT_PATH = vaultPath;

const main = async () => {
  const { shortStoryWorkflow } = await import('../src/mastra/workflows/short-story-workflow');
  const { storyEditorAgent } = await import('../src/mastra/agents/story-editor-agent');
  const { launchStoryWorkflowTool } = await import('../src/mastra/tools/launch-story-workflow-tool');
  const { getStoryWorkflowRunTool } = await import('../src/mastra/tools/get-story-workflow-run-tool');

  type SuccessResult = Awaited<ReturnType<Awaited<ReturnType<typeof shortStoryWorkflow.createRun>>['start']>> & {
    status: 'success';
  };

  const getSortedFileNames = (files: Array<{ path: string }>) =>
    files
      .map(file => path.posix.basename(file.path))
      .sort((left, right) => left.localeCompare(right));

  const runWorkflow = async (inputData: Record<string, unknown>): Promise<SuccessResult> => {
    const run = await shortStoryWorkflow.createRun();
    const result = await run.start({ inputData });

    assert.equal(
      result.status,
      'success',
      `workflow 运行失败：${JSON.stringify(result, null, 2)}`,
    );

    return result as SuccessResult;
  };

  const originalEditorGenerate = storyEditorAgent.generate.bind(storyEditorAgent);
  Object.assign(storyEditorAgent, {
    generate: async (prompt: string) => {
      const draftMarker = 'draft：\n';
      const draftIndex = prompt.lastIndexOf(draftMarker);
      const draftMarkdown = draftIndex >= 0 ? prompt.slice(draftIndex + draftMarker.length).trim() : '# Mock Story\n\n正文。';

      return {
        text: [
          '<final_markdown>',
          `${draftMarkdown}\n\n这一版经过编辑润色，句子更紧凑。`,
          '</final_markdown>',
          '<revision_notes>',
          '- 收紧了叙事节奏。',
          '- 保留原有设定，仅做语言与衔接修订。',
          '</revision_notes>',
        ].join('\n'),
      };
    },
  });

  const minimalResult = await runWorkflow({
    projectSlug: 'review-minimal-case',
    language: 'zh-CN',
    premise: '一名失意记者在停电夜追查消失的目击者。',
    genre: '悬疑',
    tone: '冷峻',
    targetWords: 1200,
    exportProfile: 'minimal',
  });

  assert.equal(minimalResult.result.primaryFile, 'Stories/review-minimal-case/story.md');
  assert.deepEqual(getSortedFileNames(minimalResult.result.files), [
    'brief.md',
    'index.md',
    'metadata.md',
    'story.md',
    'summary.md',
  ]);

  const referenceNeedle = '青铜鸟在第三声钟响后才开口。';
  const referencesDir = path.join(vaultPath, 'References');
  mkdirSync(referencesDir, { recursive: true });
  writeFileSync(
    path.join(referencesDir, 'bronze-bird.md'),
    [
      '---',
      'title: 青铜鸟备忘',
      '---',
      '',
      referenceNeedle,
      '它总在雨停之前提醒主角真正的代价。',
      '',
    ].join('\n'),
    'utf8',
  );

  const authoringResult = await runWorkflow({
    projectSlug: 'review-authoring-case',
    language: 'zh-CN',
    premise: '一位钟表匠在废弃天文台里修复一台会倒数命运的旧钟。',
    genre: '奇幻',
    tone: '幽微',
    pov: '第三人称',
    targetWords: 1800,
    endingStyle: '带余韵的代价式结尾',
    mustInclude: ['青铜鸟', '旧钟'],
    referenceNotes: ['References/bronze-bird.md'],
    exportProfile: 'authoring',
  });

  assert.equal(authoringResult.result.primaryFile, 'Stories/review-authoring-case/04-story.md');
  assert.deepEqual(getSortedFileNames(authoringResult.result.files), [
    '00-brief.md',
    '01-outline.md',
    '02-characters.md',
    '03-draft.md',
    '04-story.md',
    '05-summary.md',
    '06-metadata.md',
    '07-revision-log.md',
    'index.md',
  ]);

  const loadReferenceStep = authoringResult.steps['load-reference-notes'];
  assert.equal(loadReferenceStep.status, 'success');
  assert.match(loadReferenceStep.output.referenceContext, /青铜鸟在第三声钟响后才开口/);

  const planStep = authoringResult.steps['plan-story'];
  assert.equal(planStep.status, 'success');
  assert.ok(
    planStep.output.warnings.some((warning: string) => warning.includes('plannerAgent')),
    '未命中 planner fallback 路径',
  );
  assert.ok(planStep.output.outline.beats.length >= 4, 'fallback outline beats 数量不足');
  assert.ok(
    planStep.output.outline.titleCandidates.length >= 3 &&
      planStep.output.outline.titleCandidates.length <= 5,
    'fallback outline titleCandidates 数量不符合预期',
  );

  const storyMarkdown = readFileSync(
    path.join(vaultPath, 'Stories', 'review-authoring-case', '04-story.md'),
    'utf8',
  );
  assert.match(storyMarkdown, /青铜鸟在第三声钟响后才开口/);
  assert.match(storyMarkdown, /这一版经过编辑润色/);

  const revisionLogMarkdown = readFileSync(
    path.join(vaultPath, 'Stories', 'review-authoring-case', '07-revision-log.md'),
    'utf8',
  );
  assert.doesNotMatch(revisionLogMarkdown, /编辑阶段结构化输出失败/);
  assert.match(revisionLogMarkdown, /收紧了叙事节奏/);

  Object.assign(storyEditorAgent, {
    generate: originalEditorGenerate,
  });

  const originalCreateRun = shortStoryWorkflow.createRun.bind(shortStoryWorkflow);
  const originalGetWorkflowRunById = shortStoryWorkflow.getWorkflowRunById.bind(shortStoryWorkflow);
  let capturedResourceId: string | undefined;

  Object.assign(shortStoryWorkflow, {
    createRun: async (options?: { resourceId?: string }) => {
      capturedResourceId = options?.resourceId;
      return {
        startAsync: async () => ({ runId: 'async-run-123' }),
      };
    },
    getWorkflowRunById: async (runId: string) => {
      if (runId === 'async-run-123') {
        return {
          runId,
          workflowName: 'short-story-workflow',
          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'success',
          result: {
            projectDir: 'Stories/async-case',
            title: '异步故事',
            primaryFile: 'Stories/async-case/story.md',
            files: [{ path: 'Stories/async-case/story.md', kind: 'story' }],
            stats: { wordCount: 888 },
            warnings: [],
          },
        };
      }

      return null;
    },
  });

  const launchResult = await launchStoryWorkflowTool.execute!(
    {
      projectSlug: 'async-case',
      language: 'zh-CN',
      premise: '测试异步启动。',
      genre: '科幻',
      tone: '冷静',
      targetWords: 800,
      mustInclude: [],
      mustAvoid: [],
      referenceNotes: [],
      exportProfile: 'minimal',
    },
    {
      agent: {
        agentId: 'story-launcher-agent',
        toolCallId: 'tool-call-1',
        messages: [],
        suspend: async () => {},
        resourceId: 'resource-123',
      },
    } as never,
  );

  assert.deepEqual(launchResult, {
    runId: 'async-run-123',
    status: 'pending',
    projectSlug: 'async-case',
    message: 'shortStoryWorkflow 已转入后台执行，可稍后用 runId async-run-123 查询状态。',
  });
  assert.equal(capturedResourceId, 'resource-123');

  const workflowStatus = await getStoryWorkflowRunTool.execute!({ runId: 'async-run-123' });
  assert.deepEqual(workflowStatus, {
    runId: 'async-run-123',
    found: true,
    status: 'success',
    manifest: {
      projectDir: 'Stories/async-case',
      title: '异步故事',
      primaryFile: 'Stories/async-case/story.md',
      files: [{ path: 'Stories/async-case/story.md', kind: 'story' }],
      stats: { wordCount: 888 },
      warnings: [],
    },
    errorMessage: null,
  });

  const missingWorkflowStatus = await getStoryWorkflowRunTool.execute!({ runId: 'missing-run' });
  assert.deepEqual(missingWorkflowStatus, {
    runId: 'missing-run',
    found: false,
    status: null,
    manifest: null,
    errorMessage: '未找到对应的 shortStoryWorkflow 运行记录。',
  });

  Object.assign(shortStoryWorkflow, {
    createRun: originalCreateRun,
    getWorkflowRunById: originalGetWorkflowRunById,
  });

  console.log(
    JSON.stringify(
      {
        vaultPath,
        cases: [
          {
            name: 'minimal-no-reference',
            primaryFile: minimalResult.result.primaryFile,
            files: getSortedFileNames(minimalResult.result.files),
          },
          {
            name: 'authoring-with-reference',
            primaryFile: authoringResult.result.primaryFile,
            files: getSortedFileNames(authoringResult.result.files),
            fallbackBeatCount: planStep.output.outline.beats.length,
            fallbackTitleCandidateCount: planStep.output.outline.titleCandidates.length,
          },
          {
            name: 'story-launcher-async-tools',
            launchRunId: launchResult?.runId,
            launchStatus: launchResult?.status,
            queryStatus: workflowStatus?.status,
          },
        ],
      },
      null,
      2,
    ),
  );
};

void main();
