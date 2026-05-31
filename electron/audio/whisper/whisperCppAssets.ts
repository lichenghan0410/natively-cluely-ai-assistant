import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type WhisperCppModelKey = 'large-v3-turbo-q5_0' | 'medium-q5_0';

export interface WhisperCppFileSpec {
  url?: string;
  fileName?: string;
  sizeBytes: number;
  sha256: string;
}

export const WHISPER_CPP_ASSETS = {
  version: 'v1.8.5',
  cudaZip: {
    fileName: 'whisper-cuda-v1.8.5.zip',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.5/whisper-cublas-12.4.0-bin-x64.zip',
    sizeBytes: 459_827_307,
    sha256: 'FF50101F85A6026D39053771C25B42F5752AC05D5BE9EE2E5D2632541ADEF231',
  },
} as const;

export const WHISPER_CPP_MODELS = {
  largeV3TurboQ5: {
    id: 'large-v3-turbo-q5_0' as const,
    name: 'whisper.cpp Large v3 Turbo Q5',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sizeBytes: 574_041_195,
    sha256: '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2',
  },
  mediumQ5: {
    id: 'medium-q5_0' as const,
    name: 'whisper.cpp Medium Q5',
    fileName: 'ggml-medium-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    sizeBytes: 539_212_467,
    sha256: '19FEA4B380C3A618EC4723C3EEF2EB785FFBA0D0538CF43F8F235E7B3B34220F',
  },
} as const;

export function getWhisperCppRuntimeDir(userDataPath?: string): string {
  if (userDataPath) return path.join(userDataPath, 'whisper-cpp');
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'whisper-cpp');
}

export function getWhisperCppBinDir(userDataPath?: string): string {
  return path.join(getWhisperCppRuntimeDir(userDataPath), 'bin', 'cuda', 'Release');
}

export function getWhisperCppModelsDir(userDataPath?: string): string {
  return path.join(getWhisperCppRuntimeDir(userDataPath), 'models');
}

export function getWhisperCppServerPath(userDataPath?: string): string {
  return path.join(getWhisperCppBinDir(userDataPath), 'whisper-server.exe');
}

export function getWhisperCppModelSpec(model: WhisperCppModelKey = 'large-v3-turbo-q5_0') {
  return model === 'medium-q5_0' ? WHISPER_CPP_MODELS.mediumQ5 : WHISPER_CPP_MODELS.largeV3TurboQ5;
}

export function getWhisperCppModelPath(model: WhisperCppModelKey = 'large-v3-turbo-q5_0', userDataPath?: string): string {
  return path.join(getWhisperCppModelsDir(userDataPath), getWhisperCppModelSpec(model).fileName);
}

export function validateWhisperCppFile(filePath: string, spec: Pick<WhisperCppFileSpec, 'sizeBytes' | 'sha256'>): { ok: true } | { ok: false; reason: 'missing' | 'size' | 'sha256'; actual?: string | number } {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  const stat = fs.statSync(filePath);
  if (stat.size !== spec.sizeBytes) return { ok: false, reason: 'size', actual: stat.size };
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
  if (hash !== spec.sha256) return { ok: false, reason: 'sha256', actual: hash };
  return { ok: true };
}

export function isWhisperCppRuntimeReady(model: WhisperCppModelKey = 'large-v3-turbo-q5_0', userDataPath?: string): boolean {
  if (!fs.existsSync(getWhisperCppServerPath(userDataPath))) return false;
  return validateWhisperCppFile(getWhisperCppModelPath(model, userDataPath), getWhisperCppModelSpec(model)).ok;
}
