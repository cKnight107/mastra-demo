import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ensureVaultDirectory, frontmatterRecordSchema, getVaultPath, readNoteFromVault } from './shared';

export const obsidianReadNoteTool = createTool({
  id: 'obsidian-read-note',
  description: '按 vault 相对路径读取 Obsidian 笔记，返回 frontmatter、正文和原始 Markdown。',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('相对于 Obsidian vault 根目录的笔记路径'),
  }),
  outputSchema: z.object({
    relativePath: z.string(),
    notePath: z.string(),
    content: z.string(),
    frontmatter: frontmatterRecordSchema,
    rawContent: z.string(),
  }),
  execute: async ({ relativePath }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, relativePath);
    return {
      relativePath,
      notePath: note.notePath,
      content: note.content,
      frontmatter: note.frontmatter,
      rawContent: note.rawContent,
    };
  },
});
