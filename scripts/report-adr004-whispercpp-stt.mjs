import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(root, '..');
const resultDir = path.join(workspaceRoot, 'test', 'results');
const gtDir = path.join(workspaceRoot, 'TEST FILE');
const reportPath = path.join(workspaceRoot, 'TEST-REPORT-ADR-004-WhisperCpp-STT-2026-05-30.md');

const { computeJapaneseAcceptanceCer } = await import(
  pathToFileURL(path.join(root, 'dist-electron', 'electron', 'audio', 'whisper', 'japaneseCer.js')).href
);

function latestRawResult() {
  const candidates = fs.readdirSync(resultDir)
    .filter(name => /^adr004-whispercpp-server-\d{4}-/.test(name) && name.endsWith('.json') && !name.includes('normalized'))
    .map(name => {
      const fullPath = path.join(resultDir, name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) throw new Error(`No ADR-004 raw result JSON found in ${resultDir}`);
  return candidates[0].fullPath;
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value) {
  return +value.toFixed(2);
}

function loadGroundTruth(sample) {
  return fs.readFileSync(path.join(gtDir, `${sample}-text.txt`), 'utf8').trim();
}

function makeResult(rawResult) {
  const gt = loadGroundTruth(rawResult.sample);
  const acceptance = computeJapaneseAcceptanceCer(gt, rawResult.transcript || '');
  return {
    ...rawResult,
    strictCer: {
      cer: rawResult.cer,
      cerPct: rawResult.cerPct,
      editDistance: rawResult.editDistance,
      refLen: rawResult.refLen,
      hypLen: rawResult.hypLen,
    },
    acceptanceCer: acceptance,
  };
}

function makeSummary(results) {
  const latencies = results.flatMap(result => result.segments.map(segment => segment.latencyMs));
  const acceptanceCers = results.map(result => result.acceptanceCer.cerPct);
  return {
    avgAcceptanceCerPct: round2(average(acceptanceCers)),
    maxAcceptanceCerPct: round2(Math.max(...acceptanceCers)),
    maxFinalLatencyMs: Math.max(...latencies),
    p95FinalLatencyMs: percentile(latencies, 95),
    totalSegments: latencies.length,
    passLatency2000: latencies.every(value => value <= 2000),
    passAcceptanceCer9EachSample: acceptanceCers.every(value => value <= 9),
  };
}

function warningText(result) {
  const warnings = result.acceptanceCer.orthographyWarnings;
  if (warnings.length === 0) return 'none';
  return warnings.map(warning => `${warning.accepted}->${warning.preferred}`).join(', ');
}

function makeReport(rawPath, normalizedPath, meta, summary, results) {
  const part3 = results.find(result => result.sample === 'Part3-Speech-q1');
  const rows = results.map(result => {
    const strict = result.strictCer;
    const acceptance = result.acceptanceCer;
    return `| ${result.sample} | ${result.segmentCount} | ${result.maxFinalLatencyMs} | ${result.p95FinalLatencyMs} | ${acceptance.cerPct}% | ${acceptance.editDistance}/${acceptance.refLen} | ${strict.cerPct}% | ${warningText(result)} |`;
  }).join('\n');

  const part3Rows = (part3?.segments || []).map(segment =>
    `| ${segment.index} | ${segment.durationMs} | ${segment.latencyMs} | ${segment.reason} | ${segment.emittedText || ''} |`,
  ).join('\n');

  return `# TEST REPORT - ADR-004 whisper.cpp STT Validation

Date: 2026-05-30
Scope: STT-only validation. Screen Recording is intentionally excluded.
Raw result: \`${rawPath}\`
Normalized result: \`${normalizedPath}\`

## Environment

- Host: ${os.hostname()}
- Backend: ${meta.backend}
- Model: ${meta.model}
- Runtime: whisper.cpp v1.8.5 server process, persistent model load
- Server args: \`${meta.serverArgs}\`
- VAD: compiled production VadProcessor, 30 ms chunks, 14000 ms soft commit
- Emit filter: production \`${meta.emitFilter}\`
- CER scorer: Japanese acceptance CER, using NFKC plus punctuation/whitespace folding and kana-kanji reading aliases. Output should still prefer kanji; kana output is reported as a non-blocking orthography warning.

## Summary

- Latency gate <= 2000 ms per final segment: ${summary.passLatency2000 ? 'PASS' : 'FAIL'} (max ${summary.maxFinalLatencyMs} ms, p95 ${summary.p95FinalLatencyMs} ms)
- Acceptance CER gate <= 9% per sample: ${summary.passAcceptanceCer9EachSample ? 'PASS' : 'FAIL'} (max ${summary.maxAcceptanceCerPct}%, avg ${summary.avgAcceptanceCerPct}%)
- Total final segments: ${summary.totalSegments}

## 4-Sample Results

| Sample | VAD segments | Max final latency ms | P95 final latency ms | Acceptance CER | Edit/ref | Strict CER | Kana/kanji warnings |
|---|---:|---:|---:|---:|---:|---:|---|
${rows}

## Part3 Production VAD Replay

Part3 acceptance CER: ${part3?.acceptanceCer.cerPct ?? 'n/a'}% (${part3?.acceptanceCer.editDistance ?? 'n/a'}/${part3?.acceptanceCer.refLen ?? 'n/a'}), segments: ${part3?.segmentCount ?? 'n/a'}, max latency: ${part3?.maxFinalLatencyMs ?? 'n/a'} ms.

| Segment | Duration ms | Final latency ms | Reason | Emitted transcript |
|---:|---:|---:|---|---|
${part3Rows}

## Notes

- This report uses the ADR-004 persistent \`whisper-server\` HTTP benchmark output, not one-shot \`whisper-cli\`.
- Audio is fed directly as STT input, so Windows Screen Recording permission is not part of this acceptance result.
- The acceptance scorer intentionally does not treat homophone kanji substitutions as equivalent. For example, \`支店\` and \`視点\` remain an error even though they share a reading.
- Input files whose decoded float peak exceeded 1.0 were scaled to 0.95/peak, matching the prior harness normalization used for comparable CER scoring.
`;
}

const rawPath = process.argv[2] ? path.resolve(process.argv[2]) : latestRawResult();
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const results = raw.results.map(makeResult);
const summary = makeSummary(results);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const normalizedPath = path.join(resultDir, `adr004-whispercpp-server-normalized-${timestamp}.json`);

const normalized = {
  ...raw,
  meta: {
    ...raw.meta,
    cerScorer: 'japanese-acceptance-v1',
    cerScorerNotes: [
      'NFKC width normalization',
      'punctuation and whitespace ignored',
      'kana-kanji reading aliases ignored for acceptance CER',
      'kana output for kanji reference is reported as an orthography warning',
      'homophone kanji substitutions remain errors',
    ],
  },
  summary,
  results,
};

fs.writeFileSync(normalizedPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, makeReport(rawPath, normalizedPath, normalized.meta, summary, results), 'utf8');

console.log(JSON.stringify({ reportPath, normalizedPath, summary }, null, 2));
