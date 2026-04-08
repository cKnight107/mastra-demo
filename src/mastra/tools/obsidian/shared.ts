import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | FrontmatterRecord;

export interface FrontmatterRecord {
  [key: string]: FrontmatterValue;
}

export interface ParsedNote {
  frontmatter: FrontmatterRecord;
  content: string;
  rawContent: string;
}

export interface NoteFile {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  size: number;
}

const frontmatterValueSchema: z.ZodType<FrontmatterValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(frontmatterValueSchema),
    z.record(z.string(), frontmatterValueSchema),
  ]),
);

export const frontmatterRecordSchema: z.ZodType<FrontmatterRecord> = z.record(
  z.string(),
  frontmatterValueSchema,
);

export function getVaultPath(): string {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultPath) {
    throw new Error('缺少 OBSIDIAN_VAULT_PATH。请在 .env 中配置你的 Obsidian vault 根目录。');
  }

  return path.resolve(vaultPath);
}

export async function ensureVaultDirectory(vaultPath: string): Promise<void> {
  const directoryStat = await stat(vaultPath).catch(() => null);
  if (!directoryStat || !directoryStat.isDirectory()) {
    throw new Error(`Obsidian vault 目录不存在或不可访问：${vaultPath}`);
  }
}

export function resolveVaultSubpath(vaultPath: string, inputPath = ''): string {
  const segments = inputPath
    .split(/[\\/]+/)
    .map(segment => sanitizePathSegment(segment))
    .filter(Boolean);

  const resolvedPath = path.resolve(vaultPath, ...segments);
  const normalizedVaultPath = ensureTrailingSeparator(path.resolve(vaultPath));
  const normalizedResolvedPath = ensureTrailingSeparator(resolvedPath);

  if (!normalizedResolvedPath.startsWith(normalizedVaultPath)) {
    throw new Error('目标路径超出了 Obsidian vault 根目录，已拒绝访问。');
  }

  return resolvedPath;
}

export function sanitizePathSegment(segment: string): string {
  const sanitized = segment.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\.+$/g, '');
  return sanitized === '.' || sanitized === '..' ? '' : sanitized;
}

export function sanitizeFileName(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'untitled-note';
}

export function ensureMarkdownExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.md') ? fileName : `${fileName}.md`;
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  return (await getPathStat(targetPath)) !== null;
}

export async function getPathStat(targetPath: string) {
  return await stat(targetPath).catch(() => null);
}

export async function getAvailablePath(targetPath: string): Promise<string> {
  const parsedName = path.parse(targetPath);
  let candidatePath = targetPath;
  let suffix = 1;

  while (await pathExists(candidatePath)) {
    candidatePath = path.join(parsedName.dir, `${parsedName.name}-${suffix}${parsedName.ext}`);
    suffix += 1;
  }

  return candidatePath;
}

export function getRelativeVaultPath(vaultPath: string, targetPath: string): string {
  return path.relative(vaultPath, targetPath).split(path.sep).join('/');
}

export function createObsidianUri(notePath: string): string {
  return `obsidian://open?path=${encodeURIComponent(notePath)}`;
}

export function formatDate(value: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(value);
}

export function parseFrontmatter(input: string): FrontmatterRecord {
  const normalized = normalizeNewlines(input);
  const lines = normalized.split('\n');
  const [parsed] = parseBlock(lines, 0, 0);

  if (parsed && isPlainObject(parsed)) {
    return parsed;
  }

  return {};
}

export function serializeFrontmatter(frontmatter: FrontmatterRecord): string {
  const lines = ['---', ...serializeObject(frontmatter, 0), '---', ''];
  return lines.join('\n');
}

export function parseNote(rawContent: string): ParsedNote {
  const normalized = normalizeNewlines(rawContent);
  if (!normalized.startsWith('---\n')) {
    return {
      frontmatter: {},
      content: normalized,
      rawContent: normalized,
    };
  }

  const lines = normalized.split('\n');
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');

  if (closingIndex === -1) {
    return {
      frontmatter: {},
      content: normalized,
      rawContent: normalized,
    };
  }

  const frontmatterBlock = lines.slice(1, closingIndex).join('\n');
  const content = lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '');

  return {
    frontmatter: parseFrontmatter(frontmatterBlock),
    content,
    rawContent: normalized,
  };
}

