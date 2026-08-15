import { X } from 'lucide-react';
import { useState } from 'react';
import { CPP_STANDARDS, type CppStandard, type ProjectConfigV1 } from '../../shared/contracts';

interface Props {
  initial: ProjectConfigV1;
  onSave(config: ProjectConfigV1): void;
  onClose(): void;
}

export function ProjectConfigDialog({ initial, onSave, onClose }: Props) {
  const [config, setConfig] = useState(initial);
  const setLines = (key: 'sources' | 'includeDirs' | 'defines' | 'extraCompilerArgs' | 'runArgs', value: string) => {
    setConfig({ ...config, [key]: value.split('\n').map((line) => line.trim()).filter(Boolean) });
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-title"><div><h2>项目设置</h2><p>.starcode/project.json</p></div><button onClick={onClose} title="关闭项目设置" aria-label="关闭项目设置"><X size={18} /></button></div>
      <div className="form-grid">
        <label>项目名称<input value={config.name} onChange={(event) => setConfig({ ...config, name: event.target.value })} /></label>
        <label>入口文件<input value={config.entry} onChange={(event) => setConfig({ ...config, entry: event.target.value })} /></label>
        <label>C++ 标准<select value={config.standard} onChange={(event) => setConfig({ ...config, standard: event.target.value as CppStandard })}>{CPP_STANDARDS.map((standard) => <option key={standard}>{standard}</option>)}</select></label>
        <label>工作目录<input value={config.workingDirectory} onChange={(event) => setConfig({ ...config, workingDirectory: event.target.value })} /></label>
        <label className="span-two">源文件（每行一个，相对项目目录）<textarea value={config.sources.join('\n')} onChange={(event) => setLines('sources', event.target.value)} /></label>
        <label>包含目录<textarea value={config.includeDirs.join('\n')} onChange={(event) => setLines('includeDirs', event.target.value)} /></label>
        <label>预处理宏<textarea value={config.defines.join('\n')} onChange={(event) => setLines('defines', event.target.value)} /></label>
        <label>额外编译参数<textarea value={config.extraCompilerArgs.join('\n')} onChange={(event) => setLines('extraCompilerArgs', event.target.value)} /></label>
        <label>运行参数<textarea value={config.runArgs.join('\n')} onChange={(event) => setLines('runArgs', event.target.value)} /></label>
      </div>
      <div className="modal-footer"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave(config)}>保存项目设置</button></div>
    </div>
  </div>;
}
