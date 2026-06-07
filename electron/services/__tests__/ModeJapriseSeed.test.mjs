// electron/services/__tests__/ModeJapriseSeed.test.mjs
//
// ADR-005 Phase 2.1, task 4: the user-visible "Japrise" mode seeds the five
// official Japrise parts as editable reference files, which become the retrieval
// corpus for real-time answer assistance. This test verifies (a) the seed bank
// shape, (b) it is wired as the japrise template's reference files, and (c) a
// Japanese query for a given part retrieves that part's file through the real
// lexical retriever (the path runScenario exercises).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/modes/japriseTemplate.js')
).href);
const modesMod = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js')
).href);

const FILES = seed.JAPRISE_REFERENCE_FILES;

describe('ADR-005 P2.1: Japrise seed corpus', () => {
  test('seeds exactly five part files, one per Japrise part', () => {
    assert.equal(FILES.length, 5);
    for (let i = 1; i <= 5; i++) {
      const f = FILES.find(file => file.fileName.startsWith(`Part${i}-`));
      assert.ok(f, `missing Part${i} reference file`);
      assert.ok(f.content.trim().length > 0, `Part${i} content must not be empty`);
    }
  });

  test('TEMPLATE_REFERENCE_FILES.japrise is the five-part question bank', () => {
    assert.deepEqual(modesMod.TEMPLATE_REFERENCE_FILES.japrise, FILES);
  });

  // Each Japanese query should surface its own part's file through the retriever.
  // Queries are phrased close to each part's wording so the lexical-only path
  // (runScenario boots no embedding provider) clears the relevance floor. In
  // production the hybrid path adds e5 vector similarity, which is far more
  // forgiving for loosely-worded queries (see the ADR-005 embedding spike).
  const cases = [
    ['Part3', 'スピーチで三つのポイントを三部構成で展開する', '三部構成'],
    ['Part4', 'このグラフは何を示していますか増減を説明したい', '増加'],
    ['Part5', '店員とのロールプレイで丁寧に依頼する表現', 'していただけますか'],
  ];
  for (const [part, query, phrase] of cases) {
    test(`Japanese ${part} query retrieves the ${part} file from the seeded bank`, () => {
      const mode = makeMode(`mode_japrise_${part}`, 'japrise', '');
      const files = asReferenceFiles(mode.id, FILES);
      const result = runScenario({ mode, files, query });
      assert.ok(result.snippets.length > 0, `${part} query should retrieve at least one snippet`);
      assert.ok(
        result.formattedContext.includes(phrase),
        `Expected ${part} content ("${phrase}") in retrieved context.\n${result.formattedContext.slice(0, 600)}`
      );
    });
  }
});
