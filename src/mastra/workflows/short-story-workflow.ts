import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  artifactManifestSchema,
  normalizedStoryRequestSchema,
  outlineSchema,
  storyDraftContextSchema,
  storyEditContextSchema,
  storyEditResultSchema,
  storyMetadataStepOutputSchema,
  storyPlanningContextSchema,
  storyReferenceContextSchema,
  storyRequestSchema,
  storySummaryStepOutputSchema,
  vaultWriteResultSchema,
} from '../schemas/short-story-schema';
import { storyDrafterAgent } from '../agents/story-drafter-agent';
import { storyEditorAgent } from '../agents/story-editor-agent';
import { storyPlannerAgent } from '../agents/story-planner-agent';
import { storySummarizerAgent } from '../agents/story-summarizer-agent';
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

const AUTHORING_PROJECT_FILE_NAMES = {
  brief: '00-brief.md',
  outline: '01-outline.md',
  characters: '02-characters.md',
  draft: '03-draft.md',
  story: '04-story.md',
  summary: '05-summary.md',
  metadata: '06-metadata.md',
  revisionLog: '07-revision-log.md',
} as const;

const MINIMAL_PROJECT_FILE_NAMES = {
  ...AUTHORING_PROJECT_FILE_NAMES,
  brief: 'brief.md',
  story: 'story.md',
  summary: 'summary.md',
  metadata: 'metadata.md',
} as const;
const STORY_MODELS = {
  planner: 'dashscope/qwen3.6-plus',
  drafter: 'dashscope/qwen3.6-plus',
  editor: 'dashscope/qwen3.6-plus',
  summarizer: 'dashscope/qwen3.5-flash',
} as const;

const parallelStoryArtifactsSchema = z.object({
  'summarize-story': storySummaryStepOutputSchema,
  'build-story-metadata': storyMetadataStepOutputSchema,
});

const normalizeBriefStep = createStep({
  id: 'normalize-brief',
  description: '清洗输入、规范 projectSlug、补充默认值与预检查 warning',
  inputSchema: storyRequestSchema,
  outputSchema: normalizedStoryRequestSchema,
  execute: async ({ inputData }) => {
    const warnings: string[] = [];
    const normalizedProjectSlug = normalizeProjectSlug(inputData.projectSlug);
    if (normalizedProjectSlug !== inputData.projectSlug) {
      warnings.push(`projectSlug 已规范化为 "${normalizedProjectSlug}"。`);
    }

    const request = {
      ...inputData,
      projectSlug: normalizedProjectSlug,
    };
    const projectDir = `Stories/${normalizedProjectSlug}`;
    const createdAt = new Date().toISOString();

    try {
      const vaultPath = getVaultPath();
      await ensureVaultDirectory(vaultPath);
      const projectDirPath = resolveVaultSubpath(vaultPath, projectDir);
      if (await pathExists(projectDirPath)) {
        warnings.push(`项目目录已存在，后续文件可能覆盖既有内容：${projectDir}`);
      }
    } catch (error) {
      warnings.push(`预检查项目目录状态失败：${getErrorMessage(error)}`);
    }

    return {
      request,
      normalizedProjectSlug,
      projectDir,
      createdAt,
      warnings,
    };
  },
});

const loadReferenceNotesStep = createStep({
  id: 'load-reference-notes',
  description: '读取 Obsidian 参考笔记并拼接为 planner 上下文',
  inputSchema: normalizedStoryRequestSchema,
  outputSchema: storyReferenceContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    if (inputData.request.referenceNotes.length === 0) {
      return {
        ...inputData,
        referenceArtifacts: [],
        referenceContext: '',
      };
    }

    const referenceArtifacts: z.infer<typeof storyReferenceContextSchema>['referenceArtifacts'] = [];

    try {
      const vaultPath = getVaultPath();
      await ensureVaultDirectory(vaultPath);

      for (const relativePath of inputData.request.referenceNotes) {
        try {
          const note = await readNoteFromVault(vaultPath, relativePath);
          const title =
            typeof note.frontmatter.title === 'string' && note.frontmatter.title.trim().length > 0
              ? note.frontmatter.title
              : path.basename(relativePath, '.md');
          const excerpt = note.content.trim().slice(0, 160) || '(空内容)';
          referenceArtifacts.push({
            path: relativePath,
            title,
            excerpt,
            content: note.content.trim() || note.rawContent.trim() || '(空内容)',
          });
        } catch (error) {
          warnings.push(`参考笔记读取失败，已跳过 ${relativePath}：${getErrorMessage(error)}`);
        }
      }
    } catch (error) {
      warnings.push(`参考笔记预加载失败：${getErrorMessage(error)}`);
    }

    const referenceContext = referenceArtifacts
      .map(
        note => [
          `## 参考笔记：${note.title}`,
          `- 路径：${note.path}`,
          `- 摘要：${note.excerpt}`,
          '',
          note.content,
        ].join('\n'),
      )
      .join('\n\n');

    return {
      ...inputData,
      referenceArtifacts,
      referenceContext,
      warnings,
    };
  },
});

