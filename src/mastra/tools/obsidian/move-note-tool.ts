import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ensureVaultDirectory,
  getPathStat,
  getRelativeVaultPath,
  getVaultPath,
  moveFile,
  readNoteFromVault,
  resolveVaultSubpath,
} from './shared';

export const obsidianMoveNoteTool = createTool({
  id: 'obsidian-move-note',
  description: '移动或重命名笔记，不会自动修复 vault 内的 wikilink。',
  requireApproval: true,
  inputSchema: z.object({
    sourcePath: z.string().min(1).describe('原始相对路径'),
    destinationPath: z.string().min(1).describe('新的相对路径'),
    overwrite: z.boolean().default(false).describe('目标已存在时是否覆盖'),
  }),
  outputSchema: z.object({
    oldPath: z.string(),
    newPath: z.string(),
    movedAt: z.string(),
  }),
  execute: async ({ sourcePath, destinationPath, overwrite }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const note = await readNoteFromVault(vaultPath, sourcePath);
    const targetPath = resolveVaultSubpath(vaultPath, destinationPath);
    const targetStat = await getPathStat(targetPath);

    if (targetStat?.isDirectory()) {
      throw new Error(`destinationPath 必须是笔记文件路径，不能指向目录：${destinationPath}`);
    }

    if (!(overwrite ?? false) && targetStat) {
      throw new Error(`目标路径已存在：${destinationPath}`);
    }

    await moveFile(note.notePath, targetPath, overwrite ?? false);
    return {
      oldPath: sourcePath,
      newPath: getRelativeVaultPath(vaultPath, targetPath),
      movedAt: new Date().toISOString(),
    };
  },
});
