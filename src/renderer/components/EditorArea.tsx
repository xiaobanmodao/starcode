import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';
import { configureCppLanguage } from '../language-client';
import type { EditorDocument } from '../store';

interface Props {
  documents: EditorDocument[];
  activePath?: string;
  fontSize: number;
  tabSize: number;
  theme: 'dark' | 'light';
  breakpoints: Record<string, number[]>;
  onActivate(path: string): void;
  onClose(path: string): void;
  onChange(path: string, content: string): void;
  onSave(): void;
  onToggleBreakpoint(path: string, line: number): void;
  onOpenLocation(path: string, line: number, column: number): Promise<void>;
  reveal?: { path: string; line: number; column: number; token: number };
}

export function EditorArea(props: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | undefined>(undefined);
  const active = props.documents.find((document) => document.path === props.activePath);
  const activeRef = useRef(active);
  const onSaveRef = useRef(props.onSave);
  const onToggleBreakpointRef = useRef(props.onToggleBreakpoint);
  activeRef.current = active;
  onSaveRef.current = props.onSave;
  onToggleBreakpointRef.current = props.onToggleBreakpoint;

  const beforeMount: BeforeMount = (monaco) => {
    configureCppLanguage(monaco, props.onOpenLocation);
    monaco.editor.defineTheme('starcode-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: 'keyword', foreground: 'C792EA' }, { token: 'type', foreground: '82AAFF' }],
      colors: { 'editor.background': '#11151d', 'editorLineNumber.foreground': '#526174', 'editor.lineHighlightBackground': '#18202c' },
    });
    monaco.editor.defineTheme('starcode-light', {
      base: 'vs',
      inherit: true,
      rules: [{ token: 'keyword', foreground: '7C3AED' }, { token: 'type', foreground: '1D4ED8' }],
      colors: { 'editor.background': '#ffffff', 'editorLineNumber.foreground': '#94a3b8', 'editor.lineHighlightBackground': '#f1f5f9' },
    });
  };

  const updateBreakpointDecorations = () => {
    if (!editorRef.current || !active) return;
    decorationsRef.current?.clear();
    decorationsRef.current = editorRef.current.createDecorationsCollection(
      (props.breakpoints[active.path] ?? []).map((line) => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: { isWholeLine: false, glyphMarginClassName: 'breakpoint-glyph', glyphMarginHoverMessage: { value: `第 ${line} 行断点` } },
      })),
    );
  };

  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
    instance.addAction({
      id: 'starcode.formatDocument',
      label: 'StarCode：格式化文档',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1,
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => instance.getAction('editor.action.formatDocument')?.run(),
    });
    instance.addAction({
      id: 'starcode.formatSelection',
      label: 'StarCode：格式化选区',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 2,
      precondition: 'editorHasSelection',
      run: () => instance.getAction('editor.action.formatSelection')?.run(),
    });
    instance.onMouseDown((event) => {
      const current = activeRef.current;
      if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position && current) {
        onToggleBreakpointRef.current(current.path, event.target.position.lineNumber);
      }
    });
    updateBreakpointDecorations();
  };

  useEffect(updateBreakpointDecorations, [active?.path, props.breakpoints]);
  useEffect(() => {
    if (!props.reveal || props.reveal.path !== active?.path) return;
    editorRef.current?.setPosition({ lineNumber: props.reveal.line, column: props.reveal.column });
    editorRef.current?.revealLineInCenter(props.reveal.line);
    editorRef.current?.focus();
  }, [props.reveal, active?.path]);

  if (!active) {
    return <div className="empty-editor">
      <div className="brand-mark">S</div>
      <h2>StarCode</h2>
      <p>打开文件夹或 C++ 源文件，开始一次专注的训练。</p>
      <div className="shortcut-hints"><span>⌘/Ctrl + O 打开</span><span>⌘/Ctrl + S 保存</span><span>F9 编译</span><span>F10 运行</span></div>
    </div>;
  }

  return <div className="editor-shell">
    <div className="tabs" role="tablist">
      {props.documents.map((document) => <button key={document.path} className={`tab ${document.path === active.path ? 'active' : ''}`} onClick={() => props.onActivate(document.path)} title={document.path}>
        <span className="tab-language">C++</span>
        <span>{document.name}{document.dirty ? ' ●' : ''}</span>
        <X size={13} aria-label={`关闭 ${document.name}`} onClick={(event) => { event.stopPropagation(); props.onClose(document.path); }} />
      </button>)}
    </div>
    <Editor
      height="100%"
      path={active.path}
      language="cpp"
      theme={props.theme === 'light' ? 'starcode-light' : 'starcode-dark'}
      value={active.content}
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(value) => props.onChange(active.path, value ?? '')}
      options={{
        fontSize: props.fontSize,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        glyphMargin: true,
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        tabSize: props.tabSize,
        insertSpaces: true,
        renderWhitespace: 'selection',
        smoothScrolling: true,
        padding: { top: 10 },
      }}
    />
  </div>;
}
