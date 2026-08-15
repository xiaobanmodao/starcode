/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestPanel } from '../src/renderer/components/TestPanel';
import type { TestCaseResult, TestSuiteV1 } from '../src/shared/contracts';

afterEach(cleanup);

describe('样例结果面板', () => {
  it('显示首次差异行、退出代码和错误输出', () => {
    const suite: TestSuiteV1 = {
      version: 1,
      target: 'main.cpp',
      cases: [{ id: 'case-1', name: '样例 1', input: '1\n', expectedOutput: '2\n', timeoutMs: 2000 }],
    };
    const results: TestCaseResult[] = [{
      id: 'case-1',
      status: 'wrong-answer',
      actualOutput: '3\n',
      stderr: 'diagnostic output',
      exitCode: 0,
      durationMs: 12,
      firstDifferenceLine: 1,
    }];

    render(createElement(TestPanel, {
      suite,
      results,
      running: false,
      busy: false,
      onChange: vi.fn(),
      onSave: vi.fn(),
      onRun: vi.fn(),
      onImport: vi.fn(),
      onExport: vi.fn(),
    }));

    expect(screen.getByText('第 1 行首次不同')).toBeTruthy();
    expect(screen.getByText('退出代码：0')).toBeTruthy();
    expect(screen.getByText('运行 12 ms（不含编译）')).toBeTruthy();
    expect(screen.getByDisplayValue('diagnostic output')).toBeTruthy();
  });

  it('提供导入导出操作并按样例与忙碌状态禁用', () => {
    const onImport = vi.fn();
    const onExport = vi.fn();
    const baseProps = {
      results: [],
      running: false,
      busy: false,
      onChange: vi.fn(),
      onSave: vi.fn(),
      onRun: vi.fn(),
      onImport,
      onExport,
    };
    const suite: TestSuiteV1 = {
      version: 1,
      target: 'main.cpp',
      cases: [{ id: 'case-1', name: '样例 1', input: '', expectedOutput: '', timeoutMs: 2000 }],
    };
    const { rerender } = render(createElement(TestPanel, { ...baseProps, suite }));

    fireEvent.click(screen.getByRole('button', { name: '导入样例文件' }));
    fireEvent.click(screen.getByRole('button', { name: '导出样例文件' }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();

    rerender(createElement(TestPanel, { ...baseProps, suite: { ...suite, cases: [] } }));
    expect(screen.getByRole('button', { name: '导出样例文件' }).hasAttribute('disabled')).toBe(true);

    rerender(createElement(TestPanel, { ...baseProps, suite, busy: true }));
    expect(screen.getByRole('button', { name: '导入样例文件' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '导出样例文件' }).hasAttribute('disabled')).toBe(true);
  });
});
