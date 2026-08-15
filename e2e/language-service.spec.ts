import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('clangd、clang-format、兼容头和可调整面板形成完整编辑体验', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-language-'));
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-language-user-'));
  const sourcePath = path.join(projectPath, 'main.cpp');
  await fs.writeFile(sourcePath, '#include <bits/stdc++.h>\nint main(){std::vector<int> values; return values.size();}\n');
  const application = await electron.launch({ args: [path.resolve('.'), `--user-data-dir=${userDataPath}`] });
  try {
    const window = await application.firstWindow();
    await window.evaluate((rootPath) => window.starcode.projects.openPath(rootPath), projectPath);
    await application.close();

    const restarted = await electron.launch({ args: [path.resolve('.'), `--user-data-dir=${userDataPath}`] });
    try {
      const page = await restarted.firstWindow();
      await expect(page.locator('.monaco-editor')).toBeVisible();
      await expect(page.getByRole('button', { name: /C\+\+ 智能提示：就绪/u })).toBeVisible({ timeout: 30000 });

      const result = await page.evaluate(async ({ rootPath, filePath, uri }) => {
        const toolchain = await window.starcode.toolchain.detect();
        const diskText = '#include <bits/stdc++.h>\nint main(){std::vector<int> values; return values.size();}\n';
        const build = await window.starcode.build.start({ rootPath, activeFile: filePath, mode: 'release' });
        const formatted = await window.starcode.language.format({ path: filePath, text: 'int main(){int x=1;return x;}\n' });
        const completionText = '#include <bits/stdc++.h>\nint main(){std::vector<int> a; a.pu}\n';
        const character = completionText.split('\n')[1]!.indexOf('pu') + 2;
        await window.starcode.language.open({ rootPath, path: filePath, text: diskText, version: 20 });
        await window.starcode.language.change({ rootPath, path: filePath, text: completionText, version: 21 });
        const completion = await window.starcode.language.request({
          method: 'textDocument/completion',
          params: { textDocument: { uri }, position: { line: 1, character } },
        }) as { items?: Array<{ label?: string | { label?: string } }> } | Array<{ label?: string | { label?: string } }> | null;
        const items = Array.isArray(completion) ? completion : completion?.items ?? [];
        const labels = items.map((item) => typeof item.label === 'string' ? item.label : item.label?.label ?? '');
        return { build, formatted, labels, toolchain };
      }, { rootPath: projectPath, filePath: sourcePath, uri: pathToFileURL(sourcePath).href });

      expect(result.toolchain.languageServerReady).toBe(true);
      expect(result.toolchain.formatterReady).toBe(true);
      expect(result.build.success, result.build.output).toBe(true);
      expect(result.formatted).toContain('int main() {');
      expect(result.formatted).toContain('    int x = 1;');
      expect(result.labels.some((label) => label.includes('push_back'))).toBe(true);

      const panel = page.locator('.bottom-panel');
      const before = await panel.evaluate((element) => element.getBoundingClientRect().height);
      const handle = page.getByRole('separator', { name: '调整底部面板高度' });
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + 3);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width / 2, box!.y - 70);
      await page.mouse.up();
      const after = await panel.evaluate((element) => element.getBoundingClientRect().height);
      expect(after).toBeGreaterThan(before + 40);
      await expect.poll(() => page.evaluate(() => window.starcode.projects.getState().then((state) => state.bottomPanelHeight))).toBe(Math.round(after));

      await page.getByTitle('设置').click();
      await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
      await page.getByRole('button', { name: 'C++', exact: true }).click();
      await expect(page.getByText('C++ 智能提示已就绪。')).toBeVisible();
      await expect(page.getByLabel('格式化工具')).toHaveValue(/clang-format/u);
      await page.getByRole('button', { name: '编辑器', exact: true }).click();
      await page.getByRole('checkbox', { name: /保存时格式化/u }).check();
      await page.getByRole('button', { name: '保存设置' }).click();

      await page.locator('.monaco-editor').click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.insertText('int main(){int x=1;return x;}\n');
      await page.getByTitle('保存').click();
      await expect.poll(() => fs.readFile(sourcePath, 'utf8')).toContain('    int x = 1;');
      expect((await page.evaluate(() => window.starcode.projects.getState())).formatOnSave).toBe(true);

      await page.locator('.monaco-editor').click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.insertText('int main(){ return missing_name; }\n');
      await page.getByRole('button', { name: /问题/u }).click();
      await expect(page.locator('.diagnostic-source.clangd').first()).toBeVisible({ timeout: 15000 });
      await page.getByLabel('问题来源').selectOption('clangd');
      await expect(page.locator('.problems-list button').first()).toContainText('missing_name');
    } finally {
      await restarted.close();
    }
  } finally {
    await application.close().catch(() => undefined);
    await fs.rm(projectPath, { recursive: true, force: true });
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});
