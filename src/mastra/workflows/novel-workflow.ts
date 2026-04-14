import { mkdir } from 'node:fs/promises';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { chapterSummarizerAgent } from '../agents/chapter-summarizer-agent';
import { novelPlannerAgent } from '../agents/novel-planner-agent';
import {
  actPlanSchema,
  bookSummariesSchema,
  buildBookSummariesStepOutputSchema,
  buildIndexStepOutputSchema,
  buildMetadataStepOutputSchema,
  chapterBriefSchema,
  chapterExecutionInputSchema,
  chapterPlanStepOutputSchema,
  chapterResultSchema,
  compiledNovelContextSchema,
  loadedReferenceNoteSchema,
  novelManifestSchema,
  novelRequestSchema,
  novelRuntimeStateSchema,
  novelStateSchema,
  storyBibleSchema,
  normalizedNovelRequestSchema,
  storyBibleStepOutputSchema,
  writeVaultArtifactsResultSchema,
  type ActPlan,
  type ChapterBrief,
  type NovelRequest,
  type NovelState,
} from '../schemas/novel-schema';
import { chapterWorkflow } from './chapter-workflow';
import {
  ensureVaultDirectory,
  formatDate,
  getRelativeVaultPath,
  getVaultPath,
  pathExists,
  readNoteFromVault,
  resolveVaultSubpath,
  type FrontmatterRecord,
  writeNoteToVault,
} from '../tools/obsidian/shared';

const NOVEL_MODELS = {
  planner: 'dashscope/qwen3.6-plus',
  drafter: 'dashscope/qwen3.6-plus',
  editor: 'dashscope/qwen3.6-plus',
  continuity: 'dashscope/qwen3.6-plus',
  summarizer: 'dashscope/qwen3.5-flash',
} as const;

const SUSPEND_RESUME_SCHEMA = z.object({
  continue: z.boolean(),
});

const SUSPEND_PAYLOAD_SCHEMA = z.object({
  checkpoint: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
});

const storyBibleGenerationSchema = z.object({
  title: z.string().min(1),
  storyBible: storyBibleSchema,
  actPlan: actPlanSchema,
  compact: z.string().min(1),
});

const chapterPlanGenerationSchema = z.object({
  chapterPlan: z.array(chapterBriefSchema),
});

const parallelArtifactsSchema = z.object({
  'build-book-summaries': buildBookSummariesStepOutputSchema,
  'build-novel-metadata': buildMetadataStepOutputSchema,
  'build-novel-index': buildIndexStepOutputSchema,
});

const normalizeBriefStep = createStep({
  id: 'normalize-brief',
  description: '清洗输入、规范 slug、预检项目目录',
  inputSchema: novelRequestSchema,
  outputSchema: normalizedNovelRequestSchema,
  execute: async ({ inputData }) => {
    const warnings: string[] = [];
    const normalizedProjectSlug = normalizeProjectSlug(inputData.projectSlug);
    if (normalizedProjectSlug !== inputData.projectSlug) {
      warnings.push(`projectSlug 已规范化为 "${normalizedProjectSlug}"。`);
    }

    const projectDir = `Novels/${normalizedProjectSlug}`;
    const createdAt = new Date().toISOString();

    try {
      const vaultPath = getVaultPath();
      await ensureVaultDirectory(vaultPath);
      const projectPath = resolveVaultSubpath(vaultPath, projectDir);
      if (await pathExists(projectPath)) {
        warnings.push(`项目目录已存在，后续文件可能覆盖既有内容：${projectDir}`);
      }
    } catch (error) {
      warnings.push(`预检查项目目录状态失败：${getErrorMessage(error)}`);
    }

    return {
      request: {
        ...inputData,
        projectSlug: normalizedProjectSlug,
      },
      normalizedProjectSlug,
      projectDir,
      createdAt,
      warnings,
    };
  },
});

