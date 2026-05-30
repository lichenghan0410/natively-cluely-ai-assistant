/**
 * Convert the 16kHz mono 32-bit float WAVs (WAVE_FORMAT_EXTENSIBLE) in
 * test/audio-16k/ into 16-bit PCM 16kHz mono WAVs that whisper-cli reads
 * without ambiguity. Applies the SAME peak-normalize as the Medium harness
 * (peak>1 -> scale 0.95/peak) so the audio fed to whisper.cpp is identical
 * in amplitude to what the Medium acceptance test fed to the ONNX worker.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = 'D:\\Interview APP\\test\\audio-16k';
const OUT_DIR = 'D:\\Interview APP\\spike-whispercpp\\audio';

const SAMPLES = [
  'Part1-Interview-q1',
  'Part3-Speech-q1',
  'Part4-Graph Presentation-q1',
  'Part5-Role Play-q1',
];

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');
  let off = 12;
  let fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      let audioFormat = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (audioFormat === 0xFFFE && sz >= 40) audioFormat = buf.readUInt16LE(body + 24); // subformat
      fmt = { audioFormat, channels, sampleRate, bits };
    } else if (id === 'data') {
      dataOff = body; dataLen = sz;
    }
    off = body + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('missing fmt/data');
  return { fmt, dataOff, dataLen };
}

function readFloatSamples({ fmt, dataOff, dataLen }, buf) {
  const out = [];
  if (fmt.audioFormat === 3 && fmt.bits === 32) {
    for (let i = dataOff; i + 4 <= dataOff + dataLen; i += 4) out.push(buf.readFloatLE(i));
  } else if (fmt.audioFormat === 1 && fmt.bits === 16) {
    for (let i = dataOff; i + 2 <= dataOff + dataLen; i += 2) out.push(buf.readInt16LE(i) / 32768);
  } else {
    throw new Error(`unsupported format ${fmt.audioFormat} bits ${fmt.bits}`);
  }
  return Float32Array.from(out);
}

function writePcm16Wav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const name of SAMPLES) {
  const src = fs.readFileSync(path.join(SRC_DIR, name + '.wav'));
  const meta = parseWav(src);
  let samples = readFloatSamples(meta, src);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  if (peak > 1.0) { const scale = 0.95 / peak; for (let i = 0; i < samples.length; i++) samples[i] *= scale; }
  const out = writePcm16Wav(samples, meta.fmt.sampleRate);
  fs.writeFileSync(path.join(OUT_DIR, name + '.wav'), out);
  const dur = (samples.length / meta.fmt.sampleRate).toFixed(3);
  console.log(`${name}: ${meta.fmt.sampleRate}Hz fmt=${meta.fmt.audioFormat} bits=${meta.fmt.bits} dur=${dur}s peak=${peak.toFixed(3)} -> pcm16`);
}
console.log('CONVERT_DONE');
