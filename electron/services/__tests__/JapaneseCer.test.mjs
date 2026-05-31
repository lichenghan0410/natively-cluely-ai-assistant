import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function importDist(relPath) {
  return import(pathToFileURL(path.join(root, 'dist-electron', relPath)).href);
}

test('Japanese acceptance CER ignores width, punctuation, whitespace, and kana-kanji spelling variants', async () => {
  const { computeJapaneseAcceptanceCer } = await importDist('electron/audio/whisper/japaneseCer.js');

  const score = computeJapaneseAcceptanceCer(
    '家から会社までどうやって行きますか',
    ' 家から会社まで どうやって いきますか？ ',
  );

  assert.equal(score.cerPct, 0);
  assert.equal(score.editDistance, 0);
});

test('Japanese acceptance CER reports kana output when reference prefers kanji', async () => {
  const { computeJapaneseAcceptanceCer } = await importDist('electron/audio/whisper/japaneseCer.js');

  const score = computeJapaneseAcceptanceCer(
    '家から会社までどうやって行きますか',
    'いえからかいしゃまでどうやっていきますか',
  );

  assert.equal(score.cerPct, 0);
  assert.ok(score.orthographyWarnings.length >= 3);
  assert.deepEqual(
    score.orthographyWarnings.map(w => w.preferred),
    ['家', '会社', '行きます'],
  );
});

test('Japanese acceptance CER ignores okurigana spelling variants', async () => {
  const { computeJapaneseAcceptanceCer } = await importDist('electron/audio/whisper/japaneseCer.js');

  const score = computeJapaneseAcceptanceCer(
    'A社の商品売り上げの変化',
    'A社の商品売上げの変化',
  );

  assert.equal(score.cerPct, 0);
});

test('Japanese acceptance CER still counts homophone kanji substitutions', async () => {
  const { computeJapaneseAcceptanceCer } = await importDist('electron/audio/whisper/japaneseCer.js');

  const score = computeJapaneseAcceptanceCer(
    'あなたの国に支店を作ろう',
    'あなたの国に視点を作ろう',
  );

  assert.ok(score.editDistance > 0);
});
