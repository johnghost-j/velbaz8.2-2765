/**
 * CodePanel — Lovable-style code editor panel
 * 
 * Shows a file tree on the left and code editor on the right.
 * Read-only during build, editable after. Files update in real-time via polling.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronRight, Folder, File as FileIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  type: string;
  size: number;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: FileTreeNode[];
  fileType?: string;
  size?: number;
}

// ─── File Icons ─────────────────────────────────────────────────────────────

function getFileIcon(name: string): string {
  if (name.endsWith('.tsx') || name.endsWith('.jsx')) return '⚛️';
  if (name.endsWith('.ts') || name.endsWith('.js')) return '📜';
  if (name.endsWith('.css')) return '🎨';
  if (name.endsWith('.json')) return '📋';
  if (name.endsWith('.html')) return '🌐';
  if (name.endsWith('.md')) return '📝';
  return '📄';
}

function getLanguage(name: string): string {
  if (name.endsWith('.tsx')) return 'tsx';
  if (name.endsWith('.ts')) return 'typescript';
  if (name.endsWith('.jsx')) return 'jsx';
  if (name.endsWith('.js')) return 'javascript';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.md')) return 'markdown';
  return 'text';
}

// ─── File Tree Builder ──────────────────────────────────────────────────────

function buildFileTree(files: FileEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', type: 'folder', children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      if (isFile) {
        current.children.push({
          name: part,
          path,
          type: 'file',
          children: [],
          fileType: file.type,
          size: file.size,
        });
      } else {
        let folder = current.children.find(c => c.name === part && c.type === 'folder');
        if (!folder) {
          folder = { name: part, path, type: 'folder', children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  // Sort: folders first, then files alphabetically
  function sortTree(node: FileTreeNode) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);

  return root.children;
}

// ─── File Tree Component ────────────────────────────────────────────────────

function FileTreeItem({
  node,
  selectedPath,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  node: FileTreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = isFolder && node.children.length > 0;

  const children = node.children.map(child => (
    <FileTreeItem
      key={child.path}
      node={child}
      selectedPath={selectedPath}
      onSelect={onSelect}
      expandedFolders={expandedFolders}
      onToggleFolder={onToggleFolder}
    />
  ));

  return (
    <li>
      <span
        className={`flex items-center gap-1.5 py-1 pr-2 rounded-sm cursor-pointer select-none transition-colors ${
          isSelected ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5'
        }`}
        onClick={() => {
          if (isFolder) onToggleFolder(node.path);
          else onSelect(node.path);
        }}
      >
        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFolder(node.path); }}
            className="p-1 -m-1 flex"
          >
            <motion.span
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="flex"
            >
              <ChevronRight className="size-4 text-zinc-500" />
            </motion.span>
          </button>
        )}
        {isFolder ? (
          <Folder
            className={`size-[18px] text-sky-400 fill-sky-400/90 flex-shrink-0 ${
              hasChildren ? '' : 'ml-[22px]'
            }`}
          />
        ) : (
          <FileIcon className="ml-[22px] size-[18px] text-zinc-300 flex-shrink-0" />
        )}
        <span className="truncate text-xs">{node.name}</span>
      </span>
      {hasChildren && (
        <AnimatePresence>
          {isExpanded && (
            <motion.ul
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="pl-6 overflow-hidden flex flex-col justify-end"
            >
              {children}
            </motion.ul>
          )}
        </AnimatePresence>
      )}
    </li>
  );
}

// ─── Main CodePanel Component ───────────────────────────────────────────────

export default function CodePanel({
  companyId,
  isBuilding = false,
  onClose,
}: {
  companyId: string;
  isBuilding?: boolean;
  onClose?: () => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'src/components', 'src/pages', 'src/components/layout']));
  const [saving, setSaving] = useState(false);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Load file list
  const loadFiles = useCallback(async () => {
    try {
      const res: any = await api.companies.projectFiles.list(companyId);
      if (res.files) {
        setFiles(res.files);
        // Auto-select first meaningful file
        if (!selectedFile && res.files.length > 0) {
          const appFile = res.files.find((f: FileEntry) => f.path === 'src/App.tsx');
          const firstPage = res.files.find((f: FileEntry) => f.path.startsWith('src/pages/'));
          setSelectedFile((appFile || firstPage || res.files[0]).path);
        }
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [companyId, selectedFile]);

  // Load file content when selection changes
  const loadFileContent = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const res: any = await api.companies.projectFiles.get(companyId, path);
      if (res.content) {
        setFileContent(res.content);
        setEditedContent(null);
      }
    } catch {
      setFileContent('// Failed to load file');
    }
  }, [companyId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (selectedFile) loadFileContent(selectedFile);
  }, [selectedFile, loadFileContent]);

  // Poll for file changes during build
  useEffect(() => {
    if (!isBuilding) return;
    const interval = setInterval(loadFiles, 3000);
    return () => clearInterval(interval);
  }, [isBuilding, loadFiles]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Save file
  const handleSave = useCallback(async () => {
    if (!selectedFile || !editedContent || isBuilding) return;
    setSaving(true);
    try {
      await api.companies.projectFiles.update(companyId, selectedFile, editedContent);
      setFileContent(editedContent);
      setEditedContent(null);
    } catch (e) {
      console.error('Failed to save:', e);
    }
    setSaving(false);
  }, [companyId, selectedFile, editedContent, isBuilding]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const displayContent = editedContent ?? fileContent;
  const hasChanges = editedContent !== null && editedContent !== fileContent;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950 text-zinc-500 text-sm">
        Loading project files...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950 text-zinc-500 text-sm">
        <div className="text-center">
          <p className="text-lg mb-1">No project files</p>
          <p className="text-xs">Build a project first to see the code</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-200 font-mono text-sm">
      {/* File Tree */}
      <div className="w-52 border-r border-zinc-800 overflow-y-auto flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Files</span>
          {onClose && (
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
          )}
        </div>
        <ul className="py-1 px-1.5">
          {fileTree.map(node => (
            <FileTreeItem
              key={node.path}
              node={node}
              selectedPath={selectedFile}
              onSelect={setSelectedFile}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
            />
          ))}
        </ul>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-zinc-800 bg-zinc-900/50 px-2">
          {selectedFile && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-950 border-b-2 border-primary rounded-t">
              <span>{getFileIcon(selectedFile.split('/').pop() || '')}</span>
              <span>{selectedFile.split('/').pop()}</span>
              {hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
            </div>
          )}
          <div className="flex-1" />
          {hasChanges && !isBuilding && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors"
            >
              {saving ? 'Saving...' : 'Save ⌘S'}
            </button>
          )}
          {isBuilding && (
            <span className="text-[10px] text-yellow-400/70 px-2">● Building...</span>
          )}
        </div>

        {/* Code area */}
        <div className="flex-1 overflow-auto relative">
          {selectedFile ? (
            <textarea
              ref={editorRef}
              value={displayContent}
              onChange={(e) => !isBuilding && setEditedContent(e.target.value)}
              readOnly={isBuilding}
              className="w-full h-full bg-transparent text-zinc-200 p-4 resize-none outline-none leading-6 text-[13px] tab-size-2"
              style={{ tabSize: 2, fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace' }}
              spellCheck={false}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
              Select a file to view
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-0.5 border-t border-zinc-800 bg-zinc-900/50 text-[10px] text-zinc-500">
          <span>{selectedFile ? getLanguage(selectedFile) : ''}</span>
          <span>{displayContent.split('\n').length} lines, {displayContent.length} chars</span>
        </div>
      </div>
    </div>
  );
}
