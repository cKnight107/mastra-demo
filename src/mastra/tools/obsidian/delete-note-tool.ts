import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  deleteFile,
  ensureVaultDirectory,
  getAvailablePath,
  getRelativeVaultPath,
  getVaultPath,
  moveFile,
  readNoteFromVault,
  resolveVaultSubpath,
} from './shared';

export const obsidianDeleteNoteTool = createTool({
  id: 'obsidian-delete-note',
  description: '删除笔记，默认移入 vault/_trash 以便后续恢复；可切换为直接删除。',
  requireApproval: true,
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('相对于 vault 根目录的笔记路径'),
    moveToTrash: z.boolean().default(true).describe('是否移动到 _trash 目录，默认 true'),
  }),
  outputSchema: z.object({
    deleted: z.boolean(),
    destination: z.string().optional(),
  }),
  execute: async ({ relativePath, moveToTrash }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, relativePath);

    if (!moveToTrash) {
      await deleteFile(note.notePath);
      return { deleted: true };
    }

    const trashRelativePath = path.posix.join('_trash', relativePath.split(/[\\/]+/).join('/'));
    const trashPath = await getAvailablePath(resolveVaultSubpath(vaultPath, trashRelativePath));
    await moveFile(note.notePath, trashPath, false);

    return {
      deleted: true,
      destination: getRelativeVaultPath(vaultPath, trashPath),
    };
  },
});
