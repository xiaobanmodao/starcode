import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const interactiveSource = [
  '#include <iostream>',
  'int main() {',
  '    int value = 0;',
  '    std::cin >> value;',
  '    std::cout << value * 2 << "\\n";',
  '    return 0;',
  '}',
  '',
].join('\n');

const debugSource = [
  '#include <iostream>',
  'int main() {',
  '    int value = 21;',
  '    std::cout << value * 2 << "\\n";',
  '    return 0;',
  '}',
  '',
].join('\n');

test('完整训练闭环：编辑、诊断、交互运行、样例、项目配置与调试', async () => {
  test.setTimeout(120000);
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-full-'));
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-full-user-'));
  const mainPath = path.join(projectPath, 'main.cpp');
  await fs.writeFile(mainPath, interactiveSource);
  const launch = () => electron.launch({ args: [path.resolve('.'), `--user-data-dir=${userDataPath}`] });
  let application = await launch();
  try {
    let window = await application.firstWindow();
    const toolchain = await window.evaluate(async ({ rootPath, sourcePath }) => {
      await window.starcode.projects.openPath(rootPath);
      await window.starcode.projects.setState({ theme: 'light', breakpoints: { [sourcePath]: [5] } });
      return window.starcode.toolchain.detect();
    }, { rootPath: projectPath, sourcePath: mainPath });

    ({ application, window } = await restart(application, launch));
    await expect(window.locator('.monaco-editor')).toBeVisible();

    // Monaco 查找、跳转与保存。
    await window.locator('.monaco-editor').click();
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await window.keyboard.insertText('value');
    await expect(window.locator('.find-widget')).toBeVisible();
    await window.keyboard.press('Escape');
    await window.keyboard.press('Control+g');
    await expect(window.locator('.quick-input-widget')).toBeVisible();
    await window.keyboard.insertText('5');
    await window.keyboard.press('Enter');
    await replaceEditor(window, `${interactiveSource}// 保存验证\n`);
    await expect.poll(() => fs.readFile(mainPath, 'utf8')).toContain('保存验证');

    // 项目内新建文件、重复文件错误与关闭标签。
    await window.getByTitle('新建文件').first().click();
    await window.getByLabel('新文件路径').fill('helper.cpp');
    await window.getByRole('button', { name: '创建文件' }).click();
    await expect(window.locator('.tab').filter({ hasText: 'helper.cpp' })).toBeVisible();
    await window.getByTitle('新建文件').first().click();
    await window.getByLabel('新文件路径').fill('helper.cpp');
    await window.getByRole('button', { name: '创建文件' }).click();
    await expect(window.locator('.toast')).toContainText('同名文件已经存在');
    await window.getByRole('button', { name: '取消' }).click();
    await window.locator('.tab').filter({ hasText: 'helper.cpp' }).locator('svg').click();
    await window.locator('.tab').filter({ hasText: 'main.cpp' }).click();

    if (toolchain.ready) {
      // 运行后等待输入、停止进程，再次运行并完成交互输入。
      const executablePath = path.join(projectPath, '.starcode', 'build', 'release', path.basename(mainPath, '.cpp'));
      await window.getByRole('button', { name: /^运行$/u }).click();
      await expect(window.getByRole('button', { name: '停止' })).toBeEnabled({ timeout: 30000 });
      await expect(window.locator('.terminal-runtime')).toContainText('[运行时间：');
      const initialRuntime = await window.locator('.terminal-runtime').textContent();
      await expect.poll(() => window.locator('.terminal-runtime').textContent()).not.toBe(initialRuntime);
      await expect.poll(() => fs.access(executablePath).then(() => true).catch(() => false), { timeout: 30000 }).toBe(true);
      await window.getByRole('button', { name: '停止' }).click();
      await expect(window.getByRole('button', { name: '停止' })).toBeDisabled({ timeout: 10000 });

      const previousBuildTime = (await fs.stat(executablePath)).mtimeMs;
      await window.getByRole('button', { name: /^运行$/u }).click();
      await expect.poll(async () => (await fs.stat(executablePath)).mtimeMs, { timeout: 30000 }).toBeGreaterThan(previousBuildTime);
      await window.locator('.xterm-helper-textarea').evaluate((element: HTMLTextAreaElement) => element.focus());
      await window.keyboard.type('21');
      await window.keyboard.press('Enter');
      await expect(window.locator('.xterm-rows')).toContainText('42', { timeout: 30000 });
      await expect(window.locator('.xterm-rows')).toContainText('程序已退出');
      await expect(window.locator('.xterm-rows')).toContainText('运行时间');

      // 样例新增、复制、删除、保存、通过与错误差异。
      await window.getByRole('button', { name: '样例' }).click();
      await expect(window.getByRole('button', { name: '导入样例文件' })).toBeVisible();
      await expect(window.getByRole('button', { name: '导出样例文件' })).toBeDisabled();
      await window.getByRole('button', { name: /新增/u }).click();
      await expect(window.getByRole('button', { name: '导出样例文件' })).toBeEnabled();
      await window.getByLabel('样例名称').fill('双倍');
      await window.getByLabel('标准输入').fill('3\n');
      await window.getByLabel('期望输出').fill('6\n');
      await window.getByRole('button', { name: '保存样例' }).click();
      await window.locator('.test-actions button').nth(1).click();
      await expect(window.locator('.test-item')).toHaveCount(2);
      await window.locator('.test-actions button').nth(2).click();
      await expect(window.locator('.test-item')).toHaveCount(1);
      await window.getByRole('button', { name: '运行全部' }).click();
      await expect(window.getByText(/通过 ·/u)).toBeVisible({ timeout: 30000 });
      await window.getByLabel('期望输出').fill('7\n');
      await window.getByRole('button', { name: '运行全部' }).click();
      await expect(window.getByText('第 1 行首次不同')).toBeVisible({ timeout: 30000 });

      // 统一设置中心持久化 C++20 与显式单源文件清单。
      await window.getByTitle('设置').click();
      await window.getByRole('button', { name: '项目', exact: true }).click();
      await window.getByLabel('C++ 标准').selectOption('c++20');
      await window.getByLabel(/源文件/u).fill('main.cpp');
      await window.getByRole('button', { name: '保存设置' }).click();
      await expect.poll(() => fs.access(path.join(projectPath, '.starcode', 'project.json')).then(() => true).catch(() => false)).toBe(true);
      const config = JSON.parse(await fs.readFile(path.join(projectPath, '.starcode', 'project.json'), 'utf8')) as { standard: string; sources: string[] };
      expect(config).toMatchObject({ standard: 'c++20', sources: ['main.cpp'] });

      // 编译错误进入问题面板，点击可回到对应位置。
      await replaceEditor(window, 'int main( {\n');
      await window.getByRole('button', { name: /^编译$/u }).click();
      const problem = window.locator('.problems-list button').first();
      await expect(problem).toContainText('错误', { timeout: 30000 });
      await problem.click();
      await expect(window.locator('.monaco-editor')).toBeVisible();

      // 恢复代码并在重启后验证断点、局部变量、监视表达式、单步与继续。
      await replaceEditor(window, debugSource);
      await window.evaluate(({ sourcePath }) => window.starcode.projects.setState({ breakpoints: { [sourcePath]: [4] } }), { sourcePath: mainPath });
      ({ application, window } = await restart(application, launch));
      if (toolchain.debuggerReady) {
        await window.getByRole('button', { name: /^调试$/u }).click();
        await expect(window.locator('.debug-row').filter({ hasText: 'value' })).toContainText('21', { timeout: 30000 });
        await expect(window.locator('.stack-frame').first()).toContainText('main');
        await window.getByPlaceholder('输入表达式').fill('value + 1');
        await window.locator('.watch-input button').click();
        await expect(window.locator('.debug-row').filter({ hasText: 'value + 1' })).toContainText('22');
        await window.getByTitle('单步跳过').click();
        await expect(window.locator('.stack-frame').first()).toContainText('main');
        await window.getByTitle('继续').click();
        await expect(window.getByText('就绪').last()).toBeVisible({ timeout: 30000 });
      }
    }
  } finally {
    await application.close();
    await fs.rm(projectPath, { recursive: true, force: true });
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});

async function replaceEditor(window: Page, content: string): Promise<void> {
  await window.locator('.monaco-editor').click();
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await window.keyboard.insertText(content);
  await window.getByTitle('保存').click();
}

async function restart(application: ElectronApplication, launch: () => Promise<ElectronApplication>): Promise<{ application: ElectronApplication; window: Page }> {
  await application.close();
  const next = await launch();
  return { application: next, window: await next.firstWindow() };
}
