import React, { useMemo, useRef, useState } from 'react';
import type { CompilerDiagnostic } from '../compiler/index.ts';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  diagnostics: CompilerDiagnostic[];
  focusedLine?: number | null;
}

export function Editor({
  value,
  onChange,
  onRun,
  diagnostics,
  focusedLine,
}: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  });

  const lines = useMemo(() => value.split('\n'), [value]);
  const errorLines = useMemo(() => {
    const map = new Map<number, CompilerDiagnostic>();
    for (const d of diagnostics) {
      if (!map.has(d.line)) map.set(d.line, d);
    }
    return map;
  }, [diagnostics]);

  const updateCursor = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const before = value.slice(0, pos);
    const split = before.split('\n');
    setCursorPos({
      line: split.length,
      col: split[split.length - 1].length + 1,
    });
  };

  const handleScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = start + 2;
        el.selectionEnd = start + 2;
        updateCursor();
      });
    }
  };

  return (
    <section
      aria-label="EasyJS Source Editor"
      className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
        <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          Source Code
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span aria-hidden="true">·</span>
          <span>{lines.length} lines</span>
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Line number gutter */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-12 py-3 px-2 overflow-hidden select-none text-right font-mono text-xs leading-6 text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-slate-900/30 border-r border-slate-200 dark:border-slate-800 tabular-nums shrink-0"
        >
          {lines.map((_, idx) => {
            const lineNum = idx + 1;
            const diag = errorLines.get(lineNum);
            const isFocused = focusedLine === lineNum;
            return (
              <div
                key={lineNum}
                className={`pr-1 rounded-sm ${
                  diag?.severity === 'error'
                    ? 'text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/40'
                    : diag?.severity === 'warning'
                      ? 'text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/40'
                      : isFocused
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : ''
                }`}
              >
                {lineNum}
              </div>
            );
          })}
        </div>

        {/* Code input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            updateCursor();
          }}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          onClick={updateCursor}
          onKeyUp={updateCursor}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          aria-label="EasyJS code input"
          className="flex-1 w-full h-full p-3 font-mono text-xs leading-6 text-slate-900 dark:text-slate-100 bg-transparent resize-none focus:outline-none overflow-auto"
        />
      </div>
    </section>
  );
}
