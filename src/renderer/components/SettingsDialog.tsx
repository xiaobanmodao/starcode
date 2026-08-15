import { RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import {
  CPP_STANDARDS,
  type AppState,
  type CppStandard,
  type LanguageServiceStatus,
  type ProjectConfigV1,
  type ToolchainStatus,
} from '../../shared/contracts';

type SettingsTab = 'editor' | 'cpp' | 'project';

interface Props {
  appState: AppState;
  toolchain?: ToolchainStatus;
  languageStatus: LanguageServiceStatus;
  initialProject?: ProjectConfigV1;
  onSave(patch: Pick<AppState, 'theme' | 'editorFontSize' | 'editorTabSize' | 'formatOnSave' | 'languageIntelligenceEnabled'>, project?: ProjectConfigV1): void;
  onRestartLanguage(): void;
  onClose(): void;
}

const statusText: Record<LanguageServiceStatus['state'], string> = {
  stopped: '已关闭',
  starting: '启动中',
  indexing: '索引中',
  ready: '就绪',
  error: '异常',
};

export function SettingsDialog({ appState, toolchain, languageStatus, initialProject, onSave, onRestartLanguage, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>('editor');
  const [settings, setSettings] = useState({
    theme: appState.theme,
    editorFontSize: appState.editorFontSize,
    editorTabSize: appState.editorTabSize,
    formatOnSave: appState.formatOnSave,
    languageIntelligenceEnabled: appState.languageIntelligenceEnabled,
  });
  const [project, setProject] = useState(initialProject);
  const setLines = (key: 'sources' | 'includeDirs' | 'defines' | 'extraCompilerArgs' | 'runArgs', value: string) => {
    if (project) setProject({ ...project, [key]: value.split('\n').map((line) => line.trim()).filter(Boolean) });
  };

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-title">
        <div><h2>设置</h2><p>编辑器、C++ 工具链与当前项目</p></div>
        <button onClick={onClose} title="关闭设置" aria-label="关闭设置"><X size={18} /></button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>编辑器</button>
          <button className={tab === 'cpp' ? 'active' : ''} onClick={() => setTab('cpp')}>C++</button>
          <button className={tab === 'project' ? 'active' : ''} onClick={() => setTab('project')}>项目</button>
        </nav>
        <div className="settings-content">
          {tab === 'editor' && <div className="settings-section">
            <h3>编辑体验</h3>
            <div className="settings-grid">
              <label>界面主题<select value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as AppState['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
              <label>编辑器字号<input type="number" min={11} max={24} value={settings.editorFontSize} onChange={(event) => setSettings({ ...settings, editorFontSize: Math.min(24, Math.max(11, Number(event.target.value) || 14)) })} /></label>
              <label>Tab 宽度<select value={settings.editorTabSize} onChange={(event) => setSettings({ ...settings, editorTabSize: Number(event.target.value) })}><option value={2}>2 空格</option><option value={4}>4 空格</option><option value={8}>8 空格</option></select></label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.formatOnSave} onChange={(event) => setSettings({ ...settings, formatOnSave: event.target.checked })} /><span><strong>保存时格式化</strong><small>默认关闭；启用后使用项目的 .clang-format</small></span></label>
            </div>
          </div>}
          {tab === 'cpp' && <div className="settings-section">
            <h3>C++ 智能开发能力</h3>
            <label className="toggle-setting"><input type="checkbox" checked={settings.languageIntelligenceEnabled} onChange={(event) => setSettings({ ...settings, languageIntelligenceEnabled: event.target.checked })} /><span><strong>启用 clangd 智能提示</strong><small>打开 C++ 文件时自动启动，提供补全、跳转、重命名和实时诊断</small></span></label>
            <div className={`language-status-card ${languageStatus.state}`}>
              <div><span className="status-dot" /><strong>{statusText[languageStatus.state]}</strong><small>{languageStatus.message}</small></div>
              <button onClick={onRestartLanguage} disabled={!settings.languageIntelligenceEnabled}><RefreshCw size={14} />重新启动</button>
            </div>
            <div className="tool-paths">
              <label>编译器<input readOnly value={toolchain?.compilerPath ?? '未检测到'} /></label>
              <label>语言服务器<input readOnly value={toolchain?.languageServerPath ?? '未检测到 clangd'} /></label>
              <label>格式化工具<input readOnly value={toolchain?.formatterPath ?? '未检测到 clang-format'} /></label>
            </div>
            <p className="settings-help">默认格式风格：LLVM 派生、4 空格缩进、不使用 Tab、不强制折行。</p>
          </div>}
          {tab === 'project' && <div className="settings-section">
            <h3>当前项目</h3>
            {!project ? <div className="empty-settings">打开项目文件夹后可配置源文件、C++ 标准和运行参数。</div> : <div className="project-settings-grid">
              <label>项目名称<input value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} /></label>
              <label>入口文件<input value={project.entry} onChange={(event) => setProject({ ...project, entry: event.target.value })} /></label>
              <label>C++ 标准<select value={project.standard} onChange={(event) => setProject({ ...project, standard: event.target.value as CppStandard })}>{CPP_STANDARDS.map((standard) => <option key={standard}>{standard}</option>)}</select></label>
              <label>工作目录<input value={project.workingDirectory} onChange={(event) => setProject({ ...project, workingDirectory: event.target.value })} /></label>
              <label className="span-two">源文件（每行一个）<textarea value={project.sources.join('\n')} onChange={(event) => setLines('sources', event.target.value)} /></label>
              <label>包含目录<textarea value={project.includeDirs.join('\n')} onChange={(event) => setLines('includeDirs', event.target.value)} /></label>
              <label>预处理宏<textarea value={project.defines.join('\n')} onChange={(event) => setLines('defines', event.target.value)} /></label>
              <label>额外编译参数<textarea value={project.extraCompilerArgs.join('\n')} onChange={(event) => setLines('extraCompilerArgs', event.target.value)} /></label>
              <label>运行参数<textarea value={project.runArgs.join('\n')} onChange={(event) => setLines('runArgs', event.target.value)} /></label>
            </div>}
          </div>}
        </div>
      </div>
      <div className="modal-footer"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave(settings, project)}>保存设置</button></div>
    </div>
  </div>;
}
