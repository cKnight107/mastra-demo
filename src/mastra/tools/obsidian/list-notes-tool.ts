import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ensureVaultDirectory, getVaultPath, listMarkdownNotes } from './shared';

export const obsidianListNotesTool = createTool({
  id: 'obsidian-list-notes',
  description: '列出指定目录下的 Markdown 笔记，可选递归遍历子目录。',
  inputSchema: z.object({
    folder: z.string().default('').describe('相对于 Obsidian vault 根目录的目录路径，留空表示根目录'),
    recursive: z.boolean().default(true).describe('是否递归遍历子目录'),
  }),
  outputSchema: z.object({
    notes: z.array(
      z.object({
        relativePath: z.string(),
        fileName: z.string(),
        size: z.number(),
      }),
    ),
  }),
  execute: async ({ folder, recursive }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const notes = await listMarkdownNotes(vaultPath, folder, recursive);
    return {
      notes: notes.map(note => ({
        relativePath: note.relativePath,
        fileName: note.fileName,
        size: note.size,
      })),
    };
  },
});
