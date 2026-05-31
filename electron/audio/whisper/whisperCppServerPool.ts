import type { EventEmitter } from 'events';
import type { WhisperCppModelKey } from './whisperCppAssets';
import { WhisperCppServerManager } from './whisperCppServer';

type ServerLike = EventEmitter & {
  getPort(): number;
  start(): Promise<number>;
  dispose(): void;
};

export interface WhisperCppServerLease {
  manager: ServerLike;
  port: number;
  release(): void;
}

interface PoolEntry {
  manager: ServerLike;
  refs: number;
  startPromise: Promise<number>;
}

export class WhisperCppServerPool {
  private entries = new Map<WhisperCppModelKey, PoolEntry>();

  constructor(private readonly createServer: (model: WhisperCppModelKey) => ServerLike = (model) => new WhisperCppServerManager(model)) {}

  async acquire(model: WhisperCppModelKey): Promise<WhisperCppServerLease> {
    let entry = this.entries.get(model);
    if (!entry) {
      const manager = this.createServer(model);
      entry = {
        manager,
        refs: 0,
        startPromise: manager.start(),
      };
      manager.once('exit', () => {
        if (this.entries.get(model) === entry) {
          this.entries.delete(model);
        }
      });
      this.entries.set(model, entry);
    }

    entry.refs++;
    try {
      const port = await entry.startPromise;
      let released = false;
      return {
        manager: entry.manager,
        port,
        release: () => {
          if (released) return;
          released = true;
          this.release(model, entry!);
        },
      };
    } catch (err) {
      this.release(model, entry);
      throw err;
    }
  }

  private release(model: WhisperCppModelKey, entry: PoolEntry): void {
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    if (this.entries.get(model) !== entry) return;
    this.entries.delete(model);
    entry.manager.dispose();
  }
}

export const whisperCppServerPool = new WhisperCppServerPool();
