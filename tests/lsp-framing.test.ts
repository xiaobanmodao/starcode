import { describe, expect, it } from 'vitest';
import { LspFrameParser } from '../src/main/language/lsp-client';

function frame(value: object): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

describe('LSP framing', () => {
  it('可以解析拆分到多个数据块的 UTF-8 消息', () => {
    const parser = new LspFrameParser();
    const data = frame({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: '索引完成' } });
    expect(parser.push(data.subarray(0, 17))).toEqual([]);
    expect(parser.push(data.subarray(17))).toEqual([
      { jsonrpc: '2.0', method: 'window/logMessage', params: { message: '索引完成' } },
    ]);
  });

  it('可以连续解析多条消息', () => {
    const parser = new LspFrameParser();
    expect(parser.push(Buffer.concat([frame({ id: 1, result: null }), frame({ id: 2, result: [] })]))).toEqual([
      { id: 1, result: null },
      { id: 2, result: [] },
    ]);
  });
});
