import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { buildWorkerInitMessage } from './inferenceConfig';
import { modelPreloader } from './modelPreloader';
import type { InferenceBackend, BackendTranscribeRequest } from './inferenceBackend';
import type { WorkerOutMessage } from './types';

export class MediumOnnxBackend extends EventEmitter implements InferenceBackend {
  readonly id = 'medium' as const;
  private worker: Worker | null = null;
  private ready = false;
  private terminateTimer: ReturnType<typeof setTimeout> | null = null;
  private contextPrompt = '';
  private contextPromptSentToWorker = '';

  constructor(private readonly modelId: string) {
    super();
  }

  init(): void {
    if (this.worker) return;
    const warm = modelPreloader.takeWarmWorker(this.modelId);
    if (warm) {
      console.log(`[MediumOnnxBackend] Using preloaded warm worker for ${this.modelId}`);
      this.worker = warm;
      this.ready = true;
      this.attachWorkerListeners();
      this.pushPromptIfNeeded();
      setImmediate(() => this.emit('message', { type: 'ready' }));
      return;
    }

    console.log(`[MediumOnnxBackend] Cold-starting worker for ${this.modelId}`);
    const candidates = [
      path.join(__dirname, 'whisperWorker.js'),
      path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js'),
      path.join(__dirname, 'whisper', 'whisperWorker.js'),
    ];
    const workerPath = candidates.find(p => fs.existsSync(p));
    if (!workerPath) {
      throw new Error(`whisperWorker.js not found. Tried: ${candidates.join(', ')}`);
    }
    this.worker = new Worker(workerPath, {
      resourceLimits: { maxOldGenerationSizeMb: 8192 },
    });
    this.attachWorkerListeners();
    this.worker.postMessage(buildWorkerInitMessage(this.modelId));
  }

  isReady(): boolean {
    return this.ready;
  }

  setPrompt(prompt: string): void {
    this.contextPrompt = prompt;
    this.pushPromptIfNeeded();
  }

  transcribe(req: BackendTranscribeRequest): void {
    if (!this.worker || !this.ready) return;
    const copy = req.audio.slice();
    this.worker.postMessage(
      { type: 'transcribe', taskId: req.taskId, audio: copy, language: req.language, streaming: req.streaming },
      [copy.buffer]
    );
  }

  dispose(delayMs = 0): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    this.contextPromptSentToWorker = '';
    if (!worker) return;

    worker.removeAllListeners('message');
    worker.removeAllListeners('error');
    if (this.terminateTimer) clearTimeout(this.terminateTimer);
    const terminate = () => {
      this.terminateTimer = null;
      worker.terminate();
    };
    if (delayMs > 0) {
      const t = setTimeout(terminate, delayMs);
      (t as any).unref?.();
      this.terminateTimer = t;
    } else {
      terminate();
    }
  }

  private attachWorkerListeners(): void {
    if (!this.worker) return;
    this.worker.on('message', (msg: WorkerOutMessage) => {
      if (msg.type === 'ready') {
        this.ready = true;
        this.pushPromptIfNeeded();
        this.emit('message', { type: 'ready' });
      } else if (msg.type === 'partial' || msg.type === 'result') {
        this.emit('message', { type: msg.type, taskId: msg.taskId, text: msg.text });
      } else if (msg.type === 'error') {
        this.emit('message', { type: 'error', taskId: msg.taskId, message: msg.message });
      }
    });
    this.worker.on('error', (err) => this.emit('error', err));
  }

  private pushPromptIfNeeded(): void {
    if (!this.worker || !this.ready) return;
    if (this.contextPrompt === this.contextPromptSentToWorker) return;
    this.worker.postMessage({ type: 'setPrompt', prompt: this.contextPrompt });
    this.contextPromptSentToWorker = this.contextPrompt;
  }
}