const planStep = createStep({
  id: 'plan-story',
  description: '调用 plannerAgent 生成结构化故事大纲',
  inputSchema: storyReferenceContextSchema,
  outputSchema: storyPlanningContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    let outline = buildFallbackOutline(inputData.request, inputData.normalizedProjectSlug);

    try {
      const response = await storyPlannerAgent.generate(buildPlannerPrompt(inputData), {
        structuredOutput: {
          schema: outlineSchema,
          jsonPromptInjection: true,
        },
      });

      if (response.object) {
        outline = response.object;
      } else {
        warnings.push('plannerAgent 未返回结构化大纲，已回退为兜底大纲。');
      }
    } catch (error) {
      warnings.push(`plannerAgent structured output 失败，已回退为兜底大纲：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      outline,
      warnings,
    };
  },
});

const draftStep = createStep({
  id: 'draft-story',
  description: '调用 drafterAgent 根据大纲输出小说初稿',
  inputSchema: storyPlanningContextSchema,
  outputSchema: storyDraftContextSchema,
  execute: async ({ inputData }) => {
    let draftMarkdown = '';

    try {
      const response = await storyDrafterAgent.generate(buildDraftPrompt(inputData));
      draftMarkdown = response.text?.trim() ?? '';
    } catch (error) {
      inputData.warnings.push(`drafterAgent 调用失败，已回退为本地初稿：${getErrorMessage(error)}`);
    }

    if (!draftMarkdown) {
      inputData.warnings.push('drafterAgent 未返回正文，已回退为本地初稿。');
      draftMarkdown = buildFallbackDraft(inputData);
    }

    return {
      ...inputData,
      draftMarkdown,
    };
  },
});

const editStep = createStep({
  id: 'edit-story',
  description: '调用 editorAgent 输出终稿与修订说明',
  inputSchema: storyDraftContextSchema,
  outputSchema: storyEditContextSchema,
  execute: async ({ inputData }) => {
    let editResult: z.infer<typeof storyEditResultSchema> = {
      finalMarkdown: ensureStoryHeading(inputData.outline.title, inputData.draftMarkdown),
      revisionNotes: '编辑阶段结构化输出失败，已直接使用初稿作为终稿。',
    };

    try {
      const response = await storyEditorAgent.generate(buildEditorPrompt(inputData), {
        structuredOutput: {
          schema: storyEditResultSchema,
          jsonPromptInjection: true,
        },
      });

      if (response.object) {
        editResult = {
          finalMarkdown: ensureStoryHeading(inputData.outline.title, response.object.finalMarkdown),
          revisionNotes: response.object.revisionNotes,
        };
      } else {
        inputData.warnings.push('editorAgent 未返回结构化结果，已回退为初稿。');
      }
    } catch (error) {
      inputData.warnings.push(`editorAgent structured output 失败，已回退为初稿：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      editResult,
    };
  },
});

const summaryStep = createStep({
  id: 'summarize-story',
  description: '调用 summarizerAgent 生成 logline、摘要与标签',
  inputSchema: storyEditContextSchema,
  outputSchema: storySummaryStepOutputSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    let summary = buildFallbackSummary(inputData);

    try {
      const response = await storySummarizerAgent.generate(buildSummarizerPrompt(inputData), {
        structuredOutput: {
          schema: storySummaryStepOutputSchema.shape.summary,
          jsonPromptInjection: true,
        },
      });

      if (response.object) {
        summary = response.object;
      } else {
        warnings.push('summarizerAgent 未返回结构化摘要，已使用兜底摘要。');
      }
    } catch (error) {
      warnings.push(`summarizerAgent structured output 失败，已使用兜底摘要：${getErrorMessage(error)}`);
    }

    return {
      summary,
      warnings,
    };
  },
});

