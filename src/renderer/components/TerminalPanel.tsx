import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';

interface Props {
  mode: 'run' | 'debug' | 'idle';
  theme: 'dark' | 'light';
  clearToken: number;
  runningSince?: number;
  onReady(write: (data: string) => void, clear: () => void): void;
}

export function formatRuntime(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(3)} 秒`;
}

export function TerminalPanel({ mode, theme, clearToken, runningSince, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const modeRef = useRef(mode);
  const [elapsedMs, setElapsedMs] = useState(0);
  modeRef.current = mode;

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SFMono-Regular', Consolas, monospace",
      theme: theme === 'light'
        ? { background: '#ffffff', foreground: '#1e293b', cursor: '#0369a1', selectionBackground: '#bae6fd' }
        : { background: '#0d1117', foreground: '#d6deeb', cursor: '#7dd3fc', selectionBackground: '#334155' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    terminalRef.current = terminal;
    onReady((data) => terminal.write(data), () => terminal.clear());
    terminal.onData((data) => {
      if (modeRef.current === 'debug') void window.starcode.debug.command({ type: 'input', data });
      else window.starcode.run.input(data);
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      window.starcode.run.resize(terminal.cols, terminal.rows);
    });
    observer.observe(hostRef.current);
    return () => { observer.disconnect(); terminal.dispose(); };
  }, []);

  useEffect(() => { terminalRef.current?.clear(); }, [clearToken]);
  useEffect(() => {
    if (runningSince === undefined) {
      setElapsedMs(0);
      return undefined;
    }
    const update = () => setElapsedMs(Date.now() - runningSince);
    update();
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [runningSince]);
  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.theme = theme === 'light'
      ? { background: '#ffffff', foreground: '#1e293b', cursor: '#0369a1', selectionBackground: '#bae6fd' }
      : { background: '#0d1117', foreground: '#d6deeb', cursor: '#7dd3fc', selectionBackground: '#334155' };
  }, [theme]);
  return <div className="terminal-shell">
    <div ref={hostRef} className="terminal-host" />
    {runningSince !== undefined && <div className="terminal-runtime" role="status">[运行时间：{formatRuntime(elapsedMs)}]</div>}
  </div>;
}
