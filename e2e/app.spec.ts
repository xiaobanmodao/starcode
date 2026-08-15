import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('编辑器可编辑、布局正常，并完成新建、编译与运行闭环', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-e2e-'));
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-e2e-user-'));
  await fs.writeFile(path.join(projectPath, 'main.cpp'), '#include <iostream>\nint main(){std::cout << "StarCode" << "\\n";}\n');
  const launch = () => electron.launch({ args: [path.resolve('.'), `--user-data-dir=${userDataPath}`] });
  let application = await launch();
  try {
    let window = await application.firstWindow();
    await expect(window.getByText('StarCode', { exact: true }).first()).toBeVisible();
    await expect(window.getByRole('button', { name: /编译/u })).toBeVisible();
    const result = await window.evaluate(async (rootPath) => {
      const project = await window.starcode.projects.openPath(rootPath);
      const toolchain = await window.starcode.toolchain.detect();
      return { projectName: project.rootPath.split('/').at(-1), toolchain };
    }, projectPath);
    expect(result.projectName).toBe(path.basename(projectPath));
    expect(result.toolchain.message).toBeTruthy();

    await application.close();
    application = await launch();
    window = await application.firstWindow();
    await expect(window.locator('.monaco-editor')).toBeVisible();
    await expect(window.getByText('Loading...', { exact: true })).toHaveCount(0);
    const layout = await window.evaluate(() => ({
      workspaceHeight: document.querySelector('.workspace')?.getBoundingClientRect().height ?? 0,
      statusHeight: document.querySelector('.statusbar')?.getBoundingClientRect().height ?? 0,
      appHeight: document.querySelector('.app')?.getBoundingClientRect().height ?? 0,
    }));
    expect(layout.workspaceHeight).toBeGreaterThan(layout.appHeight * 0.5);
    expect(layout.statusHeight).toBeGreaterThanOrEqual(20);
    expect(layout.statusHeight).toBeLessThanOrEqual(24);

    await window.locator('.monaco-editor').click();
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await window.keyboard.insertText('// 编辑器输入验证');
    await expect(window.locator('.tab.active')).toContainText('●');
    const saveButton = window.getByTitle('保存');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect.poll(() => fs.readFile(path.join(projectPath, 'main.cpp'), 'utf8')).toContain('编辑器输入验证');

    await window.getByTitle('新建文件').first().click();
    await expect(window.getByRole('heading', { name: '新建 C++ 文件' })).toBeVisible();
    await window.getByLabel('新文件路径').fill('created.cpp');
    await window.getByRole('button', { name: '创建文件' }).click();
    await expect(window.locator('.tab').filter({ hasText: 'created.cpp' })).toBeVisible();
    expect(await fs.readFile(path.join(projectPath, 'created.cpp'), 'utf8')).toContain('#include <iostream>');

    await window.locator('.tab').filter({ hasText: 'main.cpp' }).click();
    if (result.toolchain.ready) {
      await window.getByRole('button', { name: /^运行$/u }).click();
      await expect(window.locator('.xterm-rows')).toContainText('StarCode', { timeout: 30000 });
      await expect(window.locator('.xterm-rows')).toContainText('程序已退出', { timeout: 30000 });
      await expect(window.locator('.xterm-rows')).toContainText('StarCode');
    }
  } finally {
    await application.close();
    await fs.rm(projectPath, { recursive: true, force: true });
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});
