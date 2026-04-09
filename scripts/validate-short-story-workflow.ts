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
        ],
      },
      null,
      2,
    ),
  );
};

void main();
