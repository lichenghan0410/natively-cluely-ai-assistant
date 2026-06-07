// electron/services/__tests__/JaprisePartRouting.test.mjs
//
// ADR-005 Phase 2.2: deterministic Japrise part detection + per-part routing.
// Verifies (a) detectJaprisePart reads the active part from explicit markers and
// content cues, (b) buildJaprisePartDirective labels the part and adds the Part 2
// pronunciation guard, and (c) ModesManager injects the directive into the
// retrieved context for the active Japrise mode.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(path.resolve(__dirname, p)).href);

const partMod = await load('../../../dist-electron/electron/services/modes/japrisePart.js');
const tmplMod = await load('../../../dist-electron/electron/services/modes/japriseTemplate.js');
const modesMod = await load('../../../dist-electron/electron/services/ModesManager.js');

const { detectJaprisePart, buildJaprisePartDirective, extractPart3Points } = partMod;

const REAL_PART3_PROMPT = '休みの日にしたいことについて、1分で話してください。次の3つを話してください。誰と何をしたいか、それをしたい理由、次にいつそれができるか。準備してください。';

describe('Japrise part detection', () => {
  test('explicit 第N部分 markers map to the right part', () => {
    assert.equal(detectJaprisePart('第一部分の面接を始めます'), 1);
    assert.equal(detectJaprisePart('第二部分・音読'), 2);
    assert.equal(detectJaprisePart('では第三部分に進みます'), 3);
    assert.equal(detectJaprisePart('第四部分です'), 4);
    assert.equal(detectJaprisePart('第五部分・ロールプレイ'), 5);
  });

  test('パートN / part N markers also work (full/half width)', () => {
    assert.equal(detectJaprisePart('パート3'), 3);
    assert.equal(detectJaprisePart('part 4'), 4);
  });

  test('content cues decide when no explicit marker is present', () => {
    assert.equal(detectJaprisePart('画面の文を声に出して読んでください'), 2); // 音読
    assert.equal(detectJaprisePart('スピーチのテーマ、三つのポイントを話す'), 3);
    assert.equal(detectJaprisePart('グラフの増減を説明したい'), 4);
    assert.equal(detectJaprisePart('ロールプレイで店員と話す場面'), 5);
    assert.equal(detectJaprisePart('面接で質問に答える'), 1);
  });

  test('returns null when there is no Japrise signal', () => {
    assert.equal(detectJaprisePart('今日はいい天気ですね、散歩でもしましょうか'), null);
    assert.equal(detectJaprisePart(''), null);
  });

  test('the real official part-opening prompts each map to the right part', () => {
    const openings = {
      1: 'PART 1 インタビュー。10の質問があります。よく聞いて、質問に答えましょう。話す時間：それぞれの質問のあと20秒。',
      2: 'PART 2 音読。8の文があります。声に出して読みましょう。話す時間：1問10秒。',
      3: 'PART 3 スピーチ。テーマについて話しましょう。できるだけたくさん話してください。準備の時間：40秒。話す時間：60秒。',
      4: 'PART 4 プレゼンテーション。グラフを見ながらプレゼンテーションしてください。準備の時間：40秒。話す時間：60秒。',
      5: 'PART 5 ロールプレイ。タスクの説明を読んでください。あなたがその状況にいると想像して、相手と話してください。準備の時間：40秒。話す時間：質問ごとに30秒。',
    };
    for (const [n, prompt] of Object.entries(openings)) {
      assert.equal(detectJaprisePart(prompt), Number(n), `opening for Part ${n} must detect as ${n}`);
    }
  });
});

describe('Japrise part directive', () => {
  test('every part is labelled; only Part 2 carries the pronunciation guard', () => {
    for (const p of [1, 3, 4, 5]) {
      const d = buildJaprisePartDirective(p);
      assert.ok(d.includes('active_japrise_part'), `Part ${p} must be labelled`);
      assert.ok(d.includes(`Part ${p}`));
      assert.ok(!d.includes('part2_pronunciation_guard'), `Part ${p} must NOT carry the Part 2 guard`);
    }
    const d2 = buildJaprisePartDirective(2);
    assert.ok(d2.includes('part2_pronunciation_guard'));
  });
});

