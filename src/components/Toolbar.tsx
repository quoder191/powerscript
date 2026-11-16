import {
  Play,
  RotateCcw,
  Sun,
  Moon,
  FlaskConical,
  Wand2,
  Bug,
  FolderOpen,
  Save,
  Code2,
} from 'lucide-react';

export type WorkspaceTab = 'workspace' | 'guide' | 'tests';
export type ExecutionEngine = 'interpreter' | 'compiled';

export interface ExamplePreset {
  id: string;
  label: string;
  summary: string;
  code: string;
}

interface ToolbarProps {
  activeView: WorkspaceTab;
  onSelectView: (view: WorkspaceTab) => void;
  presets: ExamplePreset[];
  selectedPresetId: string;
  onSelectPreset: (id: string) => void;
  engine: ExecutionEngine;
  onSelectEngine: (engine: ExecutionEngine) => void;
  onRun: () => void;
  onDebug: () => void;
  onFormat: () => void;
  onReset: () => void;
  onRunTests: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  showCode: boolean;
  onToggleCode: () => void;
  showFiles: boolean;
  onToggleFiles: () => void;
  onSaveFile: () => void;
  activeFileName: string | null;
  hasUnsavedChanges: boolean;
  savedFilesCount: number;
}

export function Toolbar({
  activeView,
  onSelectView,
  presets,
  selectedPresetId,
  onSelectPreset,
  engine,
  onSelectEngine,
  onRun,
  onDebug,
  onFormat,
  onReset,
  onRunTests,
  darkMode,
  onToggleDarkMode,
  showCode,
  onToggleCode,
  showFiles,
  onToggleFiles,
  onSaveFile,
  activeFileName,
  hasUnsavedChanges,
  savedFilesCount,
}: ToolbarProps) {
  return (
    <div className="shrink-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 h-14 border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Single text element wordmark */}
        <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
          EasyJS
        </span>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => onSelectView('workspace')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'workspace'
                ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Workspace
          </button>
          <button
            type="button"
            onClick={() => onSelectView('guide')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'guide'
                ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Syntax Guide
          </button>
          <button
            type="button"
            onClick={() => onSelectView('tests')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'tests'
                ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Test Suite
          </button>
        </nav>

        {/* Zone 3: Single primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onRun}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            Run Code
          </button>
        </div>
      </header>

      {/* Workspace sub-toolbar */}
      {activeView === 'workspace' && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-slate-50 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <label
              htmlFor="preset-select"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0"
            >
              Example
            </label>
            <select
              id="preset-select"
              value={activeFileName ? '' : selectedPresetId}
              onChange={(e) => {
                if (e.target.value) onSelectPreset(e.target.value);
              }}
              className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-md focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              {activeFileName && (
                <option value="">Saved: {activeFileName}</option>
              )}
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>

            <label
              htmlFor="engine-select"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0 ml-1"
            >
              Runtime
            </label>
            <select
              id="engine-select"
              value={engine}
              onChange={(e) => onSelectEngine(e.target.value as ExecutionEngine)}
              className="px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-md focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <option value="interpreter">AST Interpreter (Zero-eval)</option>
              <option value="compiled">Compiled JS</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleFiles}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showFiles
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              Files ({savedFilesCount})
            </button>
            <button
              type="button"
              onClick={onSaveFile}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                hasUnsavedChanges
                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                  : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              {hasUnsavedChanges ? 'Save *' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onToggleCode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showCode
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                  : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
              {showCode ? 'Hide Code' : 'Show Code'}
            </button>

            {showCode && (
              <button
                type="button"
                onClick={onFormat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                Format
              </button>
            )}
            <button
              type="button"
              onClick={onDebug}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Bug className="w-3.5 h-3.5" aria-hidden="true" />
              Debug
            </button>
            <button
              type="button"
              onClick={onRunTests}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
              Verify Tests
            </button>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex items-center justify-center w-8 h-8 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