export function buildNoteMarkdown(frontmatter: FrontmatterRecord, content: string): string {
  const body = normalizeContent(content);
  const hasFrontmatter = Object.keys(frontmatter).length > 0;
  const frontmatterBlock = hasFrontmatter ? serializeFrontmatter(frontmatter) : '';

  return `${frontmatterBlock}${body}\n`;
}

export async function readNoteFromVault(vaultPath: string, relativePath: string): Promise<ParsedNote & { notePath: string }> {
  const notePath = resolveVaultSubpath(vaultPath, relativePath);
  const noteStat = await stat(notePath).catch(() => null);

  if (!noteStat || !noteStat.isFile()) {
    throw new Error(`笔记不存在：${relativePath}`);
  }

  const rawContent = await readFile(notePath, 'utf8');
  const parsed = parseNote(rawContent);
  return { notePath, ...parsed };
}

export async function writeNoteToVault(notePath: string, frontmatter: FrontmatterRecord, content: string): Promise<void> {
  await ensureParentDirectory(notePath);
  await writeFile(notePath, buildNoteMarkdown(frontmatter, content), 'utf8');
}

export async function listMarkdownNotes(
  vaultPath: string,
  folder = '',
  recursive = true,
): Promise<NoteFile[]> {
  const folderPath = resolveVaultSubpath(vaultPath, folder);
  const folderStat = await stat(folderPath).catch(() => null);

  if (!folderStat || !folderStat.isDirectory()) {
    throw new Error(`目录不存在：${folder || '.'}`);
  }

  const notes: NoteFile[] = [];
  await collectMarkdownNotes(vaultPath, folderPath, recursive, notes);
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN'));
  return notes;
}

export async function moveFile(sourcePath: string, destinationPath: string, overwrite: boolean): Promise<void> {
  await ensureParentDirectory(destinationPath);

  const destinationStat = await getPathStat(destinationPath);
  if (destinationStat?.isDirectory()) {
    throw new Error(`目标路径是目录，不能覆盖：${destinationPath}`);
  }

  if (overwrite && destinationStat) {
    await rm(destinationPath, { force: true, recursive: false });
  }

  await rename(sourcePath, destinationPath);
}

export async function deleteFile(notePath: string): Promise<void> {
  await unlink(notePath);
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function normalizeContent(content: string): string {
  return normalizeNewlines(content).replace(/\s+$/u, '');
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

async function collectMarkdownNotes(
  vaultPath: string,
  folderPath: string,
  recursive: boolean,
  notes: NoteFile[],
): Promise<void> {
  const entries = await readdir(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        await collectMarkdownNotes(vaultPath, entryPath, recursive, notes);
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }

    const entryStat = await stat(entryPath);
    notes.push({
      absolutePath: entryPath,
      relativePath: getRelativeVaultPath(vaultPath, entryPath),
      fileName: entry.name,
      size: entryStat.size,
    });
  }
}

function parseBlock(lines: string[], startIndex: number, indent: number): [FrontmatterValue, number] {
  let index = skipBlankLines(lines, startIndex);
  if (index >= lines.length) {
    return [{}, index];
  }

  const line = lines[index];
  const currentIndent = getIndent(line);
  if (currentIndent < indent) {
    return [{}, index];
  }

  const trimmed = line.slice(currentIndent);
  if (trimmed.startsWith('-')) {
    return parseArray(lines, index, indent);
  }

  return parseObject(lines, index, indent);
}

function parseObject(lines: string[], startIndex: number, indent: number): [FrontmatterRecord, number] {
  const result: FrontmatterRecord = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const currentIndent = getIndent(line);
    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      index += 1;
      continue;
    }

    const trimmed = line.slice(indent);
    if (trimmed.startsWith('-')) {
      break;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      index += 1;
      continue;
    }

    if (remainder.length > 0) {
      result[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    const [nestedValue, nextIndex] = parseBlock(lines, index + 1, indent + 2);
    result[key] = nextIndex === index + 1 ? null : nestedValue;
    index = nextIndex;
  }

  return [result, index];
}

function parseArray(lines: string[], startIndex: number, indent: number): [FrontmatterValue[], number] {
  const result: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const currentIndent = getIndent(line);
    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      index += 1;
      continue;
    }

    const trimmed = line.slice(indent);
    if (!trimmed.startsWith('-')) {
      break;
    }

    const remainder = trimmed.slice(1).trim();
    if (remainder.length > 0) {
      result.push(parseScalar(remainder));
      index += 1;
      continue;
    }

    const [nestedValue, nextIndex] = parseBlock(lines, index + 1, indent + 2);
    result.push(nextIndex === index + 1 ? null : nestedValue);
    index = nextIndex;
  }

  return [result, index];
}