describe('ModesManager injects the part directive for the active Japrise mode', () => {
  const mgr = modesMod.ModesManager.getInstance();
  mgr.getActiveMode = () => ({
    id: 'jp', name: 'Japrise', templateType: 'japrise',
    customContext: '', isActive: true, createdAt: '2026-05-31T00:00:00.000Z',
  });
  mgr.getReferenceFiles = () => tmplMod.JAPRISE_REFERENCE_FILES.map((f, i) => ({
    id: `ref_${i}`, modeId: 'jp', fileName: f.fileName, content: f.content,
    createdAt: '2026-05-31T00:00:00.000Z',
  }));

  test('Part 2 context carries the pronunciation guard', () => {
    const ctx = mgr.buildRetrievedActiveModeContextBlock('第二部分の音読を始めます', '画面の文を声に出して読んでください');
    assert.ok(ctx.includes('part2_pronunciation_guard'), 'Part 2 must hard-suppress content suggestions');
    assert.ok(ctx.includes('Part 2'));
  });

  test('Part 3 context carries the part label but not the Part 2 guard', () => {
    const ctx = mgr.buildRetrievedActiveModeContextBlock('第三部分のスピーチ、三つのポイント', 'テーマについて話します');
    assert.ok(ctx.includes('active_japrise_part'));
    assert.ok(ctx.includes('Part 3'));
    assert.ok(!ctx.includes('part2_pronunciation_guard'));
  });

  test('Part 3 with an enumerated prompt injects the three required points', () => {
    const ctx = mgr.buildRetrievedActiveModeContextBlock(REAL_PART3_PROMPT, REAL_PART3_PROMPT);
    assert.ok(ctx.includes('part3_required_points'), 'concrete 3 points must be injected when extractable');
    assert.ok(ctx.includes('それをしたい理由'));
    assert.ok(ctx.includes('次にいつそれができるか'));
  });
});

describe('Part 3 key-point extraction', () => {
  test('extracts the three points from the real Japrise prompt', () => {
    assert.deepEqual(extractPart3Points(REAL_PART3_PROMPT), [
      '誰と何をしたいか', 'それをしたい理由', '次にいつそれができるか',
    ]);
  });

  test('handles a numbered ①②③ enumeration (NFKC-normalized)', () => {
    const p = extractPart3Points('あなたの町について、3つのことを話してください。①おすすめの場所 ②その理由 ③一緒に行きたい人。準備してください。');
    assert.deepEqual(p, ['おすすめの場所', 'その理由', '一緒に行きたい人']);
  });

  test('returns null when the prompt has no parseable 3-point list (graceful degradation)', () => {
    assert.equal(extractPart3Points('好きな食べ物について1分で話してください。準備してください。'), null);
    assert.equal(extractPart3Points('家から会社までどうやって行きますか。'), null);
    assert.equal(extractPart3Points('3つ話して。A、B、C、D。準備してください。'), null); // 4 items
  });
});

describe('ADR-005 P2.4: instant Japrise reference feed', () => {
  const mgr = modesMod.ModesManager.getInstance();
  mgr.getActiveMode = () => ({
    id: 'jp', name: 'Japrise', templateType: 'japrise',
    customContext: '', isActive: true, createdAt: '2026-05-31T00:00:00.000Z',
  });
  mgr.getReferenceFiles = () => tmplMod.JAPRISE_REFERENCE_FILES.map((f, i) => ({
    id: `ref_${i}`, modeId: 'jp', fileName: f.fileName, content: f.content,
    createdAt: '2026-05-31T00:00:00.000Z',
  }));

  test('returns the active part card (local, no LLM) when a part is detected', () => {
    const r = mgr.getJapriseInstantReference('第二部分の音読を始めます');
    assert.ok(r, 'should return a reference card when a part is detected');
    assert.equal(r.part, 2);
    assert.equal(r.partName, '音読');
    assert.ok(r.directive.includes('part2_pronunciation_guard'), 'Part 2 carries the guard');
    assert.ok(r.reference.includes('音読'), 'reference must be the Part 2 card');
  });

  test('returns null when there is no part signal (renderer keeps the previous panel)', () => {
    assert.equal(mgr.getJapriseInstantReference('今日はいい天気ですね'), null);
  });

  test('Part 3 instant card carries the extracted required points', () => {
    const r = mgr.getJapriseInstantReference(REAL_PART3_PROMPT);
    assert.ok(r && r.part === 3, 'Part 3 detected');
    assert.ok(r.directive.includes('part3_required_points'), 'instant card includes the 3 points');
  });
});
