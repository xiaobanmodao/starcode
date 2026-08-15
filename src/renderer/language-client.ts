import type { Monaco } from '@monaco-editor/react';
import type {
  IPosition,
  IRange,
  Position as MonacoPosition,
  Range as MonacoRange,
  Uri,
  editor as MonacoEditor,
  languages as MonacoLanguages,
} from 'monaco-editor';
import type { Diagnostic } from '../shared/contracts';
import { useWorkspaceStore } from './store';

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspLocation = { uri: string; range: LspRange };
type LspTextEdit = { range?: LspRange; insert?: LspRange; replace?: LspRange; newText: string };

let monacoInstance: Monaco | undefined;
let registered = false;
let openLocation: ((path: string, line: number, column: number) => Promise<void>) | undefined;
const pendingDiagnostics = new Map<string, Diagnostic[]>();
const attachedModels = new Set<string>();

function fileUri(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${absolute}`).replaceAll('#', '%23').replaceAll('?', '%3F');
}

function request(method: Parameters<typeof window.starcode.language.request>[0]['method'], params: Record<string, unknown>): Promise<unknown> {
  return window.starcode.language.request({ method, params }).catch(() => null);
}

function position(position: { lineNumber: number; column: number }): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function range(monaco: Monaco, value: LspRange) {
  return new monaco.Range(value.start.line + 1, value.start.character + 1, value.end.line + 1, value.end.character + 1);
}

function wholeModelRange(monaco: Monaco, model: MonacoEditor.ITextModel) {
  const lastLine = model.getLineCount();
  return new monaco.Range(1, 1, lastLine, model.getLineMaxColumn(lastLine));
}

function markdown(value: unknown): { value: string }[] {
  if (typeof value === 'string') return [{ value }];
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') return [{ value: value.value }];
  if (Array.isArray(value)) return value.flatMap(markdown);
  return [];
}

async function ensureModel(monaco: Monaco, uriText: string): Promise<ReturnType<Monaco['editor']['createModel']> | null> {
  const uri = monaco.Uri.parse(uriText);
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  try {
    const document = await window.starcode.files.read(uri.fsPath);
    useWorkspaceStore.getState().openDocument(document, false);
    const model = monaco.editor.createModel(document.content, 'cpp', uri);
    if (!attachedModels.has(document.path)) {
      attachedModels.add(document.path);
      model.onDidChangeContent(() => useWorkspaceStore.getState().updateContent(document.path, model.getValue()));
    }
    applyMarkers(document.path, pendingDiagnostics.get(document.path) ?? []);
    return model;
  } catch {
    return null;
  }
}

async function locations(monaco: Monaco, raw: unknown): Promise<Array<{ uri: ReturnType<Monaco['Uri']['parse']>; range: ReturnType<typeof range> }>> {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const result: Array<{ uri: ReturnType<Monaco['Uri']['parse']>; range: ReturnType<typeof range> }> = [];
  for (const value of values as LspLocation[]) {
    if (!value?.uri || !value.range) continue;
    await ensureModel(monaco, value.uri);
    result.push({ uri: monaco.Uri.parse(value.uri), range: range(monaco, value.range) });
  }
  return result;
}

function symbolKind(monaco: Monaco, kind: unknown) {
  const numeric = typeof kind === 'number' ? Math.max(0, kind - 1) : monaco.languages.SymbolKind.Variable;
  return numeric as (typeof monaco.languages.SymbolKind)[keyof typeof monaco.languages.SymbolKind];
}

function documentSymbol(monaco: Monaco, raw: Record<string, unknown>): import('monaco-editor').languages.DocumentSymbol {
  const symbolRange = raw.range as LspRange;
  const selectionRange = (raw.selectionRange as LspRange | undefined) ?? symbolRange;
  return {
    name: String(raw.name ?? '—'),
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    kind: symbolKind(monaco, raw.kind),
    tags: [],
    range: range(monaco, symbolRange),
    selectionRange: range(monaco, selectionRange),
    children: Array.isArray(raw.children) ? raw.children.map((child) => documentSymbol(monaco, child as Record<string, unknown>)) : [],
  };
}

export function configureCppLanguage(monaco: Monaco, navigate: (path: string, line: number, column: number) => Promise<void>): void {
  monacoInstance = monaco;
  openLocation = navigate;
  if (registered) return;
  registered = true;

  monaco.editor.onDidCreateModel((model: MonacoEditor.ITextModel) => applyMarkers(model.uri.fsPath, pendingDiagnostics.get(model.uri.fsPath) ?? []));
  monaco.editor.registerEditorOpener({
    openCodeEditor: async (_source: MonacoEditor.ICodeEditor, resource: Uri, target?: IRange | IPosition) => {
      if (!openLocation) return false;
      const line = target && 'lineNumber' in target ? target.lineNumber : target && 'startLineNumber' in target ? target.startLineNumber : 1;
      const column = target && 'column' in target ? target.column : target && 'startColumn' in target ? target.startColumn : 1;
      await openLocation(resource.fsPath, line, column);
      return true;
    },
  });

  monaco.languages.registerCompletionItemProvider('cpp', {
    triggerCharacters: ['.', '>', ':', '#', '<', '"', '/'],
    provideCompletionItems: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition, context: MonacoLanguages.CompletionContext) => {
      const raw = await request('textDocument/completion', {
        textDocument: { uri: model.uri.toString() },
        position: position(cursor),
        context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter },
      }) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null;
      const items = Array.isArray(raw) ? raw : raw?.items ?? [];
      const word = model.getWordUntilPosition(cursor);
      return { suggestions: items.map((item) => {
        const edit = item.textEdit as LspTextEdit | undefined;
        const editRange = edit?.range ?? edit?.replace;
        const documentation = markdown(item.documentation)[0];
        return {
          label: typeof item.label === 'string' ? item.label : String((item.label as { label?: string })?.label ?? ''),
          kind: Math.max(0, Number(item.kind ?? 1) - 1),
          detail: typeof item.detail === 'string' ? item.detail : undefined,
          documentation,
          insertText: edit?.newText ?? String(item.insertText ?? item.label ?? ''),
          insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range: editRange ? range(monaco, editRange) : new monaco.Range(cursor.lineNumber, word.startColumn, cursor.lineNumber, word.endColumn),
          sortText: typeof item.sortText === 'string' ? item.sortText : undefined,
          filterText: typeof item.filterText === 'string' ? item.filterText : undefined,
        };
      }) };
    },
  });

  monaco.languages.registerSignatureHelpProvider('cpp', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition) => {
      const raw = await request('textDocument/signatureHelp', { textDocument: { uri: model.uri.toString() }, position: position(cursor) }) as Record<string, unknown> | null;
      if (!raw) return null;
      const signatures = (Array.isArray(raw.signatures) ? raw.signatures : []).map((signature: Record<string, unknown>) => ({
        label: String(signature.label ?? ''),
        documentation: markdown(signature.documentation)[0],
        parameters: (Array.isArray(signature.parameters) ? signature.parameters : []).map((parameter: Record<string, unknown>) => ({
          label: parameter.label as string | [number, number],
          documentation: markdown(parameter.documentation)[0],
        })),
      }));
      return { value: { signatures, activeSignature: Number(raw.activeSignature ?? 0), activeParameter: Number(raw.activeParameter ?? 0) }, dispose: () => undefined };
    },
  });

  monaco.languages.registerHoverProvider('cpp', {
    provideHover: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition) => {
      const raw = await request('textDocument/hover', { textDocument: { uri: model.uri.toString() }, position: position(cursor) }) as Record<string, unknown> | null;
      if (!raw) return null;
      return { contents: markdown(raw.contents), range: raw.range ? range(monaco, raw.range as LspRange) : undefined };
    },
  });

  monaco.languages.registerDefinitionProvider('cpp', {
    provideDefinition: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition) => locations(monaco, await request('textDocument/definition', { textDocument: { uri: model.uri.toString() }, position: position(cursor) })),
  });

  monaco.languages.registerReferenceProvider('cpp', {
    provideReferences: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition) => locations(monaco, await request('textDocument/references', {
      textDocument: { uri: model.uri.toString() }, position: position(cursor), context: { includeDeclaration: true },
    })),
  });

  monaco.languages.registerRenameProvider('cpp', {
    provideRenameEdits: async (model: MonacoEditor.ITextModel, cursor: MonacoPosition, newName: string) => {
      const raw = await request('textDocument/rename', { textDocument: { uri: model.uri.toString() }, position: position(cursor), newName }) as Record<string, unknown> | null;
      if (!raw) return { edits: [] };
      const edits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];
      const changes = raw.changes && typeof raw.changes === 'object' ? raw.changes as Record<string, LspTextEdit[]> : {};
      for (const [uriText, textEdits] of Object.entries(changes)) {
        await ensureModel(monaco, uriText);
        const modelForEdit = monaco.editor.getModel(monaco.Uri.parse(uriText));
        for (const edit of textEdits) if (edit.range) edits.push({ resource: monaco.Uri.parse(uriText), textEdit: { range: range(monaco, edit.range), text: edit.newText }, versionId: modelForEdit?.getVersionId() });
      }
      const documentChanges = Array.isArray(raw.documentChanges) ? raw.documentChanges : [];
      for (const change of documentChanges as Array<{ textDocument?: { uri?: string }; edits?: LspTextEdit[] }>) {
        const uriText = change.textDocument?.uri;
        if (!uriText) continue;
        await ensureModel(monaco, uriText);
        const modelForEdit = monaco.editor.getModel(monaco.Uri.parse(uriText));
        for (const edit of change.edits ?? []) if (edit.range) edits.push({ resource: monaco.Uri.parse(uriText), textEdit: { range: range(monaco, edit.range), text: edit.newText }, versionId: modelForEdit?.getVersionId() });
      }
      return { edits };
    },
  });

  monaco.languages.registerDocumentSymbolProvider('cpp', {
    provideDocumentSymbols: async (model: MonacoEditor.ITextModel) => {
      const raw = await request('textDocument/documentSymbol', { textDocument: { uri: model.uri.toString() } });
      return (Array.isArray(raw) ? raw : []).filter((item) => item && typeof item === 'object' && 'range' in item).map((item) => documentSymbol(monaco, item as Record<string, unknown>));
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider('cpp', {
    provideDocumentFormattingEdits: async (model: MonacoEditor.ITextModel) => {
      const text = await window.starcode.language.format({ path: model.uri.fsPath, text: model.getValue() });
      return [{ range: wholeModelRange(monaco, model), text }];
    },
  });

  monaco.languages.registerDocumentRangeFormattingEditProvider('cpp', {
    provideDocumentRangeFormattingEdits: async (model: MonacoEditor.ITextModel, selection: MonacoRange) => {
      const text = await window.starcode.language.format({
        path: model.uri.fsPath,
        text: model.getValue(),
        range: { startLine: selection.startLineNumber, endLine: selection.endLineNumber },
      });
      return [{ range: wholeModelRange(monaco, model), text }];
    },
  });
}

export function updateLanguageMarkers(filePath: string, diagnostics: Diagnostic[]): void {
  pendingDiagnostics.set(filePath, diagnostics);
  applyMarkers(filePath, diagnostics);
}

function applyMarkers(filePath: string, diagnostics: Diagnostic[]): void {
  const monaco = monacoInstance;
  if (!monaco) return;
  const model = monaco.editor.getModel(monaco.Uri.parse(fileUri(filePath)));
  if (!model) return;
  monaco.editor.setModelMarkers(model, 'clangd', diagnostics.map((item) => ({
    startLineNumber: item.line,
    startColumn: item.column,
    endLineNumber: item.line,
    endColumn: Math.min(model.getLineMaxColumn(item.line), item.column + 1),
    message: item.message,
    code: item.code,
    source: 'clangd',
    severity: item.severity === 'error' ? monaco.MarkerSeverity.Error : item.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
  })));
}
