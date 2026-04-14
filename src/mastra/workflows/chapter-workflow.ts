import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { chapterDrafterAgent } from '../agents/chapter-drafter-agent';
import { chapterEditorAgent } from '../agents/chapter-editor-agent';
import { chapterSummarizerAgent } from '../agents/chapter-summarizer-agent';
import { continuityCheckerAgent } from '../agents/continuity-checker-agent';
import { novelPlannerAgent } from '../agents/novel-planner-agent';
import {
  chapterContextSchema,
  chapterContinuityContextSchema,
  chapterDraftContextSchema,
  chapterEditContextSchema,
  chapterEditResultSchema,
  chapterExecutionInputSchema,
  chapterFileWriteSchema,
  chapterResultSchema,
  chapterSummaryContextSchema,
  chapterSummarySchema,
  chapterWriteContextSchema,
  continuityReportSchema,
  novelRuntimeStateSchema,
  novelStateSchema,
  type ChapterSummary,
  type NovelState,
} from '../schemas/novel-schema';
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

const CONTINUITY_INTERVAL = 3;
const CHAPTER_SUMMARY_WINDOW = 5;
const EDITOR_FINAL_MARKDOWN_TAG = 'final_markdown';
const EDITOR_REVISION_NOTES_TAG = 'revision_notes';

const buildChapterBriefStep = createStep({
  id: 'build-chapter-brief',
  description: '结合 state 与章节规划，扩写本章可执行 brief',
  inputSchema: chapterExecutionInputSchema,
  outputSchema: chapterContextSchema,
  stateSchema: novelRuntimeStateSchema,
  execute: async ({ inputData, state }) => {
    const warnings: string[] = [];
    const currentState = ensureNovelState(state);
    const requiredChapterContext = await loadRequiredChapterContext(
      inputData.projectDir,
      inputData.brief.mustReadChapters,
      warnings,
    );
    let briefMarkdown = buildFallbackChapterBriefMarkdown(inputData, currentState);

    try {
      const response = await novelPlannerAgent.generate(buildChapterBriefPrompt(inputData, currentState, requiredChapterContext));
      const candidate = response.text?.trim();
      if (candidate) {
        briefMarkdown = candidate;
      } else {
        warnings.push('novelPlannerAgent 未返回章节 brief，已使用本地兜底 brief。');
      }
    } catch (error) {
      warnings.push(`novelPlannerAgent 生成章节 brief 失败，已使用兜底 brief：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      briefMarkdown,
      storyBibleCompact: currentState.storyBible.compact,
      historyContext: buildHistoryContext(currentState, inputData.brief.chapterNumber),
      requiredChapterContext,
      warnings,
    };
  },
});

const draftChapterStep = createStep({
  id: 'draft-chapter',
  description: '根据章节 brief 与上下文生成章节初稿',
  inputSchema: chapterContextSchema,
  outputSchema: chapterDraftContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    let draftMarkdown = buildFallbackChapterDraft(inputData);

    try {
      const response = await chapterDrafterAgent.generate(buildChapterDraftPrompt(inputData));
      const candidate = response.text?.trim();
      if (candidate) {
        draftMarkdown = ensureChapterHeading(inputData.brief.title, candidate);
      } else {
        warnings.push('chapterDrafterAgent 未返回章节正文，已使用本地兜底初稿。');
      }
    } catch (error) {
      warnings.push(`chapterDrafterAgent 调用失败，已使用兜底初稿：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      draftMarkdown,
      warnings,
    };
  },
});

const editChapterStep = createStep({
  id: 'edit-chapter',
  description: '对章节初稿做逻辑与表达层面的修订',
  inputSchema: chapterDraftContextSchema,
  outputSchema: chapterEditContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    let editResult = buildFallbackChapterEditResult(
      inputData,
      '编辑阶段未拿到可解析终稿，已保留章节初稿。',
    );

    try {
      const response = await chapterEditorAgent.generate(buildChapterEditorPrompt(inputData));
      const parsed = parseEditorResponse(response.text);
      if (parsed) {
        editResult = {
          finalMarkdown: ensureChapterHeading(inputData.brief.title, parsed.finalMarkdown),
          revisionNotes: parsed.revisionNotes,
        };
      } else {
        warnings.push('chapterEditorAgent 返回结果无法解析，已回退为章节初稿。');
      }
    } catch (error) {
      warnings.push(`chapterEditorAgent 调用失败，已回退为章节初稿：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      editResult,
      warnings,
    };
  },
});

const continuityCheckStep = createStep({
  id: 'continuity-check',
  description: '每 3 章或最后一章执行一次 continuity 检查',
  inputSchema: chapterEditContextSchema,
  outputSchema: chapterContinuityContextSchema,
  stateSchema: novelRuntimeStateSchema,
  execute: async ({ inputData, state }) => {
    const warnings = [...inputData.warnings];
    const shouldCheck =
      inputData.brief.chapterNumber % CONTINUITY_INTERVAL === 0 ||
      inputData.brief.chapterNumber === inputData.chapterCount;

    if (!shouldCheck) {
      return {
        ...inputData,
        continuityReport: null,
        warnings,
      };
    }

    const currentState = ensureNovelState(state);
    let continuityReport = buildFallbackContinuityReport(inputData);

    try {
      const response = await continuityCheckerAgent.generate(
        buildContinuityPrompt(inputData, currentState),
        {
          structuredOutput: {
            schema: continuityReportSchema,
            jsonPromptInjection: true,
          },
        },
      );

      if (response.object) {
        continuityReport = {
          ...response.object,
          checked: true,
          chapterNumber: inputData.brief.chapterNumber,
        };
      } else {
        warnings.push('continuityCheckerAgent 未返回结构化检查结果，已使用兜底报告。');
      }
    } catch (error) {
      warnings.push(`continuityCheckerAgent 检查失败，已使用兜底报告：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      continuityReport,
      warnings,
    };
  },
});

const summarizeChapterStep = createStep({
  id: 'summarize-chapter',
  description: '为章节生成结构化摘要、时间线与伏笔状态',
  inputSchema: chapterContinuityContextSchema,
  outputSchema: chapterSummaryContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    let summary = buildFallbackChapterSummary(inputData);

    try {
      const response = await chapterSummarizerAgent.generate(buildChapterSummaryPrompt(inputData), {
        structuredOutput: {
          schema: chapterSummarySchema,
          jsonPromptInjection: true,
        },
      });

      if (response.object) {
        summary = response.object;
      } else {
        warnings.push('chapterSummarizerAgent 未返回结构化摘要，已使用兜底摘要。');
      }
    } catch (error) {
      warnings.push(`chapterSummarizerAgent 生成结构化摘要失败，已使用兜底摘要：${getErrorMessage(error)}`);
    }

    return {
      ...inputData,
      summary,
      warnings,
    };
  },
});

