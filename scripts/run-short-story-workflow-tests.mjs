import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'short-story-workflow-tests-'));
const bundlePath = path.join(tempDir, 'validate-short-story-workflow.cjs');
const esbuildPath = path.join(rootDir, 'node_modules', '.bin', 'esbuild');

execFileSync(
  esbuildPath,
  [
    path.join('scripts', 'validate-short-story-workflow.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${bundlePath}`,
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

execFileSync(process.execPath, [bundlePath], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});
