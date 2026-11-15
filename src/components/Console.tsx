import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, CornerDownLeft, Terminal } from 'lucide-react';
import type { CompilerDiagnostic, ExecutionResult } from '../compiler/index.ts';
import type { TestCaseResult } from '../../tests/lexer.test.ts';

type ConsoleTab = 'output' | 'diagnostics' | 'tests';

interface PendingPrompt {
  prompt: string;
}

interface ConsoleProps {
  execution?: ExecutionResult;
  liveLogs: string[];
  isRunning: boolean;
  pendingPrompt: PendingPrompt | null;
  onSubmitInput: (value: string) => void;
  onStopExecution: () => void;
  diagnostics: CompilerDiagnostic[];
  testResults: TestCaseResult[];
  onSelectLine: (line: number) => void;
  onRunTests: () => void;
}

export function Console({
  execution,
  liveLogs,
  isRunning,
  pendingPrompt,
  onSubmitInput,
  onStopExecution,
  diagnostics,
  testResults,
  onSelectLine,
  onRunTests,
}: ConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('output');
  const [inputDraft, setInputDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const passedTests = testResults.filter((t) => t.passed).length;

  const displayedLogs = isRunning ? liveLogs : (execution?.logs ?? liveLogs);

  useEffect(() => {
    if (pendingPrompt) {
      setActiveTab('output');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pendingPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [displayedLogs.length, pendingPrompt]);

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPrompt) return;
    const val = inputDraft;
    setInputDraft('');
    onSubmitInput(val);
  };

  return (
    <section
      aria-label="Execution Console and Diagnostics"
      className="flex flex-col h-60 shrink-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
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

        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          {isRunning && (
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
          <span>
            {errorCount === 0 ? '0 errors' : `${errorCount} error(s)`}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs">
        {activeTab === 'output' && (
          <div className="space-y-1.5">
            {displayedLogs.length === 0 && !pendingPrompt && !isRunning && errorCount === 0 && !execution?.error && (
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>Click Run Code (or press Ctrl/Cmd + Enter) to execute EasyJS output.</span>
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
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Execution halted due to {errorCount} compile error(s):</span>
                </div>
                {diagnostics.map((d, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectLine(d.line)}
                    className="w-full text-left flex items-start gap-2 p-2 rounded border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 text-red-800 dark:text-red-200 hover:bg-red-100/70 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <span className="font-semibold shrink-0 tabular-nums">
                      [{d.phase} {d.line}:{d.column}]
                    </span>
                    <span className="min-w-0">
                      {d.message}
                      {d.hint ? ` — Hint: ${d.hint}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div className="space-y-2">
            {diagnostics.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>No lexer, parser, or ownership diagnostics reported.</span>
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
                    <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                      <span className="font-semibold capitalize">{d.phase}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500 tabular-nums">
                        Line {d.line}:{d.column}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-700 dark:text-slate-300">{d.message}</p>
                    {d.hint && (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Hint: {d.hint}
                      </p>
                    )}
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
                className="px-2.5 py-1 text-xs font-sans font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
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
