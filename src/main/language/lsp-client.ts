import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { killProcessTree } from '../services/process-utils';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcRequest extends JsonRpcNotification {
  id: number;
}

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class LspClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 1;
  private readonly parser = new LspFrameParser();
  private readonly pending = new Map<number, PendingRequest>();

  start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
    this.child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => this.emit('log', chunk.toString('utf8')));
    this.child.once('error', (error) => this.failAll(error));
    this.child.once('close', (code) => {
      this.failAll(new Error(`clangd 已退出（代码 ${code ?? 'unknown'}）。`));
      this.emit('close', code);
    });
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('clangd 尚未启动。'));
    const id = this.sequence++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify('$/cancelRequest', { id });
        reject(new Error(`语言服务请求 ${method} 超时。`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
    });
    this.write({ jsonrpc: '2.0', id, method, params: params ?? {} });
    return promise;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) return;
    this.write({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    try {
      await this.request('shutdown', {}, 2000);
      this.notify('exit');
    } catch {
      // A forceful stop below is the fallback for an unresponsive server.
    }
    this.terminate();
  }

  terminate(): void {
    killProcessTree(this.child?.pid);
    this.child = undefined;
  }

  private write(message: object): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.child?.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child?.stdin.write(body);
  }

  private respond(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private consume(chunk: Buffer): void {
    try {
      for (const raw of this.parser.push(chunk)) this.handle(raw as JsonRpcResponse | JsonRpcNotification | JsonRpcRequest);
    } catch (error) {
      this.emit('log', `无法解析 LSP 消息：${String(error)}\n`);
    }
  }

  private handle(message: JsonRpcResponse | JsonRpcNotification | JsonRpcRequest): void {
    if ('id' in message && !('method' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}：${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if ('method' in message && 'id' in message) {
      if (message.method === 'workspace/configuration') {
        const items = Array.isArray(message.params?.items) ? message.params.items : [];
        this.respond(message.id, items.map(() => null));
      } else {
        this.respond(message.id, null);
      }
      return;
    }
    if ('method' in message) this.emit('notification', message.method, message.params ?? {});
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class LspFrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): object[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: object[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return messages;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/iu);
      if (!lengthMatch) throw new Error('LSP 消息缺少 Content-Length。');
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return messages;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      messages.push(JSON.parse(body) as object);
    }
  }
}
