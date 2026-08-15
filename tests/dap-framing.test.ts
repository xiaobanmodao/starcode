import { describe, expect, it } from 'vitest';
import { DapFrameParser } from '../src/main/debug/dap-client';

function frame(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

describe('DAP framing', () => {
  it('处理拆分到多个数据块中的消息', () => {
    const parser = new DapFrameParser();
    const payload = frame({ seq: 1, type: 'event', event: 'initialized' });
    expect(parser.push(payload.subarray(0, 12))).toEqual([]);
    expect(parser.push(payload.subarray(12))).toEqual([{ seq: 1, type: 'event', event: 'initialized' }]);
  });

  it('一次处理多条消息', () => {
    const parser = new DapFrameParser();
    const messages = parser.push(Buffer.concat([
      frame({ seq: 1, type: 'event', event: 'stopped' }),
      frame({ seq: 2, type: 'event', event: 'terminated' }),
    ]));
    expect(messages).toHaveLength(2);
  });
});