const buildStoryBibleStep = createStep({
  id: 'build-story-bible',
  description: '生成 story bible、compact 版本与 act plan',
  inputSchema: normalizedNovelRequestSchema,
  outputSchema: storyBibleStepOutputSchema,
  stateSchema: novelRuntimeStateSchema,
  resumeSchema: SUSPEND_RESUME_SCHEMA,
  suspendSchema: SUSPEND_PAYLOAD_SCHEMA,
  execute: async ({ inputData, state, setState, resumeData, suspend }) => {
    const warnings = [...inputData.warnings];
    const referenceArtifacts = await loadReferenceArtifacts(inputData.request.referenceNotes, warnings);
    const referenceContext = buildReferenceContext(referenceArtifacts);
    const currentState = ensureNovelState(state);

    if (
      inputData.request.suspendAfterBible &&
      resumeData?.continue &&
      currentState.projectSlug === inputData.normalizedProjectSlug &&
      currentState.title &&
      currentState.storyBible.compact &&
      currentState.actPlan.structure
    ) {
      return {
        ...inputData,
        title: currentState.title,
        storyBible: currentState.storyBible,
        actPlan: currentState.actPlan,
        referenceArtifacts,
        referenceContext,
        warnings,
      };
    }

    const fallbackTitle = buildFallbackTitle(inputData.normalizedProjectSlug);
    let title = fallbackTitle;
    let storyBible = buildFallbackStoryBible(inputData.request, fallbackTitle);
    let actPlan = buildFallbackActPlan(inputData.request, fallbackTitle);
    let compact = buildStoryBibleCompact(storyBible, actPlan);

    try {
      const response = await novelPlannerAgent.generate(
        buildStoryBiblePrompt(inputData.request, inputData.normalizedProjectSlug, referenceContext),
        {
          structuredOutput: {
            schema: storyBibleGenerationSchema,
            jsonPromptInjection: true,
          },
        },
      );

      if (response.object) {
        title = response.object.title;
        storyBible = response.object.storyBible;
        actPlan = response.object.actPlan;
        compact = response.object.compact;
      } else {
        warnings.push('novelPlannerAgent 未返回 story bible 结构化结果，已使用兜底版本。');
      }
    } catch (error) {
      warnings.push(`novelPlannerAgent 生成 story bible 失败，已使用兜底版本：${getErrorMessage(error)}`);
    }

    await setState(createInitialNovelState(inputData.normalizedProjectSlug, title, storyBible, actPlan, compact));

    if (inputData.request.suspendAfterBible && !resumeData?.continue) {
      return suspend({
        checkpoint: 'story-bible',
        title,
        message: `story bible 已生成，请确认后继续章节规划：${title}`,
      });
    }

    return {
      ...inputData,
      title,
      storyBible: {
        full: storyBible,
        compact,
      },
      actPlan,
      referenceArtifacts,
      referenceContext,
      warnings,
    };
  },
});

const buildChapterPlanStep = createStep({
  id: 'build-chapter-plan',
  description: '基于 story bible 与目标字数生成章节规划',
  inputSchema: storyBibleStepOutputSchema,
  outputSchema: chapterPlanStepOutputSchema,
  stateSchema: novelRuntimeStateSchema,
  resumeSchema: SUSPEND_RESUME_SCHEMA,
  suspendSchema: SUSPEND_PAYLOAD_SCHEMA,
  execute: async ({ inputData, state, setState, resumeData, suspend }) => {
    const warnings = [...inputData.warnings];
    const currentState = ensureNovelState(state);

    if (
      inputData.request.suspendAfterChapterPlan &&
      resumeData?.continue &&
      currentState.projectSlug === inputData.normalizedProjectSlug &&
      currentState.chapterPlan.length > 0
    ) {
      return {
        ...inputData,
        chapterPlan: currentState.chapterPlan,
        warnings,
      };
    }

    let chapterPlan = buildFallbackChapterPlan(inputData.request, inputData.title, inputData.storyBible.full, inputData.actPlan);

    try {
      const response = await novelPlannerAgent.generate(buildChapterPlanPrompt(inputData), {
        structuredOutput: {
          schema: chapterPlanGenerationSchema,
          jsonPromptInjection: true,
        },
      });

      if (response.object?.chapterPlan?.length) {
        chapterPlan = rebalanceChapterPlan(response.object.chapterPlan, inputData.request.targetWords);
      } else {
        warnings.push('novelPlannerAgent 未返回章节规划，已使用兜底章节计划。');
      }
    } catch (error) {
      warnings.push(`novelPlannerAgent 生成章节规划失败，已使用兜底章节计划：${getErrorMessage(error)}`);
    }

    await setState({
      ...createInitialNovelState(
        inputData.normalizedProjectSlug,
        inputData.title,
        inputData.storyBible.full,
        inputData.actPlan,
        inputData.storyBible.compact,
      ),
      chapterPlan,
    });

    if (inputData.request.suspendAfterChapterPlan && !resumeData?.continue) {
      return suspend({
        checkpoint: 'chapter-plan',
        title: inputData.title,
        message: `章节规划已生成，共 ${chapterPlan.length} 章，请确认后继续执行。`,
      });
    }

    return {
      ...inputData,
      chapterPlan,
      warnings,
    };
  },
});

