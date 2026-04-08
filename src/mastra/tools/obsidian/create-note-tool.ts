import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  createObsidianUri,
  ensureMarkdownExtension,
  ensureVaultDirectory,
  formatDate,
  type FrontmatterRecord,
  frontmatterRecordSchema,
  getAvailablePath,
  getRelativeVaultPath,
  getVaultPath,
  resolveVaultSubpath,
  sanitizeFileName,
  writeNoteToVault,
} from './shared';

export const obsidianCreateNoteTool = createTool({
  id: 'obsidian-create-note',
  description: '创建通用 Obsidian Markdown 笔记，并写入标准 frontmatter。',
  inputSchema: z.object({
    title: z.string().min(1).describe('笔记标题'),
    content: z.string().min(1).describe('Markdown 正文，不包含 frontmatter'),
    folder: z.string().default('').describe('相对于 vault 根目录的目标目录'),
    tags: z.array(z.string().min(1)).default([]).describe('frontmatter.tags 中写入的标签'),
    frontmatter: frontmatterRecordSchema.default({}).describe('附加的 frontmatter 字段'),
  }),
  outputSchema: z.object({
    relativePath: z.string(),
    notePath: z.string(),
    fileName: z.string(),
    obsidianUri: z.string(),
  }),
  execute: async ({ title, content, folder, tags, frontmatter }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const folderPath = resolveVaultSubpath(vaultPath, folder ?? '');
    const fileName = ensureMarkdownExtension(sanitizeFileName(title));
    const notePath = await getAvailablePath(path.join(folderPath, fileName));
    const now = new Date();
    const savedAt = formatDate(now);
    const extraFrontmatter = (frontmatter ?? {}) as FrontmatterRecord;

    await writeNoteToVault(
      notePath,
      {
        ...extraFrontmatter,
        title,
        tags: tags ?? [],
        created: formatDate(now),
        updated: savedAt,
      },
      content,
    );

    return {
      relativePath: getRelativeVaultPath(vaultPath, notePath),
      notePath,
      fileName: path.basename(notePath),
      obsidianUri: createObsidianUri(notePath),
    };
  },
});
