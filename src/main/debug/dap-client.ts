import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { killProcessTree } from '../services/process-utils';

interface DapProtocolMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

interface DapResponse extends DapProtocolMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}

interface DapEvent extends DapProtocolMessage {
  type: 'event';
  event: string;
  body?: Record<string, unknown>;
}

interface DapRequest extends DapProtocolMessage {
  type: 'request';
  command: string;
  arguments?: Record<string, unknown>;
}

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class DapClient extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private sequence = 1;
  private readonly parser = new DapFrameParser();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly seenEvents = new Set<string>();

  start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
    this.process = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.process.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    this.process.stderr.on('data', (chunk: Buffer) => this.emit('adapterOutput', chunk.toString('utf8')));
    this.process.on('error', (error) => this.failAll(error));
    this.process.on('close', (code) => {
      this.failAll(new Error(`调试适配器已退出（代码 ${code ?? 'unknown'}）。`));
      this.emit('close', code);
    });
  }

  async request<T = unknown>(command: string, args?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    if (!this.process?.stdin.writable) throw new Error('调试适配器未启动。');
    const seq = this.sequence++;
    const message = { seq, type: 'request', command, arguments: args };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`调试请求 ${command} 超时。`));
      }, timeoutMs);
      this.pending.set(seq, { command, resolve: resolve as (value: unknown) => void, reject, timer });
    });
    this.write(message);
    return promise;
  }

  waitForEvent(event: string, timeoutMs = 10000): Promise<void> {
    if (this.seenEvents.has(event)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(`event:${event}`, handler);
        reject(new Error(`等待调试事件 ${event} 超时。`));
      }, timeoutMs);
      const handler = () => {
        clearTimeout(timer);
        resolve();
      };
      this.once(`event:${event}`, handler);
    });
  }

  respond(request: DapRequest, success: boolean, body?: Record<string, unknown>, message?: string): void {
    this.write({
      seq: this.sequence++,
      type: 'response',
      request_seq: request.seq,
      success,
      command: request.command,
      body,
      message,
    });
  }

  terminate(): void {
    killProcessTree(this.process?.pid);
    this.process = undefined;
  }

  private write(message: object): void {
    this.emit('protocolOut', message);
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.process?.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.process?.stdin.write(body);
  }

  private consume(chunk: Buffer): void {
    try {
      for (const message of this.parser.push(chunk)) {
        this.emit('protocol', message);
        this.handle(message as DapResponse | DapEvent | DapRequest);
      }
    } catch (error) {
      this.emit('adapterOutput', `无法解析 DAP 消息：${String(error)}\n`);
    }
  }

  private handle(message: DapResponse | DapEvent | DapRequest): void {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      this.pending.delete(message.request_seq);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message.body);
      else {
        const body = message.body as { error?: { format?: string }; message?: string } | undefined;
        const detail = message.message || body?.error?.format || body?.message;
        pending.reject(new Error(detail ? `${pending.command}：${detail}` : `${pending.command} 调试请求失败。`));
      }
      return;
    }
    if (message.type === 'event') {
      this.seenEvents.add(message.event);
      this.emit('event', message);
      this.emit(`event:${message.event}`, message.body);
      return;
    }
    this.emit('request', message);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class DapFrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): DapProtocolMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: DapProtocolMessage[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return messages;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) throw new Error('DAP 消息缺少 Content-Length。');
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return messages;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      messages.push(JSON.parse(body) as DapProtocolMessage);
    }
  }
}

export type { DapEvent, DapRequest };
