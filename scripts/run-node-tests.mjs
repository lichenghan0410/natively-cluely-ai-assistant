#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const testDirs = [
  path.join(root, 'electron', 'services', '__tests__'),
  path.join(root, 'electron', 'llm', '__tests__'),
];

function listTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => path.join(dir, entry.name))
    .sort();
}

const files = testDirs.flatMap(listTests);
if (files.length === 0) {
  console.error('[run-node-tests] No .test.mjs files found.');
  process.exit(1);
}

console.log(`[run-node-tests] Running ${files.length} test files.`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status ?? 1);
