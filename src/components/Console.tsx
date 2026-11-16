import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Play,
  SkipForward,
  Square,
  Terminal,
} from 'lucide-react';
import {
  formatDiagnosticWithCaret,
  type CompilerDiagnostic,
  type DebugSnapshot,
  type ExecutionResult,
} from '../compiler/index.ts';
import type { TestCaseResult } from '../../tests/lexer.test.ts';

type ConsoleTab = 'output' | 'terminal' | 'diagnostics' | 'tests';

interface PendingPrompt {
  prompt: string;
}

export interface TerminalEntry {
  id: number;
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

interface ConsoleProps {
  source: string;
  execution?: ExecutionResult;
  liveLogs: string[];
  isRunning: boolean;
  pendingPrompt: PendingPrompt | null;
  debugSnapshot: DebugSnapshot | null;
  onDebugStep: () => void;
  onDebugContinue: () => void;
  onDebugStop: () => void;
  onSubmitInput: (value: string) => void;
  onStopExecution: () => void;
  diagnostics: CompilerDiagnostic[];
  testResults: TestCaseResult[];
  onSelectLine: (line: number) => void;
  onRunTests: () => void;
  isHidden: boolean;
  onToggleHidden: () => void;
  terminalEntries: TerminalEntry[];
  onRunTerminalCommand: (cmd: string) => void;
}

export function Console({
  source,
  execution,
  liveLogs,
  isRunning,
  pendingPrompt,
  debugSnapshot,
  onDebugStep,
  onDebugContinue,
  onDebugStop,
  onSubmitInput,
  onStopExecution,
  diagnostics,
  testResults,
  onSelectLine,
  onRunTests,
  isHidden,
  onToggleHidden,
  terminalEntries,
  onRunTerminalCommand,
}: ConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('output');
  const [inputDraft, setInputDraft] = useState('');
  const [terminalInput, setTerminalInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const terminalBottomRef = useRef<HTMLDivElement | null>(null);

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const passedTests = testResults.filter((t) => t.passed).length;

  const isPausedDebugger = debugSnapshot?.status === 'paused';
  const displayedLogs = isPausedDebugger
    ? debugSnapshot.logs
    : isRunning
      ? liveLogs
      : (execution?.logs ?? liveLogs);

  useEffect(() => {
    if (pendingPrompt) {
      if (isHidden) onToggleHidden();
      setActiveTab('output');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pendingPrompt, isHidden, onToggleHidden]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [displayedLogs.length, pendingPrompt]);

  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalBottomRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [terminalEntries.length, activeTab]);

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPrompt) return;
    const val = inputDraft;
    setInputDraft('');
    onSubmitInput(val);
  };

  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = terminalInput.trim();
    if (!cmd) return;
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setTerminalInput('');
    onRunTerminalCommand(cmd);
  };

  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      const nextIdx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setTerminalInput(cmdHistory[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      if (cmdHistory.length === 0 || historyIdx === -1) return;
      e.preventDefault();
      const nextIdx = historyIdx + 1;
      if (nextIdx >= cmdHistory.length) {
        setHistoryIdx(-1);
        setTerminalInput('');
      } else {
        setHistoryIdx(nextIdx);
        setTerminalInput(cmdHistory[nextIdx] ?? '');
      }
    }
  };

  if (isHidden) {
    return (
      <section
        aria-label="Collapsed Execution Console"
        className="flex items-center justify-between gap-4 px-4 h-10 shrink-0 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-xs"
      >
        <div className="flex items-center gap-3 font-mono text-slate-600 dark:text-slate-400 tabular-nums">
          <span className="font-sans font-medium text-slate-800 dark:text-slate-200">
            Console &amp; Terminal Hidden
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {isRunning
              ? 'Running...'
              : errorCount === 0 && !execution?.error
                ? '0 errors'
                : `${errorCount || 1} error(s)`}
          </span>
          {displayedLogs.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{displayedLogs.length} log line(s)</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('terminal');
              onToggleHidden();
              requestAnimationFrame(() => terminalInputRef.current?.focus());
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap"
          >
            <Terminal className="w-3 h-3" />
            Terminal
          </button>
          <button
            type="button"
            onClick={onToggleHidden}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Show Console
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Execution Console, Terminal, and Diagnostics"
      className="flex flex-col h-56 shrink-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
          <button
            type="button"
            onClick={() => setActiveTab('output')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'output'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Console Output
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('terminal');
              requestAnimationFrame(() => terminalInputRef.current?.focus());
            }}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'terminal'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Terminal
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('diagnostics')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Diagnostics ({diagnostics.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tests')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'tests'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Tests ({passedTests}/{testResults.length})
          </button>
        </div>

        {/* Step Debugger Controls, Execution Timer & Hide Console Button */}
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          {isPausedDebugger && (
            <div className="flex items-center gap-1.5 mr-2 font-sans">
              <span className="text-amber-600 dark:text-amber-400 font-medium font-mono tabular-nums mr-1">
                Paused at line {debugSnapshot.currentLine ?? 1}
              </span>
              <button
                type="button"
                onClick={onDebugStep}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <SkipForward className="w-3 h-3" />
                Step
              </button>
              <button
                type="button"
                onClick={onDebugContinue}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer"
              >
                <Play className="w-3 h-3" />
                Continue
              </button>
              <button
                type="button"
                onClick={onDebugStop}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            </div>
          )}

          {isRunning && !isPausedDebugger && (
            <button
              type="button"
              onClick={onStopExecution}
              className="px-2.5 py-0.5 font-sans font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
            >
              Stop
            </button>
          )}
          {execution && !isRunning && (
            <>
              <span>Exec {execution.durationMs} ms</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{errorCount === 0 ? '0 errors' : `${errorCount} error(s)`}</span>
          <button
            type="button"
            onClick={onToggleHidden}
            className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 font-sans text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Hide Console
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs">
        {activeTab === 'output' && (
          <div className="space-y-1.5">
            {displayedLogs.length === 0 && !pendingPrompt && !isRunning && errorCount === 0 && !execution?.error && (
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>Click Run Code (or switch to Terminal for commands) to execute EasyJS tasks.</span>
              </div>
            )}

            {displayedLogs.map((line, i) => (
              <div
                key={i}
                className="py-0.5 text-slate-900 dark:text-slate-100 whitespace-pre-wrap"
              >
                {line}
              </div>
            ))}

            {pendingPrompt && (
              <form
                onSubmit={handleInputSubmit}
                className="mt-2 flex items-center gap-2 p-2 rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
              >
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold whitespace-pre">
                  {pendingPrompt.prompt || 'Input:'}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputDraft}
                  onChange={(e) => setInputDraft(e.target.value)}
                  placeholder="Type input and press Enter..."
                  className="flex-1 min-w-0 px-2 py-1 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-emerald-600"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-2.5 py-1 font-sans text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer shrink-0"
                >
                  <CornerDownLeft className="w-3 h-3" />
                  Submit
                </button>
              </form>
            )}

            {execution?.error && !isRunning && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Runtime Error: </span>
                  <span>{execution.error}</span>
                </div>
              </div>
            )}

            {errorCount > 0 && !isRunning && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Execution halted due to {errorCount} compile error(s):</span>
                </div>
                {diagnostics
                  .filter((d) => d.severity === 'error')
                  .map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onSelectLine(d.line)}
                      className="w-full text-left p-2.5 rounded border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 text-red-800 dark:text-red-200 hover:bg-red-100/70 dark:hover:bg-red-950/40 cursor-pointer"
                    >
                      <pre className="whitespace-pre font-mono text-xs leading-5 overflow-x-auto">
                        {formatDiagnosticWithCaret(d, source)}
                      </pre>
                    </button>
                  ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="flex flex-col h-full min-h-0 justify-between gap-2">
            <div className="flex-1 overflow-y-auto space-y-1">
              {terminalEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`whitespace-pre-wrap leading-5 ${
                    entry.kind === 'cmd'
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : entry.kind === 'err'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {entry.text}
                </div>
              ))}
              <div ref={terminalBottomRef} />
            </div>

            <form
              onSubmit={handleTerminalSubmit}
              className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 shrink-0"
            >
              <span className="text-emerald-600 dark:text-emerald-400 font-bold select-none">
                $
              </span>
              <input
                ref={terminalInputRef}
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalKeyDown}
                placeholder="Type task command (help, run, save app.ejs, open app.ejs, ls, dom, click <id>, vars, ptrs, code, clear) or EasyJS snippet..."
                className="flex-1 min-w-0 bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1 font-sans text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer shrink-0"
              >
                Run
              </button>
            </form>
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div className="space-y-2">
            {diagnostics.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>No lexer, parser, type, or ownership diagnostics reported.</span>
              </div>
            ) : (
              diagnostics.map((d, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectLine(d.line)}
                  className="w-full text-left flex items-start gap-2.5 p-2.5 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  {d.severity === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 mb-1">
                      <span className="font-semibold capitalize">{d.title ?? d.phase}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500 tabular-nums">
                        Line {d.line}:{d.column}
                      </span>
                    </div>
                    <pre className="whitespace-pre font-mono text-xs leading-5 text-slate-700 dark:text-slate-300 overflow-x-auto">
                      {formatDiagnosticWithCaret(d, source)}
                    </pre>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 dark:text-slate-400">
                Compiler unit suites ({passedTests} of {testResults.length} passing)
              </span>
              <button
                type="button"
                onClick={onRunTests}
                className="px-2.5 py-1 text-xs font-sans font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                Re-run Suites
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
              {testResults.map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">
                      {t.suite}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="text-slate-900 dark:text-slate-100 truncate">
                      {t.name}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 font-medium ${
                      t.passed
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {t.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