function skipBlankLines(lines: string[], index: number): number {
  let nextIndex = index;
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  return nextIndex;
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function parseScalar(value: string): FrontmatterValue {
  if (value === 'null') {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === '[]') {
    return [];
  }

  if (value === '{}') {
    return {};
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inlineArray = parseInlineArray(value);
    if (inlineArray) {
      return inlineArray;
    }
  }

  if (value.startsWith('{') && value.endsWith('}')) {
    const inlineObject = parseInlineObject(value);
    if (inlineObject) {
      return inlineObject;
    }
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }

  return value;
}

function parseInlineArray(value: string): FrontmatterValue[] | null {
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }

  const segments = splitInlineSegments(inner);
  if (!segments) {
    return null;
  }

  return segments.map(segment => parseScalar(segment));
}

function parseInlineObject(value: string): FrontmatterRecord | null {
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) {
    return {};
  }

  const segments = splitInlineSegments(inner);
  if (!segments) {
    return null;
  }

  const record: FrontmatterRecord = {};
  for (const segment of segments) {
    const keyValue = splitInlineKeyValue(segment);
    if (!keyValue) {
      return null;
    }

    const key = parseInlineKey(keyValue.key);
    if (!key) {
      return null;
    }

    record[key] = parseScalar(keyValue.value);
  }

  return record;
}

function splitInlineSegments(value: string): string[] | null {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      current += char;

      if (quote === "'" && char === "'" && value[index + 1] === "'") {
        current += value[index + 1];
        index += 1;
        continue;
      }

      if (quote === '"' && char === '\\' && index + 1 < value.length) {
        current += value[index + 1];
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length === 0) {
        return null;
      }

      segments.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  if (quote || depth !== 0) {
    return null;
  }

  const lastSegment = current.trim();
  if (lastSegment.length === 0) {
    return null;
  }

  segments.push(lastSegment);
  return segments;
}

function splitInlineKeyValue(value: string): { key: string; value: string } | null {
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (quote === "'" && char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }

      if (quote === '"' && char === '\\' && index + 1 < value.length) {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ']' || char === '}') {
      depth -= 1;
      continue;
    }

    if (char === ':' && depth === 0) {
      const key = value.slice(0, index).trim();
      const parsedValue = value.slice(index + 1).trim();

      if (!key || !parsedValue) {
        return null;
      }

      return { key, value: parsedValue };
    }
  }

  return null;
}

function parseInlineKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const parsed = parseScalar(trimmed);
    return typeof parsed === 'string' ? parsed : null;
  }

  return trimmed;
}

function serializeObject(record: FrontmatterRecord, indent: number): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }

    const prefix = ' '.repeat(indent);
    if (isScalarValue(value)) {
      lines.push(`${prefix}${key}: ${serializeScalar(value)}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`);
        continue;
      }

      lines.push(`${prefix}${key}:`);
      lines.push(...serializeArray(value, indent + 2));
      continue;
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
      lines.push(`${prefix}${key}: {}`);
      continue;
    }

    lines.push(`${prefix}${key}:`);
    lines.push(...serializeObject(value, indent + 2));
  }

  return lines;
}

function serializeArray(values: FrontmatterValue[], indent: number): string[] {
  const lines: string[] = [];
  const prefix = ' '.repeat(indent);

  for (const value of values) {
    if (isScalarValue(value)) {
      lines.push(`${prefix}- ${serializeScalar(value)}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}- []`);
        continue;
      }

      lines.push(`${prefix}-`);
      lines.push(...serializeArray(value, indent + 2));
      continue;
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
      lines.push(`${prefix}- {}`);
      continue;
    }

    lines.push(`${prefix}-`);
    lines.push(...serializeObject(value, indent + 2));
  }

  return lines;
}

function serializeScalar(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function isScalarValue(value: FrontmatterValue): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPlainObject(value: FrontmatterValue): value is FrontmatterRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
