import { EventEmitter } from 'events';
import type { BackendTranscribeRequest, InferenceBackend } from './inferenceBackend';
import type { WhisperCppModelKey } from './whisperCppAssets';
import { postWhisperCppInference } from './whisperCppServer';
import { whisperCppServerPool, type WhisperCppServerLease } from './whisperCppServerPool';

export class WhisperCppBackend extends EventEmitter implements InferenceBackend {
  readonly id = 'whispercpp' as const;
  private lease: WhisperCppServerLease | null = null;
  private ready = false;
  private disposed = false;
  private restartFailures = 0;
  private readonly onServerExit = (info: unknown) => {
    this.ready = false;
    if (!this.disposed) {
      console.warn('[WhisperCppBackend] whisper-server exited, scheduling restart:', info);
      this.restartAfterFailure();
    }
  };

  constructor(private readonly model: WhisperCppModelKey) {
    super();
  }

  init(): void {
    this.disposed = false;
    this.startServer();
  }

  isReady(): boolean {
    return this.ready;
  }

  setPrompt(_prompt: string): void {
    // whisper-server's HTTP API has no out-of-band prompt cache equivalent.
  }

  transcribe(req: BackendTranscribeRequest): void {
    if (!this.ready || !this.lease?.port) {
      this.emit('message', { type: 'error', taskId: req.taskId, message: 'whisper.cpp backend is not ready' });
      return;
    }

    postWhisperCppInference(this.lease.port, req.audio, req.language)
      .then(text => {
        this.emit('message', {
          type: req.streaming ? 'partial' : 'result',
          taskId: req.taskId,
          text,
        });
      })
      .catch((err) => {
        this.emit('message', { type: 'error', taskId: req.taskId, message: err.message || String(err) });
        this.restartAfterFailure();
      });
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.releaseLease();
  }

  private startServer(): void {
    this.releaseLease();
    whisperCppServerPool.acquire(this.model)
      .then((lease) => {
        if (this.disposed) {
          lease.release();
          return;
        }
        this.lease = lease;
        lease.manager.on('exit', this.onServerExit);
        this.restartFailures = 0;
        this.ready = true;
        this.emit('message', { type: 'ready' });
      })
      .catch((err) => {
        this.ready = false;
        this.emit('message', { type: 'error', message: `Failed to start whisper.cpp backend: ${err.message || String(err)}` });
        this.restartAfterFailure();
      });
  }

  private restartAfterFailure(): void {
    if (this.disposed) return;
    this.restartFailures++;
    if (this.restartFailures >= 3) {
      this.ready = false;
      this.emit('message', { type: 'error', message: 'whisper.cpp backend failed repeatedly; fallback required' });
      return;
    }
    setTimeout(() => {
      if (!this.disposed) this.startServer();
    }, 1000 * this.restartFailures);
  }

  private releaseLease(): void {
    const lease = this.lease;
    this.lease = null;
    if (!lease) return;
    lease.manager.off('exit', this.onServerExit);
    lease.release();
  }
}
