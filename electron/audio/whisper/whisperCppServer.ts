import { EventEmitter } from 'events';
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import { encodeFloat32Wav } from './wav';
import { getWhisperCppServerPath, getWhisperCppModelPath, type WhisperCppModelKey } from './whisperCppAssets';

export function hasNvidiaCudaSync(
  spawnSyncImpl: typeof spawnSync = spawnSync,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NATIVELY_STT_FORCE_NO_CUDA === '1') return false;
  if (platform !== 'win32') return false;
  const result = spawnSyncImpl('nvidia-smi', ['-L'], { encoding: 'utf8', timeout: 2500, windowsHide: true });
  return result.status === 0 && /GPU\s+\d+/i.test(result.stdout || '');
}

export function whisperLanguageCode(key: string): string {
  const map: Record<string, string> = {
    auto: 'auto',
    'en-US': 'en',
    'en-GB': 'en',
    'ja-JP': 'ja',
    'fr-FR': 'fr',
    'de-DE': 'de',
    'es-ES': 'es',
    'ko-KR': 'ko',
    'zh-CN': 'zh',
    'zh-TW': 'zh',
    'pt-BR': 'pt',
    'it-IT': 'it',
    'ru-RU': 'ru',
    ar: 'ar',
    'hi-IN': 'hi',
  };
  return map[key] ?? 'auto';
}

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('Unable to allocate localhost port'));
      });
    });
  });
}

function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`whisper-server did not open port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 250);
        }
      });
    };
    tryConnect();
  });
}

function multipartField(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

export function postWhisperCppInference(port: number, audio: Float32Array, language: string, timeoutMs = 30000): Promise<string> {
  const boundary = `----natively-whispercpp-${Date.now().toString(16)}`;
  const wav = encodeFloat32Wav(audio, 16000);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="segment.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    wav,
    Buffer.from('\r\n'),
    multipartField(boundary, 'language', whisperLanguageCode(language)),
    multipartField(boundary, 'response_format', 'json'),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/inference',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          reject(new Error(`whisper-server HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
          return;
        }
        try {
          const json = JSON.parse(raw);
          resolve(String(json.text ?? '').trim());
        } catch {
          resolve(raw.trim());
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`whisper-server request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export class WhisperCppServerManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private port = 0;

  constructor(private readonly model: WhisperCppModelKey) {
    super();
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<number> {
    if (this.child && this.port) return this.port;

    const serverPath = getWhisperCppServerPath();
    const modelPath = getWhisperCppModelPath(this.model);
    this.port = await allocatePort();
    const args = ['-m', modelPath, '-l', 'ja', '-nt', '-t', '8', '--host', '127.0.0.1', '--port', String(this.port)];

    this.child = spawn(serverPath, args, {
      cwd: path.dirname(serverPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', data => console.log(`[whisper-server] ${String(data).trim()}`));
    this.child.stderr.on('data', data => console.warn(`[whisper-server] ${String(data).trim()}`));
    this.child.once('exit', (code, signal) => {
      this.child = null;
      const oldPort = this.port;
      this.port = 0;
      this.emit('exit', { code, signal, port: oldPort });
    });

    await waitForPort(this.port);
    await postWhisperCppInference(this.port, new Float32Array(16000), 'ja-JP', 60000);
    return this.port;
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.port = 0;
    if (!child) return;
    child.removeAllListeners('exit');
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        child.kill();
      }
    } catch {
      // Ignore shutdown races.
    }
  }
}