const metadataStep = createStep({
  id: 'build-story-metadata',
  description: '纯代码组装 frontmatter metadata',
  inputSchema: storyEditContextSchema,
  outputSchema: storyMetadataStepOutputSchema,
  execute: async ({ inputData }) => {
    const actualWords = countStoryWords(inputData.editResult.finalMarkdown);
    const tags = uniqueStrings([
      ...buildFallbackSummary(inputData).tags,
      inputData.request.genre,
      inputData.request.tone,
    ]);

    return {
      metadata: {
        title: inputData.outline.title,
        projectDir: inputData.projectDir,
        primaryFile: `${inputData.projectDir}/${getProjectFileNames(inputData.request.exportProfile).story}`,
        createdAt: inputData.createdAt,
        updatedAt: new Date().toISOString(),
        status: 'draft',
        genre: inputData.request.genre,
        tone: inputData.request.tone,
        pov: inputData.request.pov ?? null,
        language: inputData.request.language,
        exportProfile: inputData.request.exportProfile,
        targetWords: inputData.request.targetWords,
        actualWords,
        endingStyle: inputData.request.endingStyle ?? null,
        tags,
        modelPlan: STORY_MODELS.planner,
        modelDraft: STORY_MODELS.drafter,
        modelEdit: STORY_MODELS.editor,
        modelSummary: STORY_MODELS.summarizer,
        logline: inputData.outline.logline,
      },
    };
  },
});

const writeVaultStep = createStep({
  id: 'write-vault',
  description: '批量写入 Obsidian 项目目录',
  inputSchema: parallelStoryArtifactsSchema,
  outputSchema: vaultWriteResultSchema,
  execute: async ({ inputData, getStepResult }) => {
    const normalized = getStepResult('normalize-brief') as z.infer<typeof normalizedStoryRequestSchema>;
    const loadedReferences = getStepResult('load-reference-notes') as z.infer<typeof storyReferenceContextSchema>;
    const planned = getStepResult('plan-story') as z.infer<typeof storyPlanningContextSchema>;
    const drafted = getStepResult('draft-story') as z.infer<typeof storyDraftContextSchema>;
    const edited = getStepResult('edit-story') as z.infer<typeof storyEditContextSchema>;
    const summary = inputData['summarize-story'].summary;
    const metadata = inputData['build-story-metadata'].metadata;
    const warnings = uniqueStrings([
      ...normalized.warnings,
      ...inputData['summarize-story'].warnings,
    ]);

    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const projectDirectoryPath = resolveVaultSubpath(vaultPath, metadata.projectDir);
    await mkdir(projectDirectoryPath, { recursive: true });

    const files: Array<{ path: string; kind: string }> = [];
    const noteSpecs = buildProjectNoteSpecs({
      metadata,
      request: normalized.request,
      outline: planned.outline,
      draftMarkdown: drafted.draftMarkdown,
      finalMarkdown: edited.editResult.finalMarkdown,
      revisionNotes: edited.editResult.revisionNotes,
      summary,
      referenceArtifacts: loadedReferences.referenceArtifacts,
    });

    for (const note of noteSpecs) {
      if (metadata.exportProfile === 'minimal' && note.minimal === false) {
        continue;
      }

      const absolutePath = resolveVaultSubpath(vaultPath, `${metadata.projectDir}/${note.fileName}`);
      await writeNoteToVault(absolutePath, note.frontmatter, note.content);
      files.push({
        path: getRelativeVaultPath(vaultPath, absolutePath),
        kind: note.kind,
      });
    }

    return {
      projectDir: metadata.projectDir,
      title: metadata.title,
      primaryFile: metadata.primaryFile,
      files,
      wordCount: metadata.actualWords,
      warnings,
    };
  },
});

const manifestStep = createStep({
  id: 'build-manifest',
  description: '汇总最终 artifact manifest',
  inputSchema: vaultWriteResultSchema,
  outputSchema: artifactManifestSchema,
  execute: async ({ inputData }) => ({
    projectDir: inputData.projectDir,
    title: inputData.title,
    primaryFile: inputData.primaryFile,
    files: inputData.files,
    stats: {
      wordCount: inputData.wordCount,
    },
    warnings: inputData.warnings,
  }),
});

