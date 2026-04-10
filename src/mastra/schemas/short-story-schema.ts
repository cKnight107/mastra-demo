import { z } from 'zod';

export const storyLanguageSchema = z.enum(['zh-CN', 'en']);

export const storyExportProfileSchema = z.enum(['minimal', 'authoring']);

export const storyRequestSchema = z.object({
  projectSlug: z.string().min(1).describe('项目目录 slug'),
  language: storyLanguageSchema.default('zh-CN'),
  premise: z.string().min(1).describe('故事 premise'),
  genre: z.string().min(1).describe('题材'),
  tone: z.string().min(1).describe('整体语气'),
  pov: z.string().min(1).optional().describe('叙事视角'),
  targetWords: z.number().int().positive().describe('目标字数'),
  endingStyle: z.string().min(1).optional().describe('结局风格'),
  mustInclude: z.array(z.string().min(1)).default([]).describe('必须包含的元素'),
  mustAvoid: z.array(z.string().min(1)).default([]).describe('必须避免的元素'),
  referenceNotes: z.array(z.string().min(1)).default([]).describe('Obsidian 参考笔记相对路径'),
  exportProfile: storyExportProfileSchema.default('authoring'),
});

export const storyCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  motivation: z.string().min(1),
  secret: z.string().min(1).optional(),
});

export const storyBeatSchema = z.object({
  order: z.number().int().positive(),
  summary: z.string().min(1),
});

export const outlineSchema = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  theme: z.string().min(1),
  characters: z.array(storyCharacterSchema),
  beats: z.array(storyBeatSchema),
  endingDesign: z.string().min(1),
  titleCandidates: z.array(z.string().min(1)),
});

export const warningListSchema = z.array(z.string());

export const loadedReferenceNoteSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  content: z.string().min(1),
});

export const normalizedStoryRequestSchema = z.object({
  request: storyRequestSchema,
  normalizedProjectSlug: z.string().min(1),
  projectDir: z.string().min(1),
  createdAt: z.string().min(1),
  warnings: warningListSchema,
});

export const storyReferenceContextSchema = normalizedStoryRequestSchema.extend({
  referenceArtifacts: z.array(loadedReferenceNoteSchema),
  referenceContext: z.string(),
});

export const storyPlanningContextSchema = storyReferenceContextSchema.extend({
  outline: outlineSchema,
});

export const storyDraftContextSchema = storyPlanningContextSchema.extend({
  draftMarkdown: z.string().min(1),
});

export const storyEditResultSchema = z.object({
  finalMarkdown: z.string().min(1),
  revisionNotes: z.string().min(1),
});

export const storyEditContextSchema = storyDraftContextSchema.extend({
  editResult: storyEditResultSchema,
});

export const storySummarySchema = z.object({
  logline: z.string().min(1),
  spoilerFreeSummary: z.string().min(1),
  fullSummary: z.string().min(1),
  tags: z.array(z.string().min(1)),
});

export const storySummaryStepOutputSchema = z.object({
  summary: storySummarySchema,
  warnings: warningListSchema,
});

export const storyMetadataSchema = z.object({
  title: z.string().min(1),
  projectDir: z.string().min(1),
  primaryFile: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: z.string().min(1),
  genre: z.string().min(1),
  tone: z.string().min(1),
  pov: z.string().nullable(),
  language: storyLanguageSchema,
  exportProfile: storyExportProfileSchema,
  targetWords: z.number().int().positive(),
  actualWords: z.number().int().nonnegative(),
  endingStyle: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  modelPlan: z.string().min(1),
  modelDraft: z.string().min(1),
  modelEdit: z.string().min(1),
  modelSummary: z.string().min(1),
  logline: z.string().min(1),
});

export const storyMetadataStepOutputSchema = z.object({
  metadata: storyMetadataSchema,
});

export const artifactFileSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
});

export const vaultWriteResultSchema = z.object({
  projectDir: z.string().min(1),
  title: z.string().min(1),
  primaryFile: z.string().min(1),
  files: z.array(artifactFileSchema),
  wordCount: z.number().int().nonnegative(),
  warnings: warningListSchema,
});

export const artifactManifestSchema = z.object({
  projectDir: z.string().min(1),
  title: z.string().min(1),
  primaryFile: z.string().min(1),
  files: z.array(artifactFileSchema),
  stats: z.object({
    wordCount: z.number().int().nonnegative(),
  }),
  warnings: warningListSchema.default([]),
});

export const storyWorkflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'failed',
  'tripwire',
  'suspended',
  'waiting',
  'canceled',
  'bailed',
  'paused',
]);

export const storyWorkflowRunLookupSchema = z.object({
  runId: z.string().min(1).describe('workflow runId'),
});

export const launchStoryWorkflowResultSchema = z.object({
  runId: z.string().min(1),
  status: z.literal('pending'),
  projectSlug: z.string().min(1),
  message: z.string().min(1),
});

export const storyWorkflowRunQueryResultSchema = z.object({
  runId: z.string().min(1),
  found: z.boolean(),
  status: storyWorkflowRunStatusSchema.nullable(),
  manifest: artifactManifestSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export type StoryRequest = z.infer<typeof storyRequestSchema>;
export type StoryOutline = z.infer<typeof outlineSchema>;
export type StorySummary = z.infer<typeof storySummarySchema>;
export type StoryMetadata = z.infer<typeof storyMetadataSchema>;
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
