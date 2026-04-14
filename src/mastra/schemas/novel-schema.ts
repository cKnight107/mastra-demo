import { z } from 'zod';

export const novelLanguageSchema = z.enum(['zh-CN', 'en']);

export const chapterDependencyModeSchema = z.enum(['standalone', 'sequential']);

export const continuitySeveritySchema = z.enum(['warning', 'error']);

export const warningListSchema = z.array(z.string());

export const novelRequestSchema = z.object({
  projectSlug: z.string().min(1).describe('项目目录 slug'),
  language: novelLanguageSchema.default('zh-CN'),
  premise: z.string().min(1).describe('故事 premise'),
  genre: z.string().min(1).describe('题材'),
  tone: z.string().min(1).describe('整体语气'),
  pov: z.string().min(1).optional().describe('叙事视角'),
  targetWords: z.number().int().positive().describe('目标总字数'),
  endingStyle: z.string().min(1).optional().describe('结局风格'),
  mustInclude: z.array(z.string().min(1)).default([]).describe('必须包含的元素'),
  mustAvoid: z.array(z.string().min(1)).default([]).describe('必须避免的元素'),
  referenceNotes: z.array(z.string().min(1)).default([]).describe('Obsidian 参考笔记相对路径'),
  suspendAfterBible: z.boolean().default(false).describe('是否在 story bible 完成后暂停'),
  suspendAfterChapterPlan: z.boolean().default(false).describe('是否在章节规划完成后暂停'),
});

export const loadedReferenceNoteSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  content: z.string().min(1),
});

export const novelCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  arc: z.string().min(1),
  desire: z.string().min(1),
  fear: z.string().min(1).optional(),
  relationships: z.array(z.string().min(1)).default([]),
});

export const storyRuleSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
});

export const actBeatSchema = z.object({
  order: z.number().int().positive(),
  summary: z.string().min(1),
});

export const storyBibleSchema = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  theme: z.string().min(1),
  premiseFocus: z.string().min(1),
  world: z.string().min(1),
  setting: z.string().min(1),
  characters: z.array(novelCharacterSchema),
  narrativeRules: z.array(storyRuleSchema).default([]),
  styleGuide: z.array(z.string().min(1)).default([]),
  chapterStyleRules: z.array(z.string().min(1)).default([]),
  majorConflicts: z.array(z.string().min(1)).default([]),
  motifs: z.array(z.string().min(1)).default([]),
  endingDesign: z.string().min(1),
});

export const storyBibleBundleSchema = z.object({
  full: storyBibleSchema,
  compact: z.string().min(1),
});

export const actPlanSchema = z.object({
  structure: z.string().min(1),
  acts: z.array(
    z.object({
      name: z.string().min(1),
      objective: z.string().min(1),
      turningPoints: z.array(actBeatSchema).default([]),
    }),
  ),
});

export const chapterBriefSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  synopsis: z.string().min(1),
  dependencyMode: chapterDependencyModeSchema,
  mustReadChapters: z.array(z.number().int().positive()).default([]),
  keyEvents: z.array(z.string().min(1)).default([]),
  openLoopsToResolve: z.array(z.string().min(1)).default([]),
  openLoopsToIntroduce: z.array(z.string().min(1)).default([]),
  targetWordCount: z.number().int().positive().optional(),
});

export const timelineEntrySchema = z.object({
  chapterNumber: z.number().int().positive(),
  order: z.number().int().positive(),
  timeMarker: z.string().min(1),
  event: z.string().min(1),
  location: z.string().min(1),
  participants: z.array(z.string().min(1)).default([]),
});

export const openLoopSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  introducedInChapter: z.number().int().positive(),
  status: z.enum(['open', 'resolved']),
  resolvedInChapter: z.number().int().positive().nullable(),
});

export const continuityFindingSchema = z.object({
  severity: continuitySeveritySchema,
  category: z.string().min(1),
  issue: z.string().min(1),
  evidence: z.string().min(1),
  suggestedFix: z.string().min(1),
});

export const continuityReportSchema = z.object({
  checked: z.boolean(),
  chapterNumber: z.number().int().positive(),
  summary: z.string().min(1),
  searchedQueries: z.array(z.string().min(1)).default([]),
  findings: z.array(continuityFindingSchema).default([]),
});

export const milestoneSummarySchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  significance: z.string().min(1),
});

export const chapterSummarySchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().min(1),
  spoilerFreeSummary: z.string().min(1),
  keyEvents: z.array(z.string().min(1)).default([]),
  characters: z.array(z.string().min(1)).default([]),
  locations: z.array(z.string().min(1)).default([]),
  props: z.array(z.string().min(1)).default([]),
  milestone: milestoneSummarySchema.nullable(),
  openLoopsOpened: z.array(z.string().min(1)).default([]),
  openLoopsClosed: z.array(z.string().min(1)).default([]),
  timeline: z.array(timelineEntrySchema).default([]),
});

export const fileManifestEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
});

export const chapterEditResultSchema = z.object({
  finalMarkdown: z.string().min(1),
  revisionNotes: z.string().min(1),
});

export const chapterFileWriteSchema = z.object({
  briefPath: z.string().min(1),
  finalPath: z.string().min(1),
});

export const chapterResultSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  briefPath: z.string().min(1),
  finalPath: z.string().min(1),
  finalMarkdown: z.string().min(1),
  revisionNotes: z.string().min(1),
  summary: chapterSummarySchema,
  continuityReport: continuityReportSchema.nullable(),
  warnings: warningListSchema,
});

export const chapterSummariesStateSchema = z.object({
  recent: z.array(chapterSummarySchema),
  compressed: z.string(),
  milestones: z.array(milestoneSummarySchema),
});