const buildChapterQueueStep = createStep({
  id: 'build-chapter-queue',
  description: '将 chapter plan 转成 foreach 可消费的执行队列',
  inputSchema: chapterPlanStepOutputSchema,
  outputSchema: z.array(chapterExecutionInputSchema),
  execute: async ({ inputData }) =>
    inputData.chapterPlan.map(brief => ({
      brief,
      title: inputData.title,
      projectDir: inputData.projectDir,
      chapterCount: inputData.chapterPlan.length,
      request: inputData.request,
    })),
});

const compileManuscriptStep = createStep({
  id: 'compile-manuscript',
  description: '汇总章节结果，拼接手稿与修订日志',
  inputSchema: z.array(chapterResultSchema),
  outputSchema: compiledNovelContextSchema,
  execute: async ({ inputData, getStepResult }) => {
    const normalized = getStepResult('normalize-brief') as z.infer<typeof normalizedNovelRequestSchema>;
    const planned = getStepResult('build-chapter-plan') as z.infer<typeof chapterPlanStepOutputSchema>;
    const chapterWarnings = inputData.flatMap(item => item.warnings);
    const warnings = uniqueStrings([...normalized.warnings, ...chapterWarnings]);

    const manuscriptMarkdown = [
      `# ${planned.title}`,
      '',
      ...inputData.flatMap(item => [item.finalMarkdown, '']),
    ]
      .join('\n')
      .trim();

    const revisionLogMarkdown = [
      '# Revision Log',
      '',
      ...inputData.map(item =>
        [
          `## 第 ${item.chapterNumber} 章 ${item.title}`,
          '',
          item.revisionNotes,
          '',
          item.continuityReport
            ? `- Continuity：${item.continuityReport.findings.length > 0 ? item.continuityReport.summary : '未发现实质性冲突'}`
            : '- Continuity：本章未触发检查',
        ].join('\n'),
      ),
    ].join('\n\n');

    return {
      request: normalized.request,
      normalizedProjectSlug: normalized.normalizedProjectSlug,
      projectDir: normalized.projectDir,
      createdAt: normalized.createdAt,
      title: planned.title,
      chapterResults: inputData,
      manuscriptMarkdown,
      revisionLogMarkdown,
      warnings,
    };
  },
});

const buildBookSummariesStep = createStep({
  id: 'build-book-summaries',
  description: '为整本书生成无剧透和全剧透摘要',
  inputSchema: compiledNovelContextSchema,
  outputSchema: buildBookSummariesStepOutputSchema,
  execute: async ({ inputData }) => {
    let summaries = buildFallbackBookSummaries(inputData);

    try {
      const response = await chapterSummarizerAgent.generate(buildBookSummaryPrompt(inputData), {
        structuredOutput: {
          schema: bookSummariesSchema,
          jsonPromptInjection: true,
        },
      });

      if (response.object) {
        summaries = response.object;
      }
    } catch {
      // Fallback is acceptable here; warnings are surfaced on the compiled context.
    }

    return { summaries };
  },
});

const buildMetadataStep = createStep({
  id: 'build-novel-metadata',
  description: '纯代码组装全书 metadata',
  inputSchema: compiledNovelContextSchema,
  outputSchema: buildMetadataStepOutputSchema,
  execute: async ({ inputData }) => ({
    metadata: {
      title: inputData.title,
      projectDir: inputData.projectDir,
      primaryFile: `${inputData.projectDir}/manuscript.md`,
      createdAt: inputData.createdAt,
      updatedAt: new Date().toISOString(),
      status: 'draft',
      language: inputData.request.language,
      genre: inputData.request.genre,
      tone: inputData.request.tone,
      pov: inputData.request.pov ?? null,
      targetWords: inputData.request.targetWords,
      actualWords: countWords(inputData.manuscriptMarkdown),
      chapterCount: inputData.chapterResults.length,
      endingStyle: inputData.request.endingStyle ?? null,
      modelPlan: NOVEL_MODELS.planner,
      modelDraft: NOVEL_MODELS.drafter,
      modelEdit: NOVEL_MODELS.editor,
      modelContinuity: NOVEL_MODELS.continuity,
      modelSummary: NOVEL_MODELS.summarizer,
      tags: uniqueStrings([
        'novel',
        inputData.request.genre,
        inputData.request.tone,
        inputData.request.language === 'zh-CN' ? '中文创作' : 'English fiction',
      ]),
    },
  }),
});

