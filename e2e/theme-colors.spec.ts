import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('浅色与深色主题的主要按钮保持清晰可读', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-theme-'));
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-theme-user-'));
  await fs.writeFile(path.join(projectPath, 'main.cpp'), 'int main(){return 0;}\n');
  const launch = () => electron.launch({ args: [path.resolve('.'), `--user-data-dir=${userDataPath}`] });
  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.evaluate(async (rootPath) => {
      await window.starcode.projects.openPath(rootPath);
      await window.starcode.projects.setState({ theme: 'light' });
    }, projectPath);
    ({ application, window } = await restart(application, launch));
    await expect(window.locator('.app')).toHaveAttribute('data-theme', 'light');
    await assertButtonContrast(window, 'light');

    await window.evaluate(() => window.starcode.projects.setState({ theme: 'dark' }));
    ({ application, window } = await restart(application, launch));
    await expect(window.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await assertButtonContrast(window, 'dark');
  } finally {
    await application.close();
    await fs.rm(projectPath, { recursive: true, force: true });
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});

async function assertButtonContrast(window: Page, theme: 'light' | 'dark'): Promise<void> {
  const run = window.getByRole('button', { name: /^运行$/u });
  await expect(run).toBeEnabled();
  expect(await contrastOf(run), `${theme} 主题运行按钮`).toBeGreaterThanOrEqual(4.5);

  const compile = window.getByRole('button', { name: /^编译$/u });
  await compile.hover();
  const compileColors = await colorsOf(compile);
  expect(contrast(compileColors.foreground, compileColors.background), `${theme} 主题悬停按钮 ${JSON.stringify(compileColors)}`).toBeGreaterThanOrEqual(4.5);

  const newFile = window.getByTitle('新建文件').first();
  await newFile.focus();
  const outline = await newFile.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');

  await newFile.click();
  const primary = window.getByRole('button', { name: '创建文件' });
  expect(await contrastOf(primary), `${theme} 主题主按钮`).toBeGreaterThanOrEqual(4.5);
  await window.getByRole('button', { name: '取消' }).click();
}

async function contrastOf(locator: ReturnType<Page['locator']>): Promise<number> {
  const colors = await colorsOf(locator);
  return contrast(colors.foreground, colors.background);
}

async function colorsOf(locator: ReturnType<Page['locator']>): Promise<{ foreground: string; background: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
}

function contrast(foreground: string, background: string): number {
  const fg = rgb(foreground);
  const bg = rgb(background);
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) throw new Error(`无法解析颜色 ${value}`);
  return channels as [number, number, number];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

async function restart(application: ElectronApplication, launch: () => Promise<ElectronApplication>): Promise<{ application: ElectronApplication; window: Page }> {
  await application.close();
  const next = await launch();
  return { application: next, window: await next.firstWindow() };
}
