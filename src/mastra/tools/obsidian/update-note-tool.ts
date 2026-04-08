import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ensureVaultDirectory,
  frontmatterRecordSchema,
  getVaultPath,
  readNoteFromVault,
  writeNoteToVault,
} from './shared';

export const obsidianUpdateNoteTool = createTool({
  id: 'obsidian-update-note',
  description: '替换已有笔记的正文内容，并更新 frontmatter.updated 字段。',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('相对于 vault 根目录的笔记路径'),
    content: z.string().describe('新的 Markdown 正文'),
    mergeFrontmatter: frontmatterRecordSchema.optional().describe('需要合并进 frontmatter 的附加字段'),
  }),
  outputSchema: z.object({
    relativePath: z.string(),
    updatedAt: z.string(),
  }),
  execute: async ({ relativePath, content, mergeFrontmatter }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, relativePath);
    const updatedAt = new Date().toISOString();

    await writeNoteToVault(
      note.notePath,
      {
        ...note.frontmatter,
        ...(mergeFrontmatter ?? {}),
        updated: updatedAt,
      },
      content,
    );

    return {
      relativePath,
      updatedAt,
    };
  },
});