const writeChapterFilesStep = createStep({
  id: 'write-chapter-files',
  description: '将章节 brief 与终稿写入 Obsidian 项目目录',
  inputSchema: chapterSummaryContextSchema,
  outputSchema: chapterWriteContextSchema,
  execute: async ({ inputData }) => {
    const warnings = [...inputData.warnings];
    const chapterPrefix = formatChapterNumber(inputData.brief.chapterNumber);

    try {
      const vaultPath = getVaultPath();
      await ensureVaultDirectory(vaultPath);

      const briefRelativePath = `${inputData.projectDir}/chapters/${chapterPrefix}-brief.md`;
      const finalRelativePath = `${inputData.projectDir}/chapters/${chapterPrefix}-final.md`;
      const briefPath = resolveVaultSubpath(vaultPath, briefRelativePath);
      const finalPath = resolveVaultSubpath(vaultPath, finalRelativePath);

      const sharedFrontmatter: FrontmatterRecord = {
        title: inputData.brief.title,
        chapterNumber: inputData.brief.chapterNumber,
        type: 'novel-chapter',
        updated: new Date().toISOString(),
        tags: ['novel', 'chapter'],
      };

      await writeNoteToVault(
        briefPath,
        {
          ...sharedFrontmatter,
          noteKind: 'brief',
          created: formatDate(new Date()),
        },
        inputData.briefMarkdown,
      );
      await writeNoteToVault(
        finalPath,
        {
          ...sharedFrontmatter,
          noteKind: 'final',
          milestone: inputData.summary.milestone?.significance ?? null,
        },
        inputData.editResult.finalMarkdown,
      );

      return {
        ...inputData,
        files: {
          briefPath: getRelativeVaultPath(vaultPath, briefPath),
          finalPath: getRelativeVaultPath(vaultPath, finalPath),
        },
        warnings,
      };
    } catch (error) {
      warnings.push(`章节文件写入失败：${getErrorMessage(error)}`);
      return {
        ...inputData,
        files: {
          briefPath: `${inputData.projectDir}/chapters/${chapterPrefix}-brief.md`,
          finalPath: `${inputData.projectDir}/chapters/${chapterPrefix}-final.md`,
        },
        warnings,
      };
    }
  },
});

