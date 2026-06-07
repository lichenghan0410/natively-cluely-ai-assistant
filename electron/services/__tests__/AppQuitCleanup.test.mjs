import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');

test('before-quit synchronously tears down active audio and STT providers', () => {
  const methodStart = source.indexOf('public cleanupAudioPipelineForQuit');
  assert.ok(methodStart >= 0, 'AppState should expose a quit-time audio cleanup method');

  const method = source.slice(methodStart, methodStart + 1600);
  assert.match(method, /this\.systemAudioCapture\?\.stop\(\)/);
  assert.match(method, /this\.microphoneCapture\?\.stop\(\)/);
  assert.match(method, /this\.googleSTT\?\.stop\(\)/);
  assert.match(method, /this\.googleSTT_User\?\.stop\(\)/);
  assert.match(method, /dispose\?\.\(\)/);

  const beforeQuit = source.slice(source.indexOf('app.on("before-quit"'), source.indexOf('// app.dock?.hide()'));
  assert.match(beforeQuit, /appState\.cleanupAudioPipelineForQuit\(\)/);
});