const shortStoryWorkflow = createWorkflow({
  id: 'short-story-workflow',
  inputSchema: storyRequestSchema,
  outputSchema: artifactManifestSchema,
  options: {
    validateInputs: true,
  },
})
  .then(normalizeBriefStep)
  .then(loadReferenceNotesStep)
  .then(planStep)
  .then(draftStep)
  .then(editStep)
  .parallel([summaryStep, metadataStep])
  .then(writeVaultStep)
  .then(manifestStep);

shortStoryWorkflow.commit();

export { shortStoryWorkflow };

function normalizeProjectSlug(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `story-${formatDate(new Date())}`;
}

function buildFallbackOutline(
  request: z.infer<typeof storyRequestSchema>,
  normalizedProjectSlug: string,
): z.infer<typeof outlineSchema> {
  const title = normalizedProjectSlug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(segment => segment.trim())
    .join(' ')
    .trim() || '未命名短篇';
  const mustIncludeText = request.mustInclude.slice(0, 2).join('、');
  const escalationFocus = mustIncludeText
    ? `过程中必须自然纳入 ${mustIncludeText}，让冲突继续升级。`
    : '过程中让人物目标与外部阻力同时升级。';
  const endingDirection = request.endingStyle
    ? `结尾呈现 ${request.endingStyle} 的收束效果，并回应前文伏笔。`
    : '结尾与前文冲突和人物动机保持一致，并完成因果回收。';
  const titleCandidates = uniqueStrings([
    title,
    `${title}：未竟之夜`,
    `${title}：回声`,
    `${title}：抉择之后`,
  ]).slice(0, 5);

  return {
    title,
    logline: request.premise,
    theme: `${request.genre} 与 ${request.tone} 的人物命运故事`,
    characters: [],
    beats: [
      {
        order: 1,
        summary: `开端：${request.premise}`,
      },
      {
        order: 2,
        summary: `升级：主角为解决核心困境主动行动，${escalationFocus}`,
      },
      {
        order: 3,
        summary: '转折：关键真相、误判或代价被揭开，迫使人物重新理解自己的目标与关系。',
      },
      {
        order: 4,
        summary: `结尾：${endingDirection}`,
      },
    ],
    endingDesign: endingDirection,
    titleCandidates: titleCandidates.length >= 3
      ? titleCandidates
      : uniqueStrings([...titleCandidates, '未命名短篇：回声', '未命名短篇：抉择']).slice(0, 3),
  };
}

function buildPlannerPrompt(input: z.infer<typeof storyReferenceContextSchema>): string {
  const { request } = input;
  return [
    '请根据下面的 short story brief 输出结构化大纲。',
    '',
    '输入约束：',
    `- language: ${request.language}`,
    `- projectSlug: ${input.normalizedProjectSlug}`,
    `- premise: ${request.premise}`,
    `- genre: ${request.genre}`,
    `- tone: ${request.tone}`,
    `- pov: ${request.pov ?? '未指定，请自行判断最合适视角'}`,
    `- targetWords: ${request.targetWords}`,
    `- endingStyle: ${request.endingStyle ?? '未指定，但需与 premise 自洽'}`,
    `- mustInclude: ${request.mustInclude.join('；') || '无'}`,
    `- mustAvoid: ${request.mustAvoid.join('；') || '无'}`,
    '',
    '输出要求：',
    '- 只产出适合后续写作使用的大纲信息。',
    '- beats 至少覆盖开端、升级、转折、结尾。',
    '- titleCandidates 给出 3 到 5 个可出版标题。',
    '- 如果 reference notes 提供了既有设定，优先延续其世界观与语言质感。',
    '',
    input.referenceContext ? `参考笔记：\n${input.referenceContext}` : '参考笔记：无',
  ].join('\n');
}

function buildDraftPrompt(input: z.infer<typeof storyPlanningContextSchema>): string {
  const { request, outline } = input;
  return [
    '请把下面的大纲写成完整短篇小说初稿。',
    '',
    '必须遵守：',
    `- language: ${request.language}`,
    `- genre: ${request.genre}`,
    `- tone: ${request.tone}`,
    `- pov: ${request.pov ?? '自行选择最合适视角，但必须稳定'}`,
    `- targetWords: ${request.targetWords}`,
    `- mustInclude: ${request.mustInclude.join('；') || '无'}`,
    `- mustAvoid: ${request.mustAvoid.join('；') || '无'}`,
    '',
    '输出要求：',
    '- 只输出 Markdown 正文，不要解释。',
    '- 使用一级标题作为标题。',
    '- 故事必须完整，不要写成提纲或片段。',
    '',
    `大纲：\n${JSON.stringify(outline, null, 2)}`,
    '',
    input.referenceContext ? `参考笔记：\n${input.referenceContext}` : '参考笔记：无',
  ].join('\n');
}

