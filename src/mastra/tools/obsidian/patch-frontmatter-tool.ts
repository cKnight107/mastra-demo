import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ensureVaultDirectory,
  type FrontmatterRecord,
  frontmatterRecordSchema,
  getVaultPath,
  readNoteFromVault,
  writeNoteToVault,
} from './shared';

export const obsidianPatchFrontmatterTool = createTool({
  id: 'obsidian-patch-frontmatter',
  description: '仅更新指定 frontmatter 字段，不修改正文内容。',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('相对于 vault 根目录的笔记路径'),
    fields: frontmatterRecordSchema.describe('要写入或覆盖的 frontmatter 字段'),
  }),
  outputSchema: z.object({
    relativePath: z.string(),
    updatedFields: z.array(z.string()),
    updatedAt: z.string(),
  }),
  execute: async ({ relativePath, fields }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, relativePath);
    const updatedAt = new Date().toISOString();
    const patchFields = fields as FrontmatterRecord;

    await writeNoteToVault(
      note.notePath,
      {
        ...note.frontmatter,
        ...patchFields,
        updated: updatedAt,
      },
      note.content,
    );

    return {
      relativePath,
      updatedFields: Object.keys(patchFields),
      updatedAt,
    };
  },
});
