import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ensureVaultDirectory,
  getVaultPath,
  readNoteFromVault,
  writeNoteToVault,
} from './shared';

export const obsidianAppendNoteTool = createTool({
  id: 'obsidian-append-note',
  description: '在笔记正文末尾追加内容，并同步更新 frontmatter.updated。',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('相对于 vault 根目录的笔记路径'),
    content: z.string().min(1).describe('要追加的 Markdown 内容'),
    separator: z.string().default('\n\n').describe('正文与追加内容之间的分隔符'),
  }),
  outputSchema: z.object({
    relativePath: z.string(),
    appendedAt: z.string(),
    newLength: z.number(),
  }),
  execute: async ({ relativePath, content, separator }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, relativePath);
    const appendedAt = new Date().toISOString();
    const nextContent = note.content ? `${note.content}${separator}${content}` : content;

    await writeNoteToVault(
      note.notePath,
      {
        ...note.frontmatter,
        updated: appendedAt,
      },
      nextContent,
    );

    return {
      relativePath,
      appendedAt,
      newLength: nextContent.length,
    };
  },
});