function buildEditorPrompt(input: z.infer<typeof storyDraftContextSchema>): string {
  const { request, outline, draftMarkdown } = input;
  return [
    '请对下面的短篇小说初稿做编辑加工，并返回终稿与修订说明。',
    '',
    '编辑目标：',
    '- 修复逻辑断裂、人物动机松散、节奏失衡、语句冗余。',
    '- 保持 genre / tone / POV 与 brief 一致。',
    '- 不要引入 brief 中没有的新设定。',
    '',
    '返回字段要求：',
    '- finalMarkdown: 完整 Markdown 正文，可直接写入文件。',
    '- revisionNotes: 用中文简洁说明主要修订点与残余风险。',
    '',
    `brief：${JSON.stringify(
      {
        premise: request.premise,
        genre: request.genre,
        tone: request.tone,
        pov: request.pov,
        targetWords: request.targetWords,
        endingStyle: request.endingStyle,
        mustInclude: request.mustInclude,
        mustAvoid: request.mustAvoid,
      },
      null,
      2,
    )}`,
    '',
    `outline：${JSON.stringify(outline, null, 2)}`,
    '',
    `draft：\n${draftMarkdown}`,
  ].join('\n');
}

function buildSummarizerPrompt(input: z.infer<typeof storyEditContextSchema>): string {
  return [
    '请为下面的短篇小说终稿生成 logline、无剧透摘要、全剧透摘要和 tags。',
    '',
    '要求：',
    '- logline 1 到 2 句。',
    '- spoilerFreeSummary 不能泄露结局。',
    '- fullSummary 要说明完整剧情和结尾。',
    '- tags 控制在 4 到 8 个。',
    '',
    `标题：${input.outline.title}`,
    `题材：${input.request.genre}`,
    `语气：${input.request.tone}`,
    '',
    input.editResult.finalMarkdown,
  ].join('\n');
}

function buildFallbackSummary(input: z.infer<typeof storyEditContextSchema>) {
  const paragraphs = input.editResult.finalMarkdown
    .replace(/^# .+\n+/u, '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);

  const spoilerFreeSummary = paragraphs.slice(0, 2).join('\n\n') || input.request.premise;
  const fullSummary = paragraphs.slice(0, 4).join('\n\n') || input.request.premise;

  return {
    logline: input.outline.logline,
    spoilerFreeSummary,
    fullSummary,
    tags: uniqueStrings([
      '短篇小说',
      input.request.genre,
      input.request.tone,
      input.request.language === 'zh-CN' ? '中文创作' : 'English fiction',
    ]),
  };
}

function buildFallbackDraft(input: z.infer<typeof storyPlanningContextSchema>): string {
  const beats = input.outline.beats.length > 0 ? input.outline.beats : buildFallbackOutline(input.request, input.normalizedProjectSlug).beats;
  const referenceHint = input.referenceArtifacts[0]?.excerpt
    ? `他想起参考笔记里提过的细节：${input.referenceArtifacts[0].excerpt}`
    : '他只能依靠眼前不断逼近的细节做判断。';

  const paragraphs = beats.map((beat, index) => {
    if (index === 0) {
      return `${beat.summary} ${referenceHint}`;
    }

    if (index === beats.length - 1) {
      return `${beat.summary} 一切最终回到他必须做出的选择上，结尾没有背离此前埋下的因果。`;
    }

    return `${beat.summary} 冲突被继续推高，人物的动机也因此暴露得更清楚。`;
  });

  const povLine =
    input.request.pov && input.request.pov.includes('第一')
      ? '我知道自己已经没有退路。'
      : '他知道自己已经没有退路。';

  return [
    `# ${input.outline.title}`,
    '',
    `${input.request.premise} ${povLine}`,
    '',
    ...paragraphs,
    '',
    `故事保持 ${input.request.genre} 的框架与 ${input.request.tone} 的语气收束。`,
  ].join('\n\n');
}

function ensureStoryHeading(title: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('# ')) {
    return trimmed;
  }

  return `# ${title}\n\n${trimmed}`;
}