const updateStateStep = createStep({
  id: 'update-state',
  description: '更新 chapter summaries、open loops、timeline 与 file manifest',
  inputSchema: chapterWriteContextSchema,
  outputSchema: chapterResultSchema,
  stateSchema: novelRuntimeStateSchema,
  execute: async ({ inputData, state, setState }) => {
    const currentState = ensureNovelState(state);
    const nextChapterSummaries = rollChapterSummaries(currentState.chapterSummaries, inputData.summary);
    const nextOpenLoops = updateOpenLoops(currentState, inputData.summary);
    const nextTimeline = dedupeTimeline([...currentState.timeline, ...inputData.summary.timeline]);
    const nextContinuityNotes = inputData.continuityReport
      ? uniqueStrings([
          ...currentState.continuityNotes,
          ...inputData.continuityReport.findings.map(
            finding => `第 ${inputData.brief.chapterNumber} 章 ${finding.category}：${finding.issue}`,
          ),
        ])
      : currentState.continuityNotes;
    const nextFileManifest = appendFileManifest(currentState, inputData.files);

    await setState({
      ...currentState,
      currentChapter: Math.max(currentState.currentChapter, inputData.brief.chapterNumber),
      chapterSummaries: nextChapterSummaries,
      openLoops: nextOpenLoops,
      timeline: nextTimeline,
      continuityNotes: nextContinuityNotes,
      fileManifest: nextFileManifest,
    });

    return {
      chapterNumber: inputData.brief.chapterNumber,
      title: inputData.brief.title,
      briefPath: inputData.files.briefPath,
      finalPath: inputData.files.finalPath,
      finalMarkdown: inputData.editResult.finalMarkdown,
      revisionNotes: inputData.editResult.revisionNotes,
      summary: inputData.summary,
      continuityReport: inputData.continuityReport,
      warnings: uniqueStrings(inputData.warnings),
    };
  },
});

export const chapterWorkflow = createWorkflow({
  id: 'chapter-workflow',
  inputSchema: chapterExecutionInputSchema,
  outputSchema: chapterResultSchema,
  stateSchema: novelRuntimeStateSchema,
  options: {
    validateInputs: true,
  },
})
  .then(buildChapterBriefStep)
  .then(draftChapterStep)
  .then(editChapterStep)
  .then(continuityCheckStep)
  .then(summarizeChapterStep)
  .then(writeChapterFilesStep)
  .then(updateStateStep)
  .commit();

async function loadRequiredChapterContext(
  projectDir: string,
  chapterNumbers: number[],
  warnings: string[],
): Promise<string> {
  if (chapterNumbers.length === 0) {
    return '';
  }

  try {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);
    const contexts: string[] = [];

    for (const chapterNumber of chapterNumbers) {
      const relativePath = `${projectDir}/chapters/${formatChapterNumber(chapterNumber)}-final.md`;
      const absolutePath = resolveVaultSubpath(vaultPath, relativePath);
      if (!(await pathExists(absolutePath))) {
        warnings.push(`依赖章节文件不存在，已跳过 ${relativePath}`);
        continue;
      }

      const note = await readNoteFromVault(vaultPath, relativePath);
      contexts.push(`## 必读前章 ${chapterNumber}\n\n${note.content.trim() || note.rawContent.trim()}`);
    }

    return contexts.join('\n\n');
  } catch (error) {
    warnings.push(`读取依赖章节失败：${getErrorMessage(error)}`);
    return '';
  }
}

