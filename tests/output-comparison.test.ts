import { describe, expect, it } from 'vitest';
import { firstDifferenceLine, normalizeOutput } from '../src/main/services/test-service';

describe('样例输出比较', () => {
  it('统一换行并忽略行末空白与末尾空行', () => {
    expect(normalizeOutput('1  \r\n2\t\r\n\r\n')).toBe('1\n2');
  });

  it('保留行内空格差异', () => {
    expect(normalizeOutput('a  b\n')).not.toBe(normalizeOutput('a b\n'));
  });

  it('返回第一处不同的行号', () => {
    expect(firstDifferenceLine('one\ntwo\nthree', 'one\nTWO\nthree')).toBe(2);
    expect(firstDifferenceLine('same\n', 'same')).toBeUndefined();
  });
});
