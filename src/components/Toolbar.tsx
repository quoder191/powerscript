import { Play, RotateCcw, Sun, Moon, FlaskConical } from 'lucide-react';

export type WorkspaceTab = 'workspace' | 'guide' | 'tests';

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
  onRun: () => void;
  onReset: () => void;
  onRunTests: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Toolbar({
  activeView,
  onSelectView,
  presets,
  selectedPresetId,
  onSelectPreset,
  onRun,
  onReset,
  onRunTests,
  darkMode,
  onToggleDarkMode,
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
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-2.5 bg-slate-50 dark:bg-slate-900/60">
          <div className="flex items-center gap-3 min-w-0">
            <label
              htmlFor="preset-select"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0"
            >
              Example
            </label>
            <select
              id="preset-select"
              value={selectedPresetId}
              onChange={(e) => onSelectPreset(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-md focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRunTests}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
              Verify Tests
            </button>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex items-center justify-center w-8 h-8 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
