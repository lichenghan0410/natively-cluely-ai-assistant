// @huggingface/transformers is ESM-only — must use dynamic import()
import path from 'path';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  // Name bumped from 'local' so the existing provider-switch detection
  // (EmbeddingPipeline / getIncompatibleMeetingsCount) treats old all-MiniLM
  // 'local' embeddings as incompatible and triggers a re-index — otherwise the
  // same 384-dim + same 'local' name would let all-MiniLM vectors silently mix
  // with e5 vectors in search. The Modes/assist path re-embeds in memory per
  // query, so it is unaffected either way.
  readonly name = 'local-e5-small';
  readonly dimensions = 384; // multilingual-e5-small — same dim as the prior all-MiniLM ⇒ zero vec-table migration

  private pipe: any = null;
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private modelPath: string;

  constructor() {
    // Point to the bundled model inside the app's resources.
    // In dev: __dirname = dist-electron/electron/rag/providers → need 4 levels up to project root.
    // In prod: app.isPackaged = true → use process.resourcesPath (electron-builder extraResources).
    this.modelPath = path.join(
      app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../../../resources'),
      'models'
    );
  }

  async isAvailable(): Promise<boolean> {
    // Local model is ALWAYS available after install — this is the guarantee
    try {
      await this.ensureLoaded();
      return true;
    } catch (e) {
      console.error('[LocalEmbeddingProvider] Model failed to load:', e);
      return false;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipe) return;

    // If another caller already kicked off loading, wait for that same promise
    // rather than launching a second concurrent pipeline() call.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      // Use new Function() to force a true ESM dynamic import at runtime.
      // TypeScript with module:commonjs rewrites `await import(...)` to
      // `Promise.resolve().then(() => require(...))`, which fails for ESM-only
      // packages like @huggingface/transformers. The new Function() trick is opaque
      // to the TypeScript compiler so it is left as a real import() call.
      const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

      // Tell transformers.js to use the local path, never download in production
      env.allowRemoteModels = false;
      env.localModelPath = this.modelPath;

      this.pipe = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        local_files_only: true,
        // int8 quantized weights (onnx/model_quantized.onnx, ~112MB vs 448MB fp32).
        // JA retrieval spike: P@3 unchanged (1.0), P@1 0.79→0.71, ~4x faster — and
        // still far above the old all-MiniLM. Revert to 'fp32' if P@1 ever matters.
        dtype: 'q8',
      });
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      // Reset so a future call can retry
      this.loadingPromise = null;
      throw e;
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    // e5 is asymmetric: documents/passages take the "passage:" prefix.
    const output = await this.pipe(`passage: ${text}`, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedQuery(text: string): Promise<number[]> {
    await this.ensureLoaded();
    // e5 is asymmetric: search queries take the "query:" prefix (NOT symmetric
    // with embed(), unlike the previous all-MiniLM model).
    const output = await this.pipe(`query: ${text}`, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    // transformers.js handles batching internally; each passage gets the e5 prefix.
    const output = await this.pipe(texts.map(t => `passage: ${t}`), { pooling: 'mean', normalize: true });
    // output.data is flat [n * 384], reshape it
    const batchSize = texts.length;
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      result.push(Array.from(output.data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }
}