const buildIndexStep = createStep({
  id: 'build-novel-index',
  description: '生成项目 index.md 内容',
  inputSchema: compiledNovelContextSchema,
  outputSchema: buildIndexStepOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const planned = getStepResult('build-chapter-plan') as z.infer<typeof chapterPlanStepOutputSchema>;
    const summaries = buildFallbackBookSummaries(inputData);

    return {
      indexMarkdown: [
        `# ${inputData.title}`,
        '',
        `- 状态：draft`,
        `- 目录：${inputData.projectDir}`,
        `- 章节数：${inputData.chapterResults.length}`,
        `- 主文件：[[manuscript.md]]`,
        '',
        '## Hook',
        '',
        summaries.hook,
        '',
        '## 章节目录',
        '',
        ...planned.chapterPlan.map(
          brief =>
            `- 第 ${brief.chapterNumber} 章 [[chapters/${formatChapterNumber(brief.chapterNumber)}-final|${brief.title}]]`,
        ),
      ].join('\n'),
    };
  },
});

const writeVaultArtifactsStep = createStep({
  id: 'write-vault-artifacts',
  description: '写入全书级 Obsidian 文件并汇总 file manifest',
  inputSchema: parallelArtifactsSchema,
  outputSchema: writeVaultArtifactsResultSchema,
  stateSchema: novelRuntimeStateSchema,
  execute: async ({ inputData, getStepResult, state }) => {
    const currentState = ensureNovelState(state);
    const compiled = getStepResult('compile-manuscript') as z.infer<typeof compiledNovelContextSchema>;
    const storyBibleResult = getStepResult('build-story-bible') as z.infer<typeof storyBibleStepOutputSchema>;
    const metadata = inputData['build-novel-metadata'].metadata;
    const summaries = inputData['build-book-summaries'].summaries;
    const indexMarkdown = inputData['build-novel-index'].indexMarkdown;
    const warnings = [...compiled.warnings];
    const files = [...currentState.fileManifest];

    const noteSpecs = [
      {
        relativePath: `${metadata.projectDir}/index.md`,
        kind: 'index',
        content: indexMarkdown,
      },
      {
        relativePath: `${metadata.projectDir}/story-bible.md`,
        kind: 'story-bible',
        content: buildStoryBibleMarkdown(storyBibleResult.title, storyBibleResult.storyBible.full, storyBibleResult.storyBible.compact),
      },
      {
        relativePath: `${metadata.projectDir}/act-outline.md`,
        kind: 'act-outline',
        content: buildActOutlineMarkdown(storyBibleResult.actPlan),
      },
      {
        relativePath: `${metadata.projectDir}/continuity.md`,
        kind: 'continuity',
        content: buildContinuityMarkdown(currentState),
      },
      {
        relativePath: `${metadata.projectDir}/timeline.md`,
        kind: 'timeline',
        content: buildTimelineMarkdown(currentState),
      },
      {
        relativePath: `${metadata.projectDir}/metadata.md`,
        kind: 'metadata',
        content: buildMetadataMarkdown(metadata),
      },
      {
        relativePath: `${metadata.projectDir}/manuscript.md`,
        kind: 'manuscript',
        content: compiled.manuscriptMarkdown,
      },
      {
        relativePath: `${metadata.projectDir}/revision-log.md`,
        kind: 'revision-log',
        content: compiled.revisionLogMarkdown,
      },
      {
        relativePath: `${metadata.projectDir}/summaries/chapter-summaries.md`,
        kind: 'chapter-summaries',
        content: buildChapterSummariesMarkdown(compiled.chapterResults),
      },
      {
        relativePath: `${metadata.projectDir}/summaries/book-summary-short.md`,
        kind: 'book-summary-short',
        content: `# Book Summary Short\n\n${summaries.spoilerFreeSummary}`,
      },
      {
        relativePath: `${metadata.projectDir}/summaries/book-summary-full.md`,
        kind: 'book-summary-full',
        content: `# Book Summary Full\n\n${summaries.fullSummary}`,
      },
    ];

    try {
      const vaultPath = getVaultPath();
      await ensureVaultDirectory(vaultPath);
      await mkdir(resolveVaultSubpath(vaultPath, metadata.projectDir), { recursive: true });

      for (const note of noteSpecs) {
        const absolutePath = resolveVaultSubpath(vaultPath, note.relativePath);
        await writeNoteToVault(absolutePath, buildNoteFrontmatter(metadata, note.kind), note.content);
        files.push({
          path: getRelativeVaultPath(vaultPath, absolutePath),
          kind: note.kind,
        });
      }
    } catch (error) {
      warnings.push(`全书级文件写入失败：${getErrorMessage(error)}`);
      files.push(
        ...noteSpecs.map(note => ({
          path: note.relativePath,
          kind: note.kind,
        })),
      );
    }

    return {
      projectDir: metadata.projectDir,
      title: metadata.title,
      primaryFile: metadata.primaryFile,
      files: dedupeManifestFiles(files),
      wordCount: metadata.actualWords,
      warnings: uniqueStrings(warnings),
    };
  },
});

