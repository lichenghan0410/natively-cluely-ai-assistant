/**
 * Part3 production VAD replay — ADR-003 必补验证.
 *
 * Uses the ACTUAL compiled production VadProcessor (dist-electron) and replays
 * LocalWhisperSTT's final-segmentation path on the Part3 raw audio:
 *   - feed 30ms chunks -> vad.push() -> each emitted segment is a FINAL unit
 *   - if open segment grows past MAX_SEGMENT_MS (14000ms) -> vad.softCommit()
 *   - at end -> vad.flush()
 * Exports each segment as 16-bit PCM WAV for whisper-cli, plus a manifest.
 */
const fs = require('fs');
const path = require('path');

const VAD_JS = 'D:\\Interview APP\\natively\\dist-electron\\electron\\audio\\whisper\\vadProcessor.js';
const PART3_F32 = 'D:\\Interview APP\\test\\audio-raw\\Part3-Speech-q1.f32';
const OUT_DIR = 'D:\\Interview APP\\spike-whispercpp\\vad-replay';
const SR = 16000;
const CHUNK = 480;                 // 30ms feed granularity (mimics streaming capture)
const MAX_SEGMENT_MS = 14000;      // LocalWhisperSTT.MAX_SEGMENT_MS soft-commit threshold

const mod = require(VAD_JS);
const VadProcessor = mod.VadProcessor || (mod.default && mod.default.VadProcessor);
if (!VadProcessor) throw new Error('VadProcessor not found in compiled module: ' + Object.keys(mod));

function loadF32(p) {
  const buf = fs.readFileSync(p);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
function writePcm16Wav(samples, sampleRate) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(Math.round(s * 32767), 44 + i * 2); }
  return b;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const audio = loadF32(PART3_F32);
console.log(`Part3: ${audio.length} samples, ${(audio.length / SR).toFixed(3)}s`);

const vad = new VadProcessor();
const finals = [];               // { samples, durationMs, reason }
// Replay LocalWhisperSTT.processChunk loop
for (let off = 0; off < audio.length; off += CHUNK) {
  const chunk = audio.subarray(off, Math.min(off + CHUNK, audio.length));
  const segs = vad.push(chunk);
  for (const s of segs) finals.push({ samples: s.samples, durationMs: s.durationMs, reason: 'push(hangover/15s)' });
  const open = vad.peekOpenSegment();
  if (open && open.durationMs >= MAX_SEGMENT_MS) {
    const committed = vad.softCommit();
    if (committed) finals.push({ samples: committed.samples, durationMs: committed.durationMs, reason: 'softCommit(14s)' });
  }
}
for (const s of vad.flush()) finals.push({ samples: s.samples, durationMs: s.durationMs, reason: 'flush(stop)' });

console.log(`\nVAD produced ${finals.length} final segment(s):`);
const manifest = [];
finals.forEach((seg, i) => {
  const name = `seg-${String(i + 1).padStart(2, '0')}`;
  const wavPath = path.join(OUT_DIR, name + '.wav');
  fs.writeFileSync(wavPath, writePcm16Wav(seg.samples, SR));
  const durSec = +(seg.samples.length / SR).toFixed(3);
  manifest.push({ index: i + 1, name, durationSec: durSec, durationMsVad: seg.durationMs, reason: seg.reason, wav: wavPath });
  console.log(`  ${name}: ${durSec}s  (vad=${seg.durationMs}ms, ${seg.reason})`);
});
fs.writeFileSync(path.join(OUT_DIR, 'segments.json'), JSON.stringify({ sampleRate: SR, chunkSamples: CHUNK, maxSegmentMs: MAX_SEGMENT_MS, segments: manifest }, null, 2));
console.log('\nmanifest:', path.join(OUT_DIR, 'segments.json'));
