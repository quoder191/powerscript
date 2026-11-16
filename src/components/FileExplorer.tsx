import React, { useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Download,
  FileCode2,
  FilePlus,
  FolderOpen,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { SavedWorkspaceFile } from '../utils/fileStorage.ts';

interface FileExplorerProps {
  files: SavedWorkspaceFile[];
  activeFileId: string | null;
  hasUnsavedChanges: boolean;
  showCode: boolean;
  onOpenFile: (id: string) => void;
  onSaveCurrent: () => void;
  onSaveAs: (name: string) => void;
  onCreateNew: (name: string) => void;
  onRenameFile: (id: string, nextName: string) => void;
  onDeleteFile: (id: string) => void;
  onToggleCode: () => void;
  onClose: () => void;
}

export function FileExplorer({
  files,
  activeFileId,
  hasUnsavedChanges,
  showCode,
  onOpenFile,
  onSaveCurrent,
  onSaveAs,
  onCreateNew,
  onRenameFile,
  onDeleteFile,
  onToggleCode,
  onClose,
}: FileExplorerProps) {
  const [query, setQuery] = useState('');
  const [creatingMode, setCreatingMode] = useState<'new' | 'save-as' | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...files].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, query]);

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    if (creatingMode === 'save-as') {
      onSaveAs(trimmed);
    } else if (creatingMode === 'new') {
      onCreateNew(trimmed);
    }
    setCreatingMode(null);
    setNameDraft('');
  };

  const handleSubmitRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameFile(id, trimmed);
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleDownloadFile = (file: SavedWorkspaceFile) => {
    try {
      const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Ignore restricted frame download errors
    }
  };

  return (
    <aside
      aria-label="Saved Files Explorer"
      className="w-72 shrink-0 flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            File Explorer
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close File Explorer"
          className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Save / New / Save As Actions */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (activeFileId) {
                onSaveCurrent();
              } else {
                setCreatingMode('save-as');
                setNameDraft('my-app.ejs');
              }
            }}
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer whitespace-nowrap"
          >
            <Save className="w-3 h-3 shrink-0" />
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingMode('save-as');
              setNameDraft('copy.ejs');
            }}
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap"
          >
            Save As
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingMode('new');
              setNameDraft('new-app.ejs');
            }}
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap"
          >
            <FilePlus className="w-3 h-3 shrink-0" />
            New
          </button>
        </div>

        {creatingMode && (
          <form onSubmit={handleSubmitCreate} className="flex items-center gap-1.5">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={creatingMode === 'save-as' ? 'Filename (e.g. app.ejs)' : 'New file name'}
              autoFocus
              className="flex-1 min-w-0 px-2.5 py-1 text-xs font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-emerald-500 rounded focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Confirm filename"
              className="p-1.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingMode(null);
                setNameDraft('');
              }}
              aria-label="Cancel filename"
              className="p-1.5 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter saved files..."
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded focus:outline-none focus:border-emerald-600"
          />
        </div>
      </div>

      {/* Saved Files List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between tabular-nums">
          <span>Local Storage ({files.length})</span>
          {activeFileId && hasUnsavedChanges && (
            <span className="text-amber-600 dark:text-amber-400">Unsaved edits</span>
          )}
        </div>

        {filteredFiles.length === 0 ? (
          <div className="px-2.5 py-6 text-xs text-slate-500 dark:text-slate-400 text-center space-y-2">
            <p>
              {files.length === 0
                ? 'No files saved in local storage yet.'
                : 'No saved files matched your filter.'}
            </p>
            {files.length === 0 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Click Save above to store the active project in your browser.
              </p>
            )}
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isActive = file.id === activeFileId;
            const isRenaming = renamingId === file.id;
            const isConfirmDelete = confirmDeleteId === file.id;

            return (
              <div
                key={file.id}
                className={`group rounded-md border transition-colors ${
                  isActive
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
                    : 'bg-white dark:bg-slate-950/50 border-slate-200/80 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {isRenaming ? (
                  <form
                    onSubmit={(e) => handleSubmitRename(e, file.id)}
                    className="flex items-center gap-1 p-1.5"
                  >
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-xs font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-emerald-500 rounded focus:outline-none"
                    />
                    <button
                      type="submit"
                      aria-label="Save name"
                      className="p-1 text-white bg-emerald-600 rounded cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      aria-label="Cancel rename"
                      className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-1.5 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <FileCode2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isActive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                          {file.name}
                          {isActive && hasUnsavedChanges ? ' *' : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {new Date(file.updatedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {' · '}
                          {file.content.split('\n').length} lines
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(file.id);
                          setRenameDraft(file.name);
                          setConfirmDeleteId(null);
                        }}
                        title="Rename file"
                        aria-label={`Rename ${file.name}`}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadFile(file)}
                        title="Download file"
                        aria-label={`Download ${file.name}`}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      {isConfirmDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteFile(file.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-1.5 py-0.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(file.id)}
                          title="Delete file"
                          aria-label={`Delete ${file.name}`}
                          className="p-1 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Code Toggle */}
      <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Saved in localStorage
        </span>
        <button
          type="button"
          onClick={onToggleCode}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap"
        >
          <Code2 className="w-3 h-3" />
          {showCode ? 'Hide Code' : 'Edit Code'}
        </button>
      </div>
    </aside>
  );
}
