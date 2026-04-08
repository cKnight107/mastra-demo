import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ensureVaultDirectory,
  getVaultPath,
  listMarkdownNotes,
  parseNote,
} from './shared';

const matchedInSchema = z.enum(['fileName', 'frontmatter', 'content']);

export const obsidianSearchNotesTool = createTool({
  id: 'obsidian-search-notes',
  description: '按关键词搜索 Obsidian 笔记，默认搜索文件名和 frontmatter，可选扩展到正文。注意：即使不搜索正文，仍需读取每个文件以解析 frontmatter，大型 vault 下耗时会随文件数线性增长。',
  inputSchema: z.object({
    query: z.string().min(1).describe('搜索关键词'),
    folder: z.string().optional().describe('限制搜索的目录，留空表示整个 vault'),
    searchContent: z.boolean().default(false).describe('是否扩展到正文全文搜索，可能影响性能'),
    tags: z.array(z.string().min(1)).optional().describe('按标签过滤结果，要求全部匹配'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        relativePath: z.string(),
        fileName: z.string(),
        matchedIn: z.array(matchedInSchema),
        snippet: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ query, folder, searchContent, tags }) => {
    const vaultPath = getVaultPath();
    await ensureVaultDirectory(vaultPath);

    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    const requiredTags = (tags ?? []).map(tag => tag.trim().toLocaleLowerCase('zh-CN'));
    const notes = await listMarkdownNotes(vaultPath, folder ?? '', true);
    const results: Array<{
      relativePath: string;
      fileName: string;
      matchedIn: Array<'fileName' | 'frontmatter' | 'content'>;
      snippet?: string;
    }> = [];

    for (const note of notes) {
      const parsed = parseNote(await readFile(note.absolutePath, 'utf8'));
      const matchedIn = new Set<'fileName' | 'frontmatter' | 'content'>();
      let snippet: string | undefined;

      if (!matchesTags(parsed.frontmatter, requiredTags)) {
        continue;
      }

      if (note.fileName.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) {
        matchedIn.add('fileName');
      }

      const frontmatterText = stringifyFrontmatter(parsed.frontmatter);
      if (frontmatterText.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) {
        matchedIn.add('frontmatter');
        snippet ??= createSnippet(frontmatterText, normalizedQuery);
      }

      if ((searchContent ?? false) && parsed.content.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) {
        matchedIn.add('content');
        snippet ??= createSnippet(parsed.content, normalizedQuery);
      }

      if (matchedIn.size === 0) {
        continue;
      }

      results.push({
        relativePath: note.relativePath,
        fileName: path.basename(note.relativePath),
        matchedIn: [...matchedIn],
        snippet,
      });
    }

    return { results };
  },
});

function matchesTags(frontmatter: Record<string, unknown>, requiredTags: string[]): boolean {
  if (requiredTags.length === 0) {
    return true;
  }

  const tags = frontmatter.tags;
  if (!Array.isArray(tags)) {
    return false;
  }

  const normalizedTags = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.toLocaleLowerCase('zh-CN'));

  return requiredTags.every(tag => normalizedTags.includes(tag));
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${stringifyValue(value)}`)
    .join('\n');
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyValue(item)).join(', ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value ?? '');
}

function createSnippet(source: string, normalizedQuery: string): string {
  const lowerSource = source.toLocaleLowerCase('zh-CN');
  const matchIndex = lowerSource.indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return source.slice(0, 120);
  }

  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(source.length, matchIndex + normalizedQuery.length + 80);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}
