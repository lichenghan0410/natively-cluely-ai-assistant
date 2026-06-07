// electron/services/__tests__/ModeJapaneseRetrieval.test.mjs
//
// Regression for ADR-005 Phase 2.1 blocker: the retriever's wordsOf() used
// `[^a-z0-9\s-]` cleaning + a length>2 filter, which dropped EVERY Japanese
// character. A pure-Japanese query therefore tokenized to zero tokens, hit the
// `queryWords.size === 0` short-circuit in retrieve(), and returned an EMPTY
// result before vector search could run — so Modes retrieval contributed
// nothing for Japanese input (which is the product's primary language).
//
// The fix: wordsOf() now NFKC-normalizes, keeps the existing Latin behavior,
// and additionally tokenizes CJK runs into character bigrams (unioned with
// Latin tokens). Query and chunk share one bigram vocabulary, so the lexical
// half scores Japanese correctly and the zero-token short-circuit no longer
// fires for content-bearing Japanese.
//
// Exercised via ModeContextRetriever (the sync lexical path runScenario uses);
// it shares wordsOf with ModeHybridRetriever per the lock-step comment.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';

describe('ADR-005 P2.1: Japanese query retrieves from reference files (no empty short-circuit)', () => {
  test('Pure-Japanese query matches a Japanese note and returns a non-empty snippet', () => {
    const mode = makeMode('mode_ja_polite', 'role-play', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'keigo.md',
      content: 'ていねいに依頼する表現。お願いできますか、恐れ入りますが、していただけますか。',
    }]);
    const result = runScenario({
      mode,
      files,
      query: 'ていねいに依頼する言い方を教えて',
    });
    assert.ok(
      result.snippets.length > 0,
      'Pure-Japanese query must retrieve at least one snippet after the CJK-bigram fix (previously short-circuited to empty)'
    );
    assert.ok(
      result.formattedContext.includes('恐れ入りますが'),
      `Expected the Japanese keigo note in the retrieved context.\nHaystack:\n${result.formattedContext.slice(0, 800)}`
    );
  });

  test('Japrise Part3 key-point query matches a structured Japanese note', () => {
    const mode = makeMode('mode_ja_speech', 'speech', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'speech.md',
      content: 'スピーチは序論・本論・結論の三部構成にし、本論で三つのポイントを一つずつ展開する。',
    }]);
    const result = runScenario({
      mode,
      files,
      query: 'スピーチで三つのポイントを展開する構成を教えて',
    });
    assert.ok(
      result.snippets.length > 0,
      'Japanese speech-structure query must retrieve the structured note'
    );
  });

  test('Negative guard: punctuation-only query still returns empty (short-circuit intact for contentless input)', () => {
    const mode = makeMode('mode_ja_empty', 'general', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'note.md',
      content: 'ていねいに依頼する表現。',
    }]);
    const result = runScenario({
      mode,
      files,
      query: '。、？！',
    });
    assert.equal(
      result.snippets.length, 0,
      'Contentless punctuation-only query (zero tokens) must still short-circuit to empty'
    );
  });

  test('Regression: English query still matches an English note (Latin path unchanged)', () => {
    const mode = makeMode('mode_en_regress', 'general', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'note.md',
      content: 'The rollback drill runs every Thursday before the production deploy is approved.',
    }]);
    const result = runScenario({
      mode,
      files,
      query: 'rollback drill Thursday production deploy approved',
    });
    assert.ok(
      result.snippets.length > 0,
      'English/Latin matching must be unchanged after the NFKC + CJK-bigram fix'
    );
  });
});
