// electron/llm/__tests__/GenerativeAssistGate.test.mjs
//
// ADR-005 Phase 2.3: the global generative-assist (privacy) toggle. When off,
// WhatToAnswerLLM must stay local — emit a short notice and NEVER call
// streamChat (which is what would send the transcript to the cloud generator).
// Also covers the SettingsManager default (enabled unless explicitly false).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distBase = path.resolve(__dirname, '../../../dist-electron/electron');

const sm = require(path.join(distBase, 'services/SettingsManager.js'));

describe('ADR-005 P2.3: SettingsManager generative-assist default', () => {
  test('defaults to enabled (true) unless explicitly set to false', () => {
    const probe = Object.create(sm.SettingsManager.prototype);
    probe.settings = {};
    assert.equal(probe.getGenerativeAssistEnabled(), true, 'absent → enabled');
    probe.settings = { generativeAssistEnabled: true };
    assert.equal(probe.getGenerativeAssistEnabled(), true);
    probe.settings = { generativeAssistEnabled: false };
    assert.equal(probe.getGenerativeAssistEnabled(), false, 'explicit false → disabled');
  });
});

// Integration: drive WhatToAnswerLLM with the gate disabled. Guarded because the
// module pulls heavy deps; if it can't load in this environment, skip rather than fail.
let WhatToAnswerLLM = null;
try {
  ({ WhatToAnswerLLM } = require(path.join(distBase, 'llm/WhatToAnswerLLM.js')));
} catch { /* heavy deps unavailable — integration test will skip */ }

describe('ADR-005 P2.3: WhatToAnswerLLM honors the generative-assist gate', { skip: WhatToAnswerLLM ? false : 'WhatToAnswerLLM module could not be loaded in this environment' }, () => {
  test('disabled → yields a local notice and never calls streamChat (no cloud)', async () => {
    let streamCalled = false;
    const llm = {
      getCapabilities: () => ({ supportsImages: true, outputBudgetTokens: 2000 }),
      isLocalOnly: () => false,
      getCurrentProvider: () => 'test',
      getCurrentModel: () => 'test',
      getPromptTier: () => 'standard',
      fitContextForCurrentModel: (t) => t,
      async *streamChat() { streamCalled = true; yield 'SHOULD_NOT_RUN'; },
    };
    const modes = {
      getActiveModeSystemPromptSuffix: () => '',
      buildRetrievedActiveModeContextBlock: () => '',
      buildRetrievedActiveModeContextBlockHybrid: async () => '',
    };
    const w = new WhatToAnswerLLM(llm, modes);
    w.isGenerativeAssistEnabled = () => false; // simulate the toggle being off
    let out = '';
    for await (const tok of w.generateStream('第三部分のスピーチを練習します')) out += tok;
    assert.ok(out.length > 0 && out.includes('オフ'), `expected an off notice, got: ${out}`);
    assert.equal(streamCalled, false, 'streamChat must NOT be called when generative assist is off');
  });

  test('enabled (default method) → proceeds to call streamChat', async () => {
    let streamCalled = false;
    const llm = {
      getCapabilities: () => ({ supportsImages: true, outputBudgetTokens: 2000 }),
      isLocalOnly: () => false,
      getCurrentProvider: () => 'test',
      getCurrentModel: () => 'test',
      getPromptTier: () => 'standard',
      fitContextForCurrentModel: (t) => t,
      async *streamChat() { streamCalled = true; yield 'ANSWER'; },
    };
    const modes = {
      getActiveModeSystemPromptSuffix: () => '',
      buildRetrievedActiveModeContextBlock: () => '',
      buildRetrievedActiveModeContextBlockHybrid: async () => '',
    };
    const w = new WhatToAnswerLLM(llm, modes);
    w.isGenerativeAssistEnabled = () => true; // simulate the toggle being on
    let out = '';
    for await (const tok of w.generateStream('テスト')) out += tok;
    assert.equal(streamCalled, true, 'streamChat must be called when generative assist is on');
  });

  test('offline / generation failure → degrades to a clear local-fallback notice', async () => {
    const llm = {
      getCapabilities: () => ({ supportsImages: true, outputBudgetTokens: 2000 }),
      isLocalOnly: () => false,
      getCurrentProvider: () => 'test',
      getCurrentModel: () => 'test',
      getPromptTier: () => 'standard',
      fitContextForCurrentModel: (t) => t,
      // Simulate every provider being unreachable (offline).
      async *streamChat() { throw new Error('getaddrinfo ENOTFOUND api.example'); },
    };
    const modes = {
      getActiveModeSystemPromptSuffix: () => '',
      buildRetrievedActiveModeContextBlock: () => '',
      buildRetrievedActiveModeContextBlockHybrid: async () => '',
    };
    const w = new WhatToAnswerLLM(llm, modes);
    w.isGenerativeAssistEnabled = () => true;
    let out = '';
    for await (const tok of w.generateStream('テスト')) out += tok;
    assert.ok(/offline|local reference/i.test(out), `expected an offline-aware notice, got: ${out}`);
    assert.ok(!/repeat that/i.test(out), 'must not fall back to the misleading "repeat that" line');
  });
});
