import { createTool } from '@mastra/core/tools';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_STORY_FOLDER = '小说库/短篇';

const inputSchema = z.object({
  title: z.string().min(1).describe('小说标题'),
  content: z.string().min(1).describe('Markdown 正文内容，不包含 frontmatter'),
  folder: z.string().min(1).default(DEFAULT_STORY_FOLDER).describe('相对于 vault 根目录的目标目录'),
  tags: z.array(z.string().min(1)).default(['小说', '短篇', 'AI创作']).describe('写入 frontmatter 的标签'),
  genre: z.string().min(1).optional().describe('题材，例如悬疑、科幻、校园'),
  style: z.string().min(1).optional().describe('文风，例如冷峻、诗性、轻快'),
  summary: z.string().min(1).optional().describe('故事摘要'),
  status: z.string().min(1).default('draft').describe('稿件状态'),
});

const outputSchema = z.object({
  vaultPath: z.string(),
  relativePath: z.string(),
  notePath: z.string(),
  fileName: z.string(),
  savedAt: z.string(),
  obsidianUri: z.string(),
});

export const saveObsidianStoryTool = createTool({
  id: 'save-obsidian-story',
  description: '将短篇小说保存为 Obsidian vault 中的 Markdown 笔记，并自动生成 frontmatter',
  inputSchema,
  outputSchema,
  execute: async ({ title, content, folder, tags, genre, style, summary, status }) => {
    const vaultPath = getVaultPath();
    await ensureDirectory(vaultPath);

    const targetFolder = resolveVaultSubpath(vaultPath, folder);
    await mkdir(targetFolder, { recursive: true });

    const notePath = await getAvailableNotePath(targetFolder, createFileName(title));
    const relativePath = path.relative(vaultPath, notePath).split(path.sep).join('/');
    const savedAt = new Date().toISOString();

    const noteMarkdown = buildStoryNote({
      title,
      content,
      tags,
      genre,
      style,
      summary,
      status,
      savedAt,
    });

    await writeFile(notePath, noteMarkdown, 'utf8');

    return {
      vaultPath,
      relativePath,
      notePath,
      fileName: path.basename(notePath),
      savedAt,
      obsidianUri: `obsidian://open?path=${encodeURIComponent(notePath)}`,
    };
  },
  toModelOutput: output => ({
    type: 'text',
    value: `已保存到 Obsidian：${output.relativePath}`,
  }),
});

function getVaultPath(): string {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultPath) {
    throw new Error('缺少 OBSIDIAN_VAULT_PATH。请在 .env 中配置你的 Obsidian vault 根目录。');
  }

  return path.resolve(vaultPath);
}

async function ensureDirectory(directoryPath: string) {
  const directoryStat = await stat(directoryPath).catch(() => null);
  if (!directoryStat || !directoryStat.isDirectory()) {
    throw new Error(`Obsidian vault 目录不存在或不可访问：${directoryPath}`);
  }
}

function resolveVaultSubpath(vaultPath: string, inputFolder: string): string {
  const segments = inputFolder
    .split(/[\\/]+/)
    .map(segment => sanitizePathSegment(segment))
    .filter(Boolean);

  const resolvedPath = path.resolve(vaultPath, ...segments);
  const normalizedVaultPath = ensureTrailingSeparator(path.resolve(vaultPath));
  const normalizedResolvedPath = ensureTrailingSeparator(resolvedPath);

  if (!normalizedResolvedPath.startsWith(normalizedVaultPath)) {
    throw new Error('目标目录超出了 Obsidian vault 根目录，已拒绝写入。');
  }

  return resolvedPath;
}

async function getAvailableNotePath(folderPath: string, fileName: string): Promise<string> {
  const parsedName = path.parse(fileName);
  let candidatePath = path.join(folderPath, fileName);
  let suffix = 1;

  while (await pathExists(candidatePath)) {
    candidatePath = path.join(folderPath, `${parsedName.name}-${suffix}${parsedName.ext}`);
    suffix += 1;
  }

  return candidatePath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return (await stat(targetPath).catch(() => null)) !== null;
}

function createFileName(title: string): string {
  const datePrefix = formatDate(new Date());
  const safeTitle = sanitizeFileName(title);
  return `${datePrefix}-${safeTitle}.md`;
}

function buildStoryNote(input: {
  title: string;
  content: string;
  tags: string[];
  genre?: string;
  style?: string;
  summary?: string;
  status: string;
  savedAt: string;
}): string {
  const normalizedContent = input.content.trim();
  const body = normalizedContent.startsWith('# ')
    ? normalizedContent
    : `# ${input.title}\n\n${normalizedContent}`;
  const frontmatterLines = [
    '---',
    `title: ${toYamlString(input.title)}`,
    `status: ${toYamlString(input.status)}`,
    `created: ${toYamlString(formatDate(new Date(input.savedAt)))}`,
    `updated: ${toYamlString(input.savedAt)}`,
  ];

  if (input.genre) {
    frontmatterLines.push(`genre: ${toYamlString(input.genre)}`);
  }

  if (input.style) {
    frontmatterLines.push(`style: ${toYamlString(input.style)}`);
  }

  if (input.summary) {
    frontmatterLines.push(`summary: ${toYamlString(input.summary)}`);
  }

  if (input.tags.length > 0) {
    frontmatterLines.push('tags:');
    for (const tag of input.tags) {
      frontmatterLines.push(`  - ${toYamlString(tag)}`);
    }
  }

  frontmatterLines.push('---', '');
  return `${frontmatterLines.join('\n')}${body}\n`;
}

function sanitizePathSegment(segment: string): string {
  const sanitized = segment.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\.+$/g, '');
  return sanitized === '.' || sanitized === '..' ? '' : sanitized;
}

function sanitizeFileName(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'untitled-story';
}

function toYamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function formatDate(value: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(value);
}