function buildChapterBriefPrompt(
  input: z.infer<typeof chapterExecutionInputSchema>,
  state: NovelState,
  requiredChapterContext: string,
): string {
  return [
    '请把下面的章节规划扩写成可直接供写作使用的章节 brief。',
    '',
    '输出要求：',
    '- 只输出 Markdown 文本，不要返回 JSON。',
    '- 必须包含：本章目标、冲突推进、关键场景、人物状态、应回收或新引入的伏笔、禁区提醒。',
    '- 明确指出哪些信息必须延续上文，哪些信息本章不能提前揭示。',
    '',
    `小说标题：${input.title}`,
    `章节序号：${input.brief.chapterNumber}/${input.chapterCount}`,
    `题材：${input.request.genre}`,
    `语气：${input.request.tone}`,
    `视角：${input.request.pov ?? '未指定，保持与全书最一致的选择'}`,
    '',
    `story bible compact：\n${state.storyBible.compact}`,
    '',
    `章节规划：\n${JSON.stringify(input.brief, null, 2)}`,
    '',
    buildHistoryContext(state, input.brief.chapterNumber),
    '',
    requiredChapterContext ? `必须阅读的前章：\n${requiredChapterContext}` : '必须阅读的前章：无',
  ].join('\n');
}

function buildChapterDraftPrompt(input: z.infer<typeof chapterContextSchema>): string {
  return [
    '请根据以下章节 brief 撰写本章正文。',
    '',
    '必须遵守：',
    `- language: ${input.request.language}`,
    `- genre: ${input.request.genre}`,
    `- tone: ${input.request.tone}`,
    `- pov: ${input.request.pov ?? '保持最自然且稳定的视角'}`,
    `- mustInclude: ${input.request.mustInclude.join('；') || '无'}`,
    `- mustAvoid: ${input.request.mustAvoid.join('；') || '无'}`,
    '',
    '输出要求：',
    '- 只输出本章 Markdown 正文。',
    '- 开头使用一级标题。',
    '- 不要输出任何解释或写作说明。',
    '',
    `story bible compact：\n${input.storyBibleCompact}`,
    '',
    `最近剧情与状态：\n${input.historyContext || '暂无'}`,
    '',
    input.requiredChapterContext ? `必须承接的章节：\n${input.requiredChapterContext}` : '必须承接的章节：无',
    '',
    `本章 brief：\n${input.briefMarkdown}`,
  ].join('\n');
}

function buildChapterEditorPrompt(input: z.infer<typeof chapterDraftContextSchema>): string {
  return [
    '请对下面的章节初稿做编辑加工，并严格返回终稿与修订说明。',
    '',
    '编辑重点：',
    '- 连续性与人物动机是否稳定',
    '- 节奏是否在本章内部完成推进',
    '- 是否无意越界暴露未来章节信息',
    '- 语言是否冗余、视角是否飘移',
    '',
    '返回格式要求：',
    '- 不要输出解释文字，不要使用 ``` 代码块。',
    `- 必须严格输出 <${EDITOR_FINAL_MARKDOWN_TAG}>...</${EDITOR_FINAL_MARKDOWN_TAG}> 与 <${EDITOR_REVISION_NOTES_TAG}>...</${EDITOR_REVISION_NOTES_TAG}> 两段。`,
    '',
    `章节规划：\n${JSON.stringify(input.brief, null, 2)}`,
    '',
    `章节 brief：\n${input.briefMarkdown}`,
    '',
    `章节初稿：\n${input.draftMarkdown}`,
  ].join('\n');
}

