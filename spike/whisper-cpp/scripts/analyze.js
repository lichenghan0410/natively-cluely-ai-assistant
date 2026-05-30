/**
 * Aggregate the spike runs into a comparable summary.
 *
 * Latency note: whisper.cpp "total time" INCLUDES model load (verified empirically:
 * wall ~= total + startup, and load < total in every run). In production whisper.cpp
 * runs as a persistent subprocess (whisper-server / long-lived child), so the model is
 * loaded ONCE and per-segment final latency == total - load == warm compute time.
 * This is the warm-vs-warm comparison to the Medium harness (warm ONNX worker).
 */
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2] || 'D:\\Interview APP\\spike-whispercpp\\results\\whispercpp-latest.json', 'utf-8').replace(/^﻿/, ''));
const PART3 = 'Part3-Speech-q1';

const byCfg = {};
for (const r of j.runs) {
  const key = `${r.backend}/${r.model}`;
  (byCfg[key] ??= []).push(r);
}

const rows = [];
for (const [key, runs] of Object.entries(byCfg)) {
  for (const r of runs) {
    r.computeMs = Math.round(r.inferMs - r.loadMs);          // warm per-call inference (model already loaded)
    r.computeRtf = +(r.computeMs / (r.audioSec * 1000)).toFixed(3);
  }
  const cersAll = runs.map(r => r.cerPct);
  const cersNo3 = runs.filter(r => r.sample !== PART3).map(r => r.cerPct);
  const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
  const maxCompute = Math.max(...runs.map(r => r.computeMs));
  const maxRtf = Math.max(...runs.map(r => r.computeRtf));
  rows.push({
    cfg: key,
    avgCerAll: avg(cersAll),
    avgCerNoPart3: avg(cersNo3),
    part3Cer: runs.find(r => r.sample === PART3)?.cerPct,
    maxComputeMs: maxCompute,
    maxComputeRtf: maxRtf,
    perSample: runs.map(r => ({ s: r.sample.split('-')[0], computeMs: r.computeMs, rtf: r.computeRtf, cer: r.cerPct })),
  });
}

console.log('=== whisper.cpp spike summary (warm compute = total - load) ===\n');
for (const row of rows) {
  console.log(`${row.cfg}`);
  console.log(`  avgCER(all4)=${row.avgCerAll}%  avgCER(exclPart3)=${row.avgCerNoPart3}%  Part3=${row.part3Cer}%`);
  console.log(`  maxComputeLatency=${row.maxComputeMs}ms  maxRTF=${row.maxComputeRtf}`);
  for (const p of row.perSample) console.log(`    ${p.s.padEnd(6)} compute=${String(p.computeMs).padStart(5)}ms rtf=${String(p.rtf).padEnd(5)} cer=${p.cer}%`);
  console.log('');
}

// Save enriched JSON
const out = 'D:\\Interview APP\\spike-whispercpp\\results\\summary.json';
fs.writeFileSync(out, JSON.stringify({ meta: j.meta, summary: rows, runs: j.runs }, null, 2), 'utf-8');
console.log('saved', out);