const buildManifestStep = createStep({
  id: 'build-manifest',
  description: '汇总最终输出 manifest',
  inputSchema: writeVaultArtifactsResultSchema,
  outputSchema: novelManifestSchema,
  execute: async ({ inputData, getStepResult }) => {
    const compiled = getStepResult('compile-manuscript') as z.infer<typeof compiledNovelContextSchema>;
    return {
      projectDir: inputData.projectDir,
      title: inputData.title,
      primaryFile: inputData.primaryFile,
      files: inputData.files,
      stats: {
        wordCount: inputData.wordCount,
        chapterCount: compiled.chapterResults.length,
      },
      warnings: inputData.warnings,
    };
  },
});

export const novelWorkflow = createWorkflow({
  id: 'novel-workflow',
  inputSchema: novelRequestSchema,
  outputSchema: novelManifestSchema,
  stateSchema: novelRuntimeStateSchema,
  options: {
    validateInputs: true,
  },
})
  .then(normalizeBriefStep)
  .then(buildStoryBibleStep)
  .then(buildChapterPlanStep)
  .then(buildChapterQueueStep)
  .foreach(chapterWorkflow, { concurrency: 1 })
  .then(compileManuscriptStep)
  .parallel([buildBookSummariesStep, buildMetadataStep, buildIndexStep])
  .then(writeVaultArtifactsStep)
  .then(buildManifestStep)
  .commit();

async function loadReferenceArtifacts(referenceNotes: string[], warnings: string[]) {
  if (referenceNotes.length === 0) {
    return [];
  }

  try {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);
    const artifacts: Array<z.infer<typeof loadedReferenceNoteSchema>> = [];

    for (const relativePath of referenceNotes) {
      try {
        const note = await readNoteFromVault(vaultPath, relativePath);
        artifacts.push({
          path: relativePath,
          title: getTitleFromRelativePath(relativePath),
          excerpt: note.content.trim().slice(0, 180) || '(空内容)',
          content: note.content.trim() || note.rawContent.trim() || '(空内容)',
        });
      } catch (error) {
        warnings.push(`参考笔记读取失败，已跳过 ${relativePath}：${getErrorMessage(error)}`);
      }
    }

    return artifacts;
  } catch (error) {
    warnings.push(`参考笔记预加载失败：${getErrorMessage(error)}`);
    return [];
  }
}

function buildReferenceContext(referenceArtifacts: Array<z.infer<typeof loadedReferenceNoteSchema>>): string {
  return referenceArtifacts
    .map(
      artifact =>
        [
          `## ${artifact.title}`,
          `- 路径：${artifact.path}`,
          `- 摘要：${artifact.excerpt}`,
          '',
          artifact.content,
        ].join('\n'),
    )
    .join('\n\n');
}

function buildStoryBiblePrompt(request: NovelRequest, normalizedProjectSlug: string, referenceContext: string): string {
  return [
    '请根据下面的中篇小说 brief 生成 story bible、compact 版本与三幕 act plan。',
    '',
    '约束：',
    `- language: ${request.language}`,
    `- projectSlug: ${normalizedProjectSlug}`,
    `- premise: ${request.premise}`,
    `- genre: ${request.genre}`,
    `- tone: ${request.tone}`,
    `- pov: ${request.pov ?? '未指定，请给出最稳定的推荐视角'}`,
    `- targetWords: ${request.targetWords}`,
    `- endingStyle: ${request.endingStyle ?? '未指定，但要与主题一致'}`,
    `- mustInclude: ${request.mustInclude.join('；') || '无'}`,
    `- mustAvoid: ${request.mustAvoid.join('；') || '无'}`,
    '',
    '输出要求：',
    '- storyBible.title 是全书正式标题。',
    '- storyBible 用于长篇连续创作，必须覆盖人物、规则、主题、冲突与结局设计。',
    '- compact 版本控制在 500 token 内，可直接注入每章 prompt。',
    '- actPlan 采用三幕或等价结构，必须能支撑后续章节规划。',
    '',
    referenceContext ? `参考笔记：\n${referenceContext}` : '参考笔记：无',
  ].join('\n');
}