function buildContinuityPrompt(input: z.infer<typeof chapterEditContextSchema>, state: NovelState): string {
  const recentSummaries = state.chapterSummaries.recent
    .slice(-2)
    .map(summary => `## 第 ${summary.chapterNumber} 章 ${summary.title}\n${summary.summary}`)
    .join('\n\n');

  return [
    '请作为 continuity checker 审查当前章节终稿，并在必要时主动使用 obsidian-search-notes 工具查询既有笔记。',
    '',
    '检查清单：',
    '1. 角色当前所在地与上章是否一致',
    '2. 本章出现角色的称谓与设定是否一致',
    '3. 本章涉及的时间节点与 timeline 是否冲突',
    '4. 本章是否使用了未设定的能力或道具',
    '5. 本章是否回收或推进了 openLoops 中的伏笔',
    '',
    `当前章节：第 ${input.brief.chapterNumber} 章 ${input.brief.title}`,
    '',
    `story bible compact：\n${state.storyBible.compact}`,
    '',
    recentSummaries ? `最近两章摘要：\n${recentSummaries}` : '最近两章摘要：无',
    '',
    `Open loops：\n${state.openLoops.map(loop => `- ${loop.description}（${loop.status}）`).join('\n') || '无'}`,
    '',
    `Timeline：\n${state.timeline.map(item => `- 第 ${item.chapterNumber} 章 ${item.timeMarker} @ ${item.location}：${item.event}`).join('\n') || '无'}`,
    '',
    `当前章节终稿：\n${input.editResult.finalMarkdown}`,
  ].join('\n');
}

function buildChapterSummaryPrompt(input: z.infer<typeof chapterContinuityContextSchema>): string {
  return [
    '请为下面的章节终稿生成结构化摘要。',
    '',
    '要求：',
    '- summary 为含剧透摘要，完整覆盖本章因果链。',
    '- spoilerFreeSummary 为不泄露关键转折的简介。',
    '- keyEvents、characters、locations、props 要尽量显式、可检索。',
    '- milestone 如果没有实质转折可返回 null。',
    '- openLoopsOpened / openLoopsClosed 只记录真实伏笔变化。',
    '- timeline 至少覆盖本章最关键的 1 到 3 个事件。',
    '',
    `章节信息：\n${JSON.stringify(input.brief, null, 2)}`,
    '',
    input.continuityReport
      ? `continuity 检查结果：\n${JSON.stringify(input.continuityReport, null, 2)}`
      : 'continuity 检查结果：本章未触发检查',
    '',
    `终稿：\n${input.editResult.finalMarkdown}`,
  ].join('\n');
}

function buildFallbackChapterBriefMarkdown(
  input: z.infer<typeof chapterExecutionInputSchema>,
  state: NovelState,
): string {
  return [
    `# Chapter Brief ${formatChapterNumber(input.brief.chapterNumber)} · ${input.brief.title}`,
    '',
    '## 本章目标',
    '',
    input.brief.synopsis,
    '',
    '## 关键事件',
    '',
    ...input.brief.keyEvents.map(event => `- ${event}`),
    '',
    '## 必须处理的伏笔',
    '',
    ...(input.brief.openLoopsToResolve.length > 0
      ? input.brief.openLoopsToResolve.map(loop => `- 回收或推进：${loop}`)
      : ['- 无明确待回收伏笔']),
    '',
    '## 新增伏笔',
    '',
    ...(input.brief.openLoopsToIntroduce.length > 0
      ? input.brief.openLoopsToIntroduce.map(loop => `- 引入：${loop}`)
      : ['- 如需新增伏笔，必须服务终局设计']),
    '',
    '## 承接信息',
    '',
    state.chapterSummaries.recent.length > 0
      ? state.chapterSummaries.recent
          .slice(-2)
          .map(summary => `- 第 ${summary.chapterNumber} 章：${summary.summary}`)
          .join('\n')
      : '- 首章或暂无历史摘要',
  ].join('\n');
}

function buildFallbackChapterDraft(input: z.infer<typeof chapterContextSchema>): string {
  const eventLines = input.brief.keyEvents.length > 0 ? input.brief.keyEvents : [input.brief.synopsis];
  return [
    `# ${input.brief.title}`,
    '',
    `${input.brief.synopsis} 故事在这一章继续沿着既定冲突推进。`,
    '',
    ...eventLines.map((event, index) =>
      index === eventLines.length - 1
        ? `${event} 这一推进同时为下一章留下新的压力与悬念。`
        : `${event} 人物关系与目标因此发生进一步变化。`,
    ),
    '',
    '本章结尾保持张力，但不越界提前揭示未来章节答案。',
  ].join('\n\n');
}

