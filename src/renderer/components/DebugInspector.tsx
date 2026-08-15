import { ChevronRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { DebugSnapshot } from '../../shared/contracts';

interface Props {
  snapshot?: DebugSnapshot;
  onFrame(path: string, line: number): void;
  onEvaluate(expression: string): Promise<string>;
}

export function DebugInspector({ snapshot, onFrame, onEvaluate }: Props) {
  const [watches, setWatches] = useState<Array<{ expression: string; value: string }>>([]);
  const [expression, setExpression] = useState('');
  const addWatch = async () => {
    const trimmed = expression.trim();
    if (!trimmed) return;
    const value = await onEvaluate(trimmed);
    setWatches([...watches, { expression: trimmed, value }]);
    setExpression('');
  };
  return <aside className="debug-inspector">
    <section>
      <h3>变量</h3>
      {!snapshot?.variables.length && <p className="muted">程序暂停后显示局部变量</p>}
      {snapshot?.variables.map((variable, index) => <div className="debug-row" key={`${variable.name}-${index}`}><span>{variable.name}</span><code>{variable.value}</code></div>)}
    </section>
    <section>
      <h3>监视</h3>
      {watches.map((watch, index) => <div className="debug-row" key={`${watch.expression}-${index}`}><span>{watch.expression}</span><code>{watch.value}</code><button className="icon-button" title="删除监视表达式" aria-label={`删除监视表达式 ${watch.expression}`} onClick={() => setWatches(watches.filter((_, item) => item !== index))}><X size={12} /></button></div>)}
      <div className="watch-input"><input value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addWatch(); }} placeholder="输入表达式" /><button onClick={() => void addWatch()} title="添加监视表达式" aria-label="添加监视表达式"><Plus size={13} /></button></div>
    </section>
    <section>
      <h3>调用栈</h3>
      {snapshot?.frames.map((frame) => <button className="stack-frame" key={frame.id} onClick={() => frame.source?.path && onFrame(frame.source.path, frame.line)}><ChevronRight size={13} /><span>{frame.name}</span><small>{frame.source?.name}:{frame.line}</small></button>)}
    </section>
  </aside>;
}
