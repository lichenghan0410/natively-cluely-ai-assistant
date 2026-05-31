import type { EventEmitter } from 'events';

export interface BackendTranscribeRequest {
  taskId: string;
  audio: Float32Array;
  language: string;
  streaming: boolean;
}

export interface BackendResultMessage {
  type: 'result' | 'partial';
  taskId: string;
  text: string;
}

export interface BackendErrorMessage {
  type: 'error';
  taskId?: string;
  message: string;
}

export type BackendMessage =
  | { type: 'ready' }
  | BackendResultMessage
  | BackendErrorMessage;

export interface InferenceBackend extends EventEmitter {
  readonly id: 'medium' | 'whispercpp';
  init(): void;
  isReady(): boolean;
  setPrompt(prompt: string): void;
  transcribe(req: BackendTranscribeRequest): void;
  dispose(delayMs?: number): void;
}
