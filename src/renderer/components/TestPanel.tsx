import { Copy, FolderInput, FolderOutput, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TestCaseResult, TestCaseV1, TestSuiteV1 } from '../../shared/contracts';

interface Props {
  suite?: TestSuiteV1;
  results: TestCaseResult[];
  running: boolean;
  busy: boolean;
  onChange(suite: TestSuiteV1): void;
  onSave(): void;
  onRun(): void;
  onImport(): void;
  onExport(): void;
}

const resultLabel = {
  passed: '通过',
  'wrong-answer': '答案错误',
  'runtime-error': '运行错误',
  timeout: '超时',
  cancelled: '已取消',
};

export function TestPanel({ suite, results, running, busy, onChange, onSave, onRun, onImport, onExport }: Props) {
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => {
    if (!suite?.cases.some((item) => item.id === selectedId)) setSelectedId(suite?.cases[0]?.id);
  }, [suite, selectedId]);
  if (!suite) return <div className="panel-placeholder">打开项目中的 C++ 文件后即可管理样例。</div>;
  const selected = suite.cases.find((item) => item.id === selectedId);
  const selectedResult = results.find((entry) => entry.id === selectedId);
  const updateCase = (patch: Partial<TestCaseV1>) => {
    if (!selected) return;
    onChange({ ...suite, cases: suite.cases.map((item) => item.id === selected.id ? { ...item, ...patch } : item) });
  };
  const add = () => {
    const item: TestCaseV1 = { id: crypto.randomUUID(), name: `样例 ${suite.cases.length + 1}`, input: '', expectedOutput: '', timeoutMs: 2000 };
    onChange({ ...suite, cases: [...suite.cases, item] });
    setSelectedId(item.id);
  };
  const duplicate = () => {
    if (!selected) return;
    const item = { ...selected, id: crypto.randomUUID(), name: `${selected.name} 副本` };
    onChange({ ...suite, cases: [...suite.cases, item] });
    setSelectedId(item.id);
  };
  const remove = () => {
    if (!selected) return;
    onChange({ ...suite, cases: suite.cases.filter((item) => item.id !== selected.id) });
  };
  return <div className="test-panel">
    <div className="test-list">
      <div className="test-actions">
        <button onClick={add}><Plus size={14} />新增</button>
        <button onClick={duplicate} disabled={!selected} title="复制样例" aria-label="复制样例"><Copy size={14} /></button>
        <button onClick={remove} disabled={!selected} title="删除样例" aria-label="删除样例"><Trash2 size={14} /></button>
        <button onClick={onImport} disabled={busy} title="导入样例文件" aria-label="导入样例文件"><FolderInput size={14} /></button>
        <button onClick={onExport} disabled={busy || !suite.cases.length} title="导出样例文件" aria-label="导出样例文件"><FolderOutput size={14} /></button>
      </div>
      {suite.cases.map((item) => {
        const result = results.find((entry) => entry.id === item.id);
        return <button key={item.id} className={`test-item ${item.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
          <span>{item.name}</span>
          {result && <span className={`result-badge ${result.status}`} title="仅统计程序执行时间，不包含编译">{resultLabel[result.status]} · {result.durationMs}ms</span>}
        </button>;
      })}
    </div>
    <div className="test-editor">
      {selected ? <>
        <div className="test-header">
          <input value={selected.name} onChange={(event) => updateCase({ name: event.target.value })} aria-label="样例名称" />
          <label>超时 <input type="number" min={100} max={60000} step={100} value={selected.timeoutMs} onChange={(event) => updateCase({ timeoutMs: Number(event.target.value) })} /> ms</label>
          <button onClick={onSave}><Save size={14} />保存样例</button>
          <button className="primary" onClick={onRun} disabled={running || !suite.cases.length}><Play size={14} />运行全部</button>
        </div>
        {selectedResult && <div className={`test-result-summary ${selectedResult.status}`}>
          <strong>{resultLabel[selectedResult.status]}</strong>
          <span title="仅统计程序执行时间，不包含编译">运行 {selectedResult.durationMs} ms（不含编译）</span>
          <span>退出代码：{selectedResult.exitCode ?? '无'}</span>
          {selectedResult.firstDifferenceLine && <span>第 {selectedResult.firstDifferenceLine} 行首次不同</span>}
        </div>}
        <div className={`test-io-grid ${selectedResult ? 'with-summary' : ''}`}>
          <label>标准输入<textarea value={selected.input} onChange={(event) => updateCase({ input: event.target.value })} spellCheck={false} /></label>
          <label>期望输出<textarea value={selected.expectedOutput} onChange={(event) => updateCase({ expectedOutput: event.target.value })} spellCheck={false} /></label>
          {selectedResult && <label>实际输出<textarea readOnly value={selectedResult.actualOutput} /></label>}
          {selectedResult?.stderr && <label>错误输出<textarea readOnly value={selectedResult.stderr} /></label>}
        </div>
      </> : <div className="panel-placeholder">添加一组样例开始测试。</div>}
    </div>
  </div>;
}
