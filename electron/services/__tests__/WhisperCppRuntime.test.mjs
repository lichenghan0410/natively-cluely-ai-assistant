import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function importDist(relPath) {
  return import(pathToFileURL(path.join(root, 'dist-electron', relPath)).href);
}

test('whisper.cpp manifest locks expected runtime and model hashes', async () => {
  const { WHISPER_CPP_ASSETS, WHISPER_CPP_MODELS } = await importDist('electron/audio/whisper/whisperCppAssets.js');

  assert.equal(WHISPER_CPP_ASSETS.version, 'v1.8.5');
  assert.equal(WHISPER_CPP_ASSETS.cudaZip.sizeBytes, 459827307);
  assert.equal(WHISPER_CPP_ASSETS.cudaZip.sha256, 'FF50101F85A6026D39053771C25B42F5752AC05D5BE9EE2E5D2632541ADEF231');
  assert.equal(WHISPER_CPP_MODELS.largeV3TurboQ5.sha256, '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2');
  assert.equal(WHISPER_CPP_MODELS.mediumQ5.sha256, '19FEA4B380C3A618EC4723C3EEF2EB785FFBA0D0538CF43F8F235E7B3B34220F');
});

test('whisper.cpp asset validation rejects missing or mismatched files', async () => {
  const { validateWhisperCppFile } = await importDist('electron/audio/whisper/whisperCppAssets.js');

  assert.deepEqual(validateWhisperCppFile('D:/does/not/exist.bin', { sizeBytes: 1, sha256: 'AA' }), {
    ok: false,
    reason: 'missing',
  });
});

test('Float32 PCM is encoded as 16 kHz mono PCM16 WAV', async () => {
  const { encodeFloat32Wav } = await importDist('electron/audio/whisper/wav.js');

  const wav = encodeFloat32Wav(new Float32Array([-1, 0, 1]), 16000);

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readInt16LE(44), -32768);
  assert.equal(wav.readInt16LE(46), 0);
  assert.equal(wav.readInt16LE(48), 32767);
});

test('backend selection prefers whisper.cpp only when CUDA and assets are ready', async () => {
  const { resolveLocalWhisperBackend } = await importDist('electron/audio/whisper/backendSelection.js');

  assert.equal(resolveLocalWhisperBackend({ preferredBackend: 'whispercpp', hasNvidiaCuda: true, whisperCppReady: true }), 'whispercpp');
  assert.equal(resolveLocalWhisperBackend({ preferredBackend: 'whispercpp', hasNvidiaCuda: false, whisperCppReady: true }), 'medium');
  assert.equal(resolveLocalWhisperBackend({ preferredBackend: 'whispercpp', hasNvidiaCuda: true, whisperCppReady: false }), 'medium');
  assert.equal(resolveLocalWhisperBackend({ preferredBackend: 'medium', hasNvidiaCuda: true, whisperCppReady: true }), 'medium');
});

test('nvidia-smi failure selects Medium fallback', async () => {
  const { hasNvidiaCudaSync } = await importDist('electron/audio/whisper/whisperCppServer.js');
  const fakeSpawnSync = () => ({ status: 1, stdout: '', stderr: 'nvidia-smi failed' });

  assert.equal(hasNvidiaCudaSync(fakeSpawnSync, 'win32'), false);
});

test('CUDA detection can be disabled for manual fallback validation', async () => {
  const { hasNvidiaCudaSync } = await importDist('electron/audio/whisper/whisperCppServer.js');
  const fakeSpawnSync = () => ({ status: 0, stdout: 'GPU 0: NVIDIA GeForce RTX 3070 Ti', stderr: '' });

  assert.equal(hasNvidiaCudaSync(fakeSpawnSync, 'win32', { NATIVELY_STT_FORCE_NO_CUDA: '1' }), false);
});

test('whisper.cpp server pool shares one server per model until last release', async () => {
  const { WhisperCppServerPool } = await importDist('electron/audio/whisper/whisperCppServerPool.js');

  let createCount = 0;
  let startCount = 0;
  let disposeCount = 0;
  const pool = new WhisperCppServerPool((model) => {
    createCount++;
    return {
      model,
      getPort: () => 43123,
      start: async () => {
        startCount++;
        return 43123;
      },
      dispose: () => {
        disposeCount++;
      },
      on: () => {},
      once: () => {},
      off: () => {},
    };
  });

  const first = await pool.acquire('large-v3-turbo-q5_0');
  const second = await pool.acquire('large-v3-turbo-q5_0');

  assert.equal(createCount, 1);
  assert.equal(startCount, 1);
  assert.equal(first.port, 43123);
  assert.equal(second.port, 43123);

  first.release();
  assert.equal(disposeCount, 0);
  second.release();
  assert.equal(disposeCount, 1);
});
