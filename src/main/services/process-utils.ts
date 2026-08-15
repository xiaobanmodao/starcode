import { execFile } from 'node:child_process';

export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'], () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // The process exited after SIGTERM.
      }
    }, 1200).unref();
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already stopped.
    }
  }
}

export function displayCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/\s|["']/u.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
    .join(' ');
}
