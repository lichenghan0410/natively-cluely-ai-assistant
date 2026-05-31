import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function importDist(relPath) {
  return import(pathToFileURL(path.join(root, 'dist-electron', relPath)).href);
}

test('filters Japanese thanks-for-watching hallucination', async () => {
  const { filterHallucination } = await importDist('electron/audio/whisper/hallucinationFilter.js');

  assert.equal(filterHallucination('ご視聴ありがとうございました'), '');
});