function buildChapterPlanPrompt(input: z.infer<typeof storyBibleStepOutputSchema>): string {
  return [
    '请基于以下 story bible 与目标字数生成中篇章节规划。',
    '',
    '输出要求：',
    '- chapterPlan 必须覆盖完整中篇，不少于 6 章。',
    '- chapterNumber 连续递增。',
    '- dependencyMode 为 sequential 时，mustReadChapters 必须只引用更早章节。',
    '- keyEvents 要足够具体，便于后续写作与 continuity 检查。',
    '- targetWordCount 应尽量平衡，但关键转折章节可以略高。',
    '',
    `标题：${input.title}`,
    `目标总字数：${input.request.targetWords}`,
    `结局风格：${input.request.endingStyle ?? '未指定'}`,
    '',
    `story bible full：\n${JSON.stringify(input.storyBible.full, null, 2)}`,
    '',
    `act plan：\n${JSON.stringify(input.actPlan, null, 2)}`,
  ].join('\n');
}

function buildBookSummaryPrompt(input: z.infer<typeof compiledNovelContextSchema>): string {
  return [
    '请为下面的中篇小说生成整本书的无剧透摘要、全剧透摘要、hook 和 tags。',
    '',
    '要求：',
    '- spoilerFreeSummary 用于索引页简介，不能泄露关键底牌。',
    '- fullSummary 要完整覆盖剧情推进和结尾。',
    '- hook 用 1 到 2 句概括作品卖点。',
    '- tags 保持简洁，4 到 8 个。',
    '',
    `标题：${input.title}`,
    `题材：${input.request.genre}`,
    `语气：${input.request.tone}`,
    '',
    input.manuscriptMarkdown,
  ].join('\n');
}

function buildFallbackTitle(normalizedProjectSlug: string): string {
  return (
    normalizedProjectSlug
      .split(/[-_]+/)
      .map(segment => segment.trim())
      .filter(Boolean)
      .join(' ')
      .trim() || '未命名中篇'
  );
}

function buildFallbackStoryBible(request: NovelRequest, title: string) {
  return {
    title,
    logline: request.premise,
    theme: `${request.genre} 与 ${request.tone} 的命运抉择`,
    premiseFocus: request.premise,
    world: `围绕 ${request.genre} 展开的中篇舞台，强调 ${request.tone} 质感。`,
    setting: '主场景由主角目标最相关的地点构成，并允许随着剧情升级扩展。',
    characters: [],
    narrativeRules: [
      {
        label: '因果闭合',
        detail: '每章行动都要推动人物关系或核心矛盾向前发展。',
      },
    ],
    styleGuide: [
      `整体语气保持 ${request.tone}`,
      '章节结尾保留推进张力，避免机械 cliffhanger。',
    ],
    chapterStyleRules: ['每章都有独立推进价值，但必须服务全书长线。'],
    majorConflicts: [request.premise],
    motifs: request.mustInclude.length > 0 ? request.mustInclude : ['代价', '选择'],
    endingDesign: request.endingStyle
      ? `结尾呈现 ${request.endingStyle} 的完成态，并回应前文伏笔。`
      : '结尾回应前文伏笔，完成主题闭环。',
  };
}

function buildFallbackActPlan(request: NovelRequest, title: string): ActPlan {
  return {
    structure: `${title} 的三幕结构`,
    acts: [
      {
        name: '第一幕',
        objective: `建立主角处境并引出 ${request.premise}`,
        turningPoints: [
          { order: 1, summary: '主角被迫进入主冲突，原有平衡被打破。 ' },
        ],
      },
      {
        name: '第二幕',
        objective: '升级代价与误判，推动人物关系重组',
        turningPoints: [
          { order: 1, summary: '中点揭示关键信息，人物目标产生偏移。' },
          { order: 2, summary: '低谷阶段暴露主角必须付出的真正代价。' },
        ],
      },
      {
        name: '第三幕',
        objective: '完成核心抉择并回收长线伏笔',
        turningPoints: [
          { order: 1, summary: '终局对抗迫使主角在代价与欲望之间作出选择。' },
        ],
      },
    ],
  };
}

