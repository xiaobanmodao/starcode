import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { FileTreeNode } from '../../shared/contracts';

interface Props {
  nodes: FileTreeNode[];
  activePath?: string;
  onOpen(path: string): void;
}

function TreeItem({ node, depth, activePath, onOpen }: { node: FileTreeNode; depth: number; activePath?: string; onOpen(path: string): void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  if (node.kind === 'directory') {
    return <>
      <button className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setExpanded(!expanded)} title={node.path}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {expanded ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
        <span>{node.name}</span>
      </button>
      {expanded && node.children?.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />)}
    </>;
  }
  const isCode = /\.(cpp|cc|cxx|h|hpp)$/i.test(node.name);
  return <button className={`tree-row ${activePath === node.path ? 'active' : ''}`} style={{ paddingLeft: 29 + depth * 14 }} onClick={() => onOpen(node.path)} title={node.path}>
    {isCode ? <FileCode2 size={15} className="code-icon" /> : <FileText size={15} />}
    <span>{node.name}</span>
  </button>;
}

export function FileTree({ nodes, activePath, onOpen }: Props) {
  return <div className="file-tree">{nodes.map((node) => <TreeItem key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} />)}</div>;
}