function buildFallbackChapterEditResult(
  input: z.infer<typeof chapterDraftContextSchema>,
  revisionNotes: string,
): z.infer<typeof chapterEditResultSchema> {
  return {
    finalMarkdown: ensureChapterHeading(input.brief.title, input.draftMarkdown),
    revisionNotes,
  };
}

function buildFallbackContinuityReport(
  input: z.infer<typeof chapterEditContextSchema>,
): z.infer<typeof continuityReportSchema> {
  return {
    checked: true,
    chapterNumber: input.brief.chapterNumber,
    summary: '已按固定清单做本地兜底检查，未发现明确的跨章节硬冲突。',
    searchedQueries: [],
    findings: [],
  };
}

function buildFallbackChapterSummary(
  input: z.infer<typeof chapterContinuityContextSchema>,
): z.infer<typeof chapterSummarySchema> {
  const plainText = stripMarkdown(input.editResult.finalMarkdown);
  const summaryText = plainText.slice(0, 220).trim() || input.brief.synopsis;

  return {
    chapterNumber: input.brief.chapterNumber,
    title: input.brief.title,
    summary: summaryText,
    spoilerFreeSummary: input.brief.synopsis,
    keyEvents: input.brief.keyEvents,
    characters: [],
    locations: [],
    props: [],
    milestone:
      input.brief.chapterNumber === 1 || input.brief.chapterNumber === input.chapterCount
        ? {
            chapterNumber: input.brief.chapterNumber,
            title: input.brief.title,
            significance: input.brief.synopsis,
          }
        : null,
    openLoopsOpened: input.brief.openLoopsToIntroduce,
    openLoopsClosed: input.brief.openLoopsToResolve,
    timeline: [
      {
        chapterNumber: input.brief.chapterNumber,
        order: 1,
        timeMarker: `第 ${input.brief.chapterNumber} 章`,
        event: input.brief.synopsis,
        location: '待明确',
        participants: [],
      },
    ],
  };
}

function buildHistoryContext(state: NovelState, chapterNumber: number): string {
  const recentSummaries = state.chapterSummaries.recent
    .slice(-Math.min(state.chapterSummaries.recent.length, 3))
    .map(summary => `- 第 ${summary.chapterNumber} 章 ${summary.title}：${summary.summary}`)
    .join('\n');

  const openLoops = state.openLoops
    .filter(loop => loop.status === 'open')
    .map(loop => `- ${loop.description}（第 ${loop.introducedInChapter} 章引入）`)
    .join('\n');

  return [
    `当前章节：第 ${chapterNumber} 章`,
    '',
    '最近章节摘要：',
    recentSummaries || '- 暂无',
    '',
    '压缩摘要：',
    state.chapterSummaries.compressed || '暂无',
    '',
    '未回收伏笔：',
    openLoops || '- 无',
    '',
    '连续性警告：',
    state.continuityNotes.length > 0 ? state.continuityNotes.map(note => `- ${note}`).join('\n') : '- 无',
  ].join('\n');
}