function buildStoryBibleCompact(
  storyBible: z.infer<typeof storyBibleSchema>,
  actPlan: ActPlan,
): string {
  return [
    `标题：${storyBible.title}`,
    `主题：${storyBible.theme}`,
    `设定：${storyBible.setting}`,
    `世界规则：${storyBible.narrativeRules.map(rule => `${rule.label}=${rule.detail}`).join('；') || '无'}`,
    `主要冲突：${storyBible.majorConflicts.join('；') || storyBible.logline}`,
    `风格：${storyBible.styleGuide.join('；') || '保持叙事稳定'}`,
    `结局设计：${storyBible.endingDesign}`,
    `三幕摘要：${actPlan.acts.map(act => `${act.name}:${act.objective}`).join(' / ')}`,
  ].join('\n');
}

function buildFallbackChapterPlan(
  request: NovelRequest,
  title: string,
  storyBible: z.infer<typeof storyBibleSchema>,
  actPlan: ActPlan,
): ChapterBrief[] {
  const chapterCount = Math.max(6, Math.round(request.targetWords / 1800));
  const targetWordCount = Math.max(1800, Math.round(request.targetWords / chapterCount));

  return Array.from({ length: chapterCount }, (_, index) => {
    const chapterNumber = index + 1;
    const act =
      chapterNumber <= Math.ceil(chapterCount / 3)
        ? actPlan.acts[0]
        : chapterNumber <= Math.ceil((chapterCount * 2) / 3)
          ? actPlan.acts[1]
          : actPlan.acts[2];

    return {
      chapterNumber,
      title: `${title}·第${chapterNumber}章`,
      synopsis: `${act?.objective ?? storyBible.theme} 在第 ${chapterNumber} 章得到一次新的推进。`,
      dependencyMode: chapterNumber === 1 ? 'standalone' : 'sequential',
      mustReadChapters: chapterNumber === 1 ? [] : [chapterNumber - 1],
      keyEvents: [`推进 ${act?.objective ?? storyBible.theme}`, '角色关系或局势出现新的变化'],
      openLoopsToResolve: chapterNumber === chapterCount ? ['回收核心伏笔'] : [],
      openLoopsToIntroduce: chapterNumber < chapterCount ? [`第 ${chapterNumber} 章新增悬念`] : [],
      targetWordCount,
    };
  });
}

function rebalanceChapterPlan(chapterPlan: ChapterBrief[], targetWords: number): ChapterBrief[] {
  const totalChapters = chapterPlan.length;
  const base = Math.max(1200, Math.round(targetWords / totalChapters));

  return chapterPlan.map((brief, index) => ({
    ...brief,
    chapterNumber: index + 1,
    mustReadChapters: uniquePositiveInts(brief.mustReadChapters).filter(value => value < index + 1),
    targetWordCount: brief.targetWordCount ?? base,
  }));
}

function buildFallbackBookSummaries(input: z.infer<typeof compiledNovelContextSchema>) {
  return {
    spoilerFreeSummary: input.chapterResults.map(item => item.summary.spoilerFreeSummary).join('\n\n'),
    fullSummary: input.chapterResults.map(item => `第 ${item.chapterNumber} 章：${item.summary.summary}`).join('\n\n'),
    hook: `${input.title} 以 ${input.request.genre} 的框架推进一条关于 ${input.request.premise} 的中篇叙事。`,
    tags: uniqueStrings(['novel', input.request.genre, input.request.tone]),
  };
}

function createInitialNovelState(
  projectSlug: string,
  title: string,
  storyBible: z.infer<typeof storyBibleSchema>,
  actPlan: ActPlan,
  compact: string,
): NovelState {
  return {
    projectSlug,
    title,
    storyBible: {
      full: storyBible,
      compact,
    },
    actPlan,
    chapterPlan: [],
    currentChapter: 0,
    chapterSummaries: {
      recent: [],
      compressed: '',
      milestones: [],
    },
    openLoops: [],
    continuityNotes: [],
    timeline: [],
    fileManifest: [],
  };
}

function ensureNovelState(value: unknown): NovelState {
  const parsed = novelStateSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return createInitialNovelState(
    '',
    '',
    buildFallbackStoryBible(
      {
        projectSlug: '',
        language: 'zh-CN',
        premise: '',
        genre: '',
        tone: '',
        targetWords: 30000,
        mustInclude: [],
        mustAvoid: [],
        referenceNotes: [],
        suspendAfterBible: false,
        suspendAfterChapterPlan: false,
      },
      '',
    ),
    {
      structure: '',
      acts: [],
    },
    '',
  );
}