function countStoryWords(markdown: string): number {
  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\n*/u, '');
  const plainText = withoutFrontmatter.replace(/[#>*_`\-\[\]\(\)!]/g, ' ');
  const chineseChars = plainText.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = plainText
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;

  return chineseChars + latinWords;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildProjectNoteSpecs(input: {
  metadata: z.infer<typeof storyMetadataStepOutputSchema>['metadata'];
  request: z.infer<typeof storyRequestSchema>;
  outline: z.infer<typeof outlineSchema>;
  draftMarkdown: string;
  finalMarkdown: string;
  revisionNotes: string;
  summary: z.infer<typeof storySummaryStepOutputSchema>['summary'];
  referenceArtifacts: z.infer<typeof storyReferenceContextSchema>['referenceArtifacts'];
}) {
  const fileNames = getProjectFileNames(input.metadata.exportProfile);
  const projectLinks = buildProjectLinks(input.metadata.exportProfile);
  const sharedProjectFrontmatter: FrontmatterRecord = {
    title: input.metadata.title,
    type: 'story-project',
    status: input.metadata.status,
    created: formatDate(new Date(input.metadata.createdAt)),
    updated: input.metadata.updatedAt,
    exportProfile: input.metadata.exportProfile,
    tags: input.metadata.tags,
  };

  return [
    {
      fileName: 'index.md',
      kind: 'index',
      minimal: true,
      frontmatter: sharedProjectFrontmatter,
      content: [
        `# ${input.metadata.title}`,
        '',
        `- 状态：${input.metadata.status}`,
        `- 目录：${input.metadata.projectDir}`,
        `- 主文件：[[${getWikiLinkTarget(fileNames.story)}]]`,
        `- 目标字数：${input.metadata.targetWords}`,
        `- 实际字数：${input.metadata.actualWords}`,
        '',
        '## Logline',
        '',
        input.summary.logline,
        '',
        '## 文件导航',
        '',
        ...projectLinks.map(link => `- [[${getWikiLinkTarget(link.fileName)}]] ${link.label}`),
      ].join('\n'),
    },
    {
      fileName: fileNames.brief,
      kind: 'brief',
      minimal: true,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-brief',
      },
      content: [
        '# Brief Snapshot',
        '',
        '## Request',
        '',
        '```json',
        JSON.stringify(input.request, null, 2),
        '```',
        '',
        '## Reference Notes',
        '',
        input.referenceArtifacts.length === 0
          ? '- 无'
          : input.referenceArtifacts.map(note => `- ${note.path} (${note.title})`).join('\n'),
      ].join('\n'),
    },
    {
      fileName: fileNames.outline,
      kind: 'outline',
      minimal: false,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-outline',
      },
      content: [
        '# Outline',
        '',
        `## 标题`,
        '',
        input.outline.title,
        '',
        '## Logline',
        '',
        input.outline.logline,
        '',
        '## Theme',
        '',
        input.outline.theme,
        '',
        '## Beats',
        '',
        ...input.outline.beats.map(beat => `${beat.order}. ${beat.summary}`),
        '',
        '## Characters',
        '',
        input.outline.characters.length === 0
          ? '- 暂无显式角色卡'
          : input.outline.characters.map(character => {
              const details = [
                `- 角色：${character.name}`,
                `  - 职能：${character.role}`,
                `  - 动机：${character.motivation}`,
              ];
              if (character.secret) {
                details.push(`  - 秘密：${character.secret}`);
              }
              return details.join('\n');
            }).join('\n'),
        '',
        '## Ending Design',
        '',
        input.outline.endingDesign,
      ].join('\n'),
    },
    {
      fileName: fileNames.characters,
      kind: 'characters',
      minimal: false,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-characters',
      },
      content: [
        '# Characters',
        '',
        input.outline.characters.length === 0
          ? '暂无显式角色卡。'
          : input.outline.characters
              .map(character =>
                [
                  `## ${character.name}`,
                  '',
                  `- 角色定位：${character.role}`,
                  `- 核心动机：${character.motivation}`,
                  character.secret ? `- 隐藏信息：${character.secret}` : '- 隐藏信息：无',
                ].join('\n'),
              )
              .join('\n\n'),
      ].join('\n'),
    },
    {
      fileName: fileNames.draft,
      kind: 'draft',
      minimal: false,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-draft',
      },
      content: ensureStoryHeading(input.metadata.title, input.draftMarkdown),
    },
    {
      fileName: fileNames.story,
      kind: 'story',
      minimal: true,
      frontmatter: {
        title: input.metadata.title,
        status: input.metadata.status,
        language: input.metadata.language,
        genre: input.metadata.genre,
        tone: input.metadata.tone,
        pov: input.metadata.pov ?? '',
        created: formatDate(new Date(input.metadata.createdAt)),
        updated: input.metadata.updatedAt,
        exportProfile: input.metadata.exportProfile,
        targetWords: input.metadata.targetWords,
        actualWords: input.metadata.actualWords,
        tags: input.metadata.tags,
        logline: input.summary.logline,
        models: {
          planner: input.metadata.modelPlan,
          drafter: input.metadata.modelDraft,
          editor: input.metadata.modelEdit,
          summarizer: input.metadata.modelSummary,
        },
      },
      content: ensureStoryHeading(input.metadata.title, input.finalMarkdown),
    },
    {
      fileName: fileNames.summary,
      kind: 'summary',
      minimal: true,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-summary',
      },
      content: [
        '# Summary',
        '',
        '## Logline',
        '',
        input.summary.logline,
        '',
        '## 无剧透摘要',
        '',
        input.summary.spoilerFreeSummary,
        '',
        '## 全剧透摘要',
        '',
        input.summary.fullSummary,
        '',
        '## Tags',
        '',
        input.summary.tags.map(tag => `- ${tag}`).join('\n'),
      ].join('\n'),
    },
    {
      fileName: fileNames.metadata,
      kind: 'metadata',
      minimal: true,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-metadata',
      },
      content: [
        '# Metadata',
        '',
        `- title: ${input.metadata.title}`,
        `- projectDir: ${input.metadata.projectDir}`,
        `- primaryFile: ${input.metadata.primaryFile}`,
        `- genre: ${input.metadata.genre}`,
        `- tone: ${input.metadata.tone}`,
        `- pov: ${input.metadata.pov ?? '未指定'}`,
        `- language: ${input.metadata.language}`,
        `- targetWords: ${input.metadata.targetWords}`,
        `- actualWords: ${input.metadata.actualWords}`,
        `- endingStyle: ${input.metadata.endingStyle ?? '未指定'}`,
        `- createdAt: ${input.metadata.createdAt}`,
        `- updatedAt: ${input.metadata.updatedAt}`,
        `- exportProfile: ${input.metadata.exportProfile}`,
        `- tags: ${input.metadata.tags.join('、')}`,
        '',
        '## Models',
        '',
        `- planner: ${input.metadata.modelPlan}`,
        `- drafter: ${input.metadata.modelDraft}`,
        `- editor: ${input.metadata.modelEdit}`,
        `- summarizer: ${input.metadata.modelSummary}`,
      ].join('\n'),
    },
    {
      fileName: fileNames.revisionLog,
      kind: 'revision-log',
      minimal: false,
      frontmatter: {
        ...sharedProjectFrontmatter,
        type: 'story-revision-log',
      },
      content: [
        '# Revision Log',
        '',
        input.revisionNotes,
      ].join('\n'),
    },
  ];
}

function buildProjectLinks(exportProfile: z.infer<typeof storyRequestSchema>['exportProfile']) {
  const fileNames = getProjectFileNames(exportProfile);
  const notes = [
    { fileName: fileNames.brief, label: '需求快照' },
    { fileName: fileNames.story, label: '最终正文' },
    { fileName: fileNames.summary, label: '摘要与标签' },
    { fileName: fileNames.metadata, label: '元数据' },
  ];

  if (exportProfile === 'authoring') {
    notes.splice(
      1,
      0,
      { fileName: fileNames.outline, label: '结构大纲' },
      { fileName: fileNames.characters, label: '角色卡' },
      { fileName: fileNames.draft, label: '初稿' },
    );
    notes.push({ fileName: fileNames.revisionLog, label: '修订记录' });
  }

  return notes;
}

function getProjectFileNames(exportProfile: z.infer<typeof storyRequestSchema>['exportProfile']) {
  return exportProfile === 'minimal' ? MINIMAL_PROJECT_FILE_NAMES : AUTHORING_PROJECT_FILE_NAMES;
}

function getWikiLinkTarget(fileName: string): string {
  return fileName.replace(/\.md$/u, '');
}