function ensureNovelState(value: unknown): NovelState {
  const parsed = novelStateSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    projectSlug: '',
    title: '',
    storyBible: {
      full: {
        title: '',
        logline: '',
        theme: '',
        premiseFocus: '',
        world: '',
        setting: '',
        characters: [],
        narrativeRules: [],
        styleGuide: [],
        chapterStyleRules: [],
        majorConflicts: [],
        motifs: [],
        endingDesign: '',
      },
      compact: '',
    },
    actPlan: {
      structure: '',
      acts: [],
    },
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

function rollChapterSummaries(
  current: NovelState['chapterSummaries'],
  nextSummary: ChapterSummary,
): NovelState['chapterSummaries'] {
  const recent = [...current.recent, nextSummary];
  const overflowCount = Math.max(0, recent.length - CHAPTER_SUMMARY_WINDOW);
  const overflow = recent.slice(0, overflowCount);
  const nextRecent = recent.slice(overflowCount);
  const compressed = overflow.length > 0
    ? uniqueStrings([current.compressed, ...overflow.map(item => `第 ${item.chapterNumber} 章 ${item.title}：${item.summary}`)])
        .join('\n')
        .trim()
    : current.compressed;

  return {
    recent: nextRecent,
    compressed,
    milestones: uniqueMilestones([
      ...current.milestones,
      ...(nextSummary.milestone ? [nextSummary.milestone] : []),
    ]),
  };
}

function updateOpenLoops(state: NovelState, summary: ChapterSummary): NovelState['openLoops'] {
  const closed = new Set(summary.openLoopsClosed.map(normalizeLooseKey));
  const opened = summary.openLoopsOpened.map(description => ({
    id: createOpenLoopId(description, summary.chapterNumber),
    description,
    introducedInChapter: summary.chapterNumber,
    status: 'open' as const,
    resolvedInChapter: null,
  }));

  const existing = state.openLoops.map(loop => {
    if (!closed.has(normalizeLooseKey(loop.id)) && !closed.has(normalizeLooseKey(loop.description))) {
      return loop;
    }

    return {
      ...loop,
      status: 'resolved' as const,
      resolvedInChapter: summary.chapterNumber,
    };
  });

  return dedupeOpenLoops([...existing, ...opened]);
}

function appendFileManifest(
  state: NovelState,
  files: z.infer<typeof chapterFileWriteSchema>,
): NovelState['fileManifest'] {
  const entries = [
    ...state.fileManifest,
    { path: files.briefPath, kind: 'chapter-brief' },
    { path: files.finalPath, kind: 'chapter-final' },
  ];

  return Array.from(
    new Map(entries.map(entry => [entry.path, entry])).values(),
  );
}

function dedupeTimeline(timeline: NovelState['timeline']): NovelState['timeline'] {
  return Array.from(
    new Map(
      timeline.map(entry => [`${entry.chapterNumber}:${entry.order}:${entry.timeMarker}:${entry.event}`, entry]),
    ).values(),
  );
}

function uniqueMilestones(milestones: NovelState['chapterSummaries']['milestones']) {
  return Array.from(
    new Map(milestones.map(milestone => [`${milestone.chapterNumber}:${milestone.title}`, milestone])).values(),
  );
}

function dedupeOpenLoops(openLoops: NovelState['openLoops']) {
  return Array.from(
    new Map(openLoops.map(loop => [normalizeLooseKey(loop.description), loop])).values(),
  );
}

function normalizeLooseKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '-');
}

function createOpenLoopId(description: string, chapterNumber: number): string {
  return `${chapterNumber}-${normalizeLooseKey(description).slice(0, 48)}`;
}

function parseEditorResponse(text: string | undefined): z.infer<typeof chapterEditResultSchema> | null {
  if (!text) {
    return null;
  }

  const normalized = stripMarkdownCodeFence(text.trim());

  try {
    const parsed = JSON.parse(normalized);
    const validated = chapterEditResultSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
  } catch {
    // Ignore JSON parse failure and fall back to tag extraction.
  }

  const finalMarkdown = extractTaggedContent(normalized, EDITOR_FINAL_MARKDOWN_TAG);
  const revisionNotes = extractTaggedContent(normalized, EDITOR_REVISION_NOTES_TAG);

  if (!finalMarkdown || !revisionNotes) {
    return null;
  }

  const validated = chapterEditResultSchema.safeParse({
    finalMarkdown,
    revisionNotes,
  });

  return validated.success ? validated.data : null;
}

function stripMarkdownCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json|markdown)?\s*([\s\S]*?)\s*```$/u);
  return fenced?.[1]?.trim() ?? text;
}

function extractTaggedContent(text: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i');
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function ensureChapterHeading(title: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('# ')) {
    return trimmed;
  }

  return `# ${title}\n\n${trimmed}`;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\n*/u, '')
    .replace(/[#>*_`\-\[\]\(\)!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(2, '0');
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