function buildStoryBibleMarkdown(
  title: string,
  storyBible: z.infer<typeof storyBibleSchema>,
  compact: string,
): string {
  return [
    `# ${title} Story Bible`,
    '',
    '## Logline',
    '',
    storyBible.logline,
    '',
    '## Theme',
    '',
    storyBible.theme,
    '',
    '## World',
    '',
    storyBible.world,
    '',
    '## Setting',
    '',
    storyBible.setting,
    '',
    '## Characters',
    '',
    ...storyBible.characters.map(
      character =>
        [
          `### ${character.name}`,
          `- 角色：${character.role}`,
          `- 角色弧光：${character.arc}`,
          `- 欲望：${character.desire}`,
          `- 恐惧：${character.fear ?? '未特别标注'}`,
          `- 关系：${character.relationships.join('；') || '无'}`,
        ].join('\n'),
    ),
    '',
    '## Narrative Rules',
    '',
    ...storyBible.narrativeRules.map(rule => `- ${rule.label}：${rule.detail}`),
    '',
    '## Style Guide',
    '',
    ...storyBible.styleGuide.map(rule => `- ${rule}`),
    '',
    '## Compact',
    '',
    compact,
  ].join('\n');
}

function buildActOutlineMarkdown(actPlan: ActPlan): string {
  return [
    '# Act Outline',
    '',
    `- 结构：${actPlan.structure}`,
    '',
    ...actPlan.acts.map(act =>
      [
        `## ${act.name}`,
        '',
        act.objective,
        '',
        ...act.turningPoints.map(point => `- ${point.order}. ${point.summary}`),
      ].join('\n'),
    ),
  ].join('\n\n');
}

function buildContinuityMarkdown(state: NovelState): string {
  return [
    '# Continuity Notes',
    '',
    state.continuityNotes.length > 0
      ? state.continuityNotes.map(note => `- ${note}`).join('\n')
      : '暂无连续性警告。',
  ].join('\n');
}

function buildTimelineMarkdown(state: NovelState): string {
  return [
    '# Timeline',
    '',
    ...state.timeline.map(
      item =>
        `- 第 ${item.chapterNumber} 章 / ${item.timeMarker} / ${item.location} / ${item.participants.join('、') || '未注明'}：${item.event}`,
    ),
  ].join('\n');
}

function buildMetadataMarkdown(metadata: z.infer<typeof buildMetadataStepOutputSchema>['metadata']): string {
  return [
    '# Metadata',
    '',
    '```json',
    JSON.stringify(metadata, null, 2),
    '```',
  ].join('\n');
}

function buildChapterSummariesMarkdown(chapterResults: z.infer<typeof chapterResultSchema>[]): string {
  return [
    '# Chapter Summaries',
    '',
    ...chapterResults.map(result =>
      [
        `## 第 ${result.chapterNumber} 章 ${result.title}`,
        '',
        result.summary.summary,
        '',
        `- 无剧透：${result.summary.spoilerFreeSummary}`,
        `- 关键事件：${result.summary.keyEvents.join('；') || '无'}`,
      ].join('\n'),
    ),
  ].join('\n\n');
}

function buildNoteFrontmatter(
  metadata: z.infer<typeof buildMetadataStepOutputSchema>['metadata'],
  kind: string,
): FrontmatterRecord {
  return {
    title: metadata.title,
    type: 'novel-project',
    noteKind: kind,
    status: metadata.status,
    created: formatDate(new Date(metadata.createdAt)),
    updated: metadata.updatedAt,
    tags: metadata.tags,
  };
}

function dedupeManifestFiles(files: NovelState['fileManifest']) {
  return Array.from(new Map(files.map(file => [file.path, file])).values());
}

function normalizeProjectSlug(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `novel-${formatDate(new Date())}`;
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(2, '0');
}

function getTitleFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  const fileName = segments[segments.length - 1] ?? relativePath;
  return fileName.replace(/\.md$/i, '');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function uniquePositiveInts(values: number[]): number[] {
  return Array.from(new Set(values.filter(value => Number.isInteger(value) && value > 0))).sort((a, b) => a - b);
}

function countWords(markdown: string): number {
  const plainText = markdown.replace(/^---[\s\S]*?---\n*/u, '').replace(/[#>*_`\-\[\]\(\)!]/g, ' ');
  const chineseChars = plainText.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = plainText
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;

  return chineseChars + latinWords;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
