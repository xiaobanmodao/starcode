import { describe, expect, it } from 'vitest';
import { CppLanguageAdapter } from '../src/main/services/cpp-adapter';

describe('C++ 诊断解析', () => {
  const adapter = new CppLanguageAdapter();

  it('解析 Clang/GCC 错误与警告', () => {
    const diagnostics = adapter.parseDiagnostics([
      'src/main.cpp:5:9: error: use of undeclared identifier x',
      'src/main.cpp:8:3: warning: unused variable y [-Wunused-variable]',
    ].join('\n'), '/project');
    expect(diagnostics).toMatchObject([
      { line: 5, column: 9, severity: 'error' },
      { line: 8, column: 3, severity: 'warning' },
    ]);
  });

  it('兼容 Windows 盘符路径', () => {
    const diagnostics = adapter.parseDiagnostics('C:\\work\\main.cpp:2:4: error: expected ;', 'C:\\work');
    expect(diagnostics[0]).toMatchObject({ line: 2, column: 4, severity: 'error' });
  });

  it('语言服务编译数据库复用项目标准、包含目录和宏', async () => {
    const commands = await adapter.createCompilationCommands({
      rootPath: '/project',
      activeFile: '/project/main.cpp',
      config: {
        version: 1,
        name: 'demo',
        entry: 'main.cpp',
        sources: ['main.cpp', 'solve.cpp'],
        standard: 'c++20',
        includeDirs: ['include'],
        defines: ['ONLINE_JUDGE'],
        extraCompilerArgs: ['-Wconversion'],
        runArgs: [],
        workingDirectory: '.',
      },
    });
    expect(commands).toHaveLength(2);
    expect(commands[0]?.arguments).toEqual(expect.arrayContaining([
      '-std=gnu++20',
      '-I/project/include',
      '-DONLINE_JUDGE',
      '-Wconversion',
      '-fsyntax-only',
    ]));
  }, 20000);
});