export const novelStateSchema = z.object({
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  storyBible: storyBibleBundleSchema,
  actPlan: actPlanSchema,
  chapterPlan: z.array(chapterBriefSchema),
  currentChapter: z.number().int().nonnegative(),
  chapterSummaries: chapterSummariesStateSchema,
  openLoops: z.array(openLoopSchema),
  continuityNotes: z.array(z.string()),
  timeline: z.array(timelineEntrySchema),
  fileManifest: z.array(fileManifestEntrySchema),
});

export const novelRuntimeStateSchema = novelStateSchema.partial().default({});

export const normalizedNovelRequestSchema = z.object({
  request: novelRequestSchema,
  normalizedProjectSlug: z.string().min(1),
  projectDir: z.string().min(1),
  createdAt: z.string().min(1),
  warnings: warningListSchema,
});

export const storyBibleStepOutputSchema = normalizedNovelRequestSchema.extend({
  title: z.string().min(1),
  storyBible: storyBibleBundleSchema,
  actPlan: actPlanSchema,
  referenceArtifacts: z.array(loadedReferenceNoteSchema),
  referenceContext: z.string(),
});

export const chapterPlanStepOutputSchema = storyBibleStepOutputSchema.extend({
  chapterPlan: z.array(chapterBriefSchema),
});

export const chapterExecutionInputSchema = z.object({
  brief: chapterBriefSchema,
  title: z.string().min(1),
  projectDir: z.string().min(1),
  chapterCount: z.number().int().positive(),
  request: novelRequestSchema,
});

export const chapterContextSchema = chapterExecutionInputSchema.extend({
  briefMarkdown: z.string().min(1),
  storyBibleCompact: z.string().min(1),
  historyContext: z.string(),
  requiredChapterContext: z.string(),
  warnings: warningListSchema,
});

export const chapterDraftContextSchema = chapterContextSchema.extend({
  draftMarkdown: z.string().min(1),
});

export const chapterEditContextSchema = chapterDraftContextSchema.extend({
  editResult: chapterEditResultSchema,
});

export const chapterContinuityContextSchema = chapterEditContextSchema.extend({
  continuityReport: continuityReportSchema.nullable(),
});

export const chapterSummaryContextSchema = chapterContinuityContextSchema.extend({
  summary: chapterSummarySchema,
});

export const chapterWriteContextSchema = chapterSummaryContextSchema.extend({
  files: chapterFileWriteSchema,
});

export const bookSummariesSchema = z.object({
  spoilerFreeSummary: z.string().min(1),
  fullSummary: z.string().min(1),
  hook: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
});

export const novelMetadataSchema = z.object({
  title: z.string().min(1),
  projectDir: z.string().min(1),
  primaryFile: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: z.string().min(1),
  language: novelLanguageSchema,
  genre: z.string().min(1),
  tone: z.string().min(1),
  pov: z.string().nullable(),
  targetWords: z.number().int().positive(),
  actualWords: z.number().int().nonnegative(),
  chapterCount: z.number().int().positive(),
  endingStyle: z.string().nullable(),
  modelPlan: z.string().min(1),
  modelDraft: z.string().min(1),
  modelEdit: z.string().min(1),
  modelContinuity: z.string().min(1),
  modelSummary: z.string().min(1),
  tags: z.array(z.string().min(1)),
});

export const compiledNovelContextSchema = z.object({
  request: novelRequestSchema,
  normalizedProjectSlug: z.string().min(1),
  projectDir: z.string().min(1),
  createdAt: z.string().min(1),
  title: z.string().min(1),
  chapterResults: z.array(chapterResultSchema),
  manuscriptMarkdown: z.string().min(1),
  revisionLogMarkdown: z.string().min(1),
  warnings: warningListSchema,
});

export const buildMetadataStepOutputSchema = z.object({
  metadata: novelMetadataSchema,
});

export const buildIndexStepOutputSchema = z.object({
  indexMarkdown: z.string().min(1),
});

export const buildBookSummariesStepOutputSchema = z.object({
  summaries: bookSummariesSchema,
});

export const writeVaultArtifactsResultSchema = z.object({
  projectDir: z.string().min(1),
  title: z.string().min(1),
  primaryFile: z.string().min(1),
  files: z.array(fileManifestEntrySchema),
  wordCount: z.number().int().nonnegative(),
  warnings: warningListSchema,
});

export const novelManifestSchema = z.object({
  projectDir: z.string().min(1),
  title: z.string().min(1),
  primaryFile: z.string().min(1),
  files: z.array(fileManifestEntrySchema),
  stats: z.object({
    wordCount: z.number().int().nonnegative(),
    chapterCount: z.number().int().positive(),
  }),
  warnings: warningListSchema,
});

export type NovelRequest = z.infer<typeof novelRequestSchema>;
export type StoryBible = z.infer<typeof storyBibleSchema>;
export type StoryBibleBundle = z.infer<typeof storyBibleBundleSchema>;
export type ActPlan = z.infer<typeof actPlanSchema>;
export type ChapterBrief = z.infer<typeof chapterBriefSchema>;
export type ContinuityReport = z.infer<typeof continuityReportSchema>;
export type ChapterSummary = z.infer<typeof chapterSummarySchema>;
export type NovelState = z.infer<typeof novelStateSchema>;
export type ChapterResult = z.infer<typeof chapterResultSchema>;
export type BookSummaries = z.infer<typeof bookSummariesSchema>;
export type NovelMetadata = z.infer<typeof novelMetadataSchema>;
export type NovelManifest = z.infer<typeof novelManifestSchema>;
