import fs from 'fs';
import https from 'https';
import path from 'path';
import { spawn } from 'child_process';
import {
  getWhisperCppRuntimeDir,
  getWhisperCppModelsDir,
  getWhisperCppModelPath,
  getWhisperCppModelSpec,
  validateWhisperCppFile,
  WHISPER_CPP_ASSETS,
  type WhisperCppFileSpec,
  type WhisperCppModelKey,
} from './whisperCppAssets';

export type WhisperCppDownloadTarget = 'whispercpp-runtime' | WhisperCppModelKey;

export interface WhisperCppDownloadProgress {
  target: WhisperCppDownloadTarget;
  progress: number;
}

function downloadFile(url: string, outPath: string, onProgress?: (pct: number) => void): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, outPath, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        return;
      }

      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const tmp = outPath + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.on('data', chunk => {
        received += chunk.length;
        if (total > 0) onProgress?.(Math.min(99, Math.floor((received / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, outPath);
          onProgress?.(100);
          resolve();
        });
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

function expandZip(zipPath: string, destination: string): Promise<void> {
  fs.mkdirSync(destination, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr += String(d); });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Expand-Archive failed with exit ${code}`));
    });
  });
}

async function downloadAndValidate(spec: WhisperCppFileSpec & { url: string; fileName: string }, outPath: string, onProgress?: (pct: number) => void): Promise<void> {
  await downloadFile(spec.url, outPath, onProgress);
  const valid = validateWhisperCppFile(outPath, spec);
  if (!valid.ok) {
    const failed = valid as { ok: false; reason: string };
    throw new Error(`Downloaded file failed ${failed.reason} validation`);
  }
}

export async function downloadWhisperCppTarget(target: WhisperCppDownloadTarget, onProgress?: (progress: WhisperCppDownloadProgress) => void): Promise<void> {
  if (target === 'whispercpp-runtime') {
    const zipPath = path.join(getWhisperCppRuntimeDir(), WHISPER_CPP_ASSETS.cudaZip.fileName);
    await downloadAndValidate(WHISPER_CPP_ASSETS.cudaZip, zipPath, progress => onProgress?.({ target, progress: Math.floor(progress * 0.8) }));
    await expandZip(zipPath, path.join(getWhisperCppRuntimeDir(), 'bin', 'cuda'));
    onProgress?.({ target, progress: 100 });
    return;
  }

  const spec = getWhisperCppModelSpec(target);
  await downloadAndValidate(spec, getWhisperCppModelPath(target), progress => onProgress?.({ target, progress }));
}

export function deleteWhisperCppTarget(target: WhisperCppDownloadTarget): void {
  if (target === 'whispercpp-runtime') {
    const runtimeDir = getWhisperCppRuntimeDir();
    if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
    return;
  }
  const modelPath = getWhisperCppModelPath(target);
  if (fs.existsSync(modelPath)) fs.rmSync(modelPath, { force: true });
  try {
    if (fs.existsSync(getWhisperCppModelsDir()) && fs.readdirSync(getWhisperCppModelsDir()).length === 0) {
      fs.rmdirSync(getWhisperCppModelsDir());
    }
  } catch {
    // Best-effort cleanup only.
  }
}
