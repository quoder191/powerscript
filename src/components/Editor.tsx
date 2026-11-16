import React, { useMemo, useRef, useState } from 'react';
import type { CompilerDiagnostic, SymbolRecord } from '../compiler/index.ts';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  diagnostics: CompilerDiagnostic[];
  symbols?: SymbolRecord[];
  focusedLine?: number | null;
  debugLine?: number | null;
  breakpoints?: number[];
  onToggleBreakpoint?: (line: number) => void;
}

const KEYWORD_SET = new Set([
  'let', 'var', 'const', 'fn', 'function', 'return', 'class', 'struct', 'enum',
  'trait', 'interface', 'implements', 'extends', 'init', 'constructor', 'self',
  'this', 'super', 'pub', 'priv', 'prot', 'static', 'override', 'new', 'own',
  'ref', 'shared', 'move', 'borrow', 'drop', 'if', 'elif', 'else', 'for', 'in',
  'while', 'do', 'loop', 'repeat', 'times', 'break', 'continue', 'match', 'case',
  'default', 'try', 'catch', 'throw', 'defer', 'scope', 'style', 'and', 'or', 'not',
  'is', 'as', 'import', 'export', 'from', 'true', 'false', 'null', 'nullptr', 'NULL',
  'none', 'delete', 'sizeof', 'const',
]);

const TYPE_SET = new Set([
  'int', 'float', 'double', 'long', 'short', 'char', 'number', 'str', 'string', 'text',
  'bool', 'boolean', 'void', 'any', 'auto', 'list', 'array', 'map', 'dict', 'stack',
  'queue', 'set', 'ptr', 'unique_ptr', 'shared_ptr', 'weak_ptr',
]);

const BUILTIN_SUGGESTIONS = [
  { label: 'yourgui', detail: 'gui · built-in frontend UI library' },
  { label: 'heading', detail: 'yourgui · heading(text, level=1)' },
  { label: 'text', detail: 'yourgui · text(value, opts)' },
  { label: 'button', detail: 'yourgui · button(label, onClickOrOpts)' },
  { label: 'input', detail: 'yourgui/io · input(placeholder, type)' },
  { label: 'textarea', detail: 'yourgui · textarea(placeholder, opts)' },
  { label: 'checkbox', detail: 'yourgui · checkbox(label, checked)' },
  { label: 'radio', detail: 'yourgui · radio(label, name, value)' },
  { label: 'select', detail: 'yourgui · select(options, opts)' },
  { label: 'option', detail: 'yourgui · option(label, value, select)' },
  { label: 'image', detail: 'yourgui · image(src, alt)' },
  { label: 'link', detail: 'yourgui · link(label, href)' },
  { label: 'video', detail: 'yourgui · video(src, opts)' },
  { label: 'audio', detail: 'yourgui · audio(src, opts)' },
  { label: 'container', detail: 'yourgui · container(idOrOpts, builder)' },
  { label: 'section', detail: 'yourgui · section(id, builder)' },
  { label: 'dom', detail: 'yourgui · dom(id) lookup by section/element ID' },
  { label: 'byId', detail: 'yourgui · byId(id) lookup element by ID' },
  { label: 'getById', detail: 'yourgui · getById(id) lookup element by ID' },
  { label: 'selectId', detail: 'yourgui · selectId(id) select element by ID' },
  { label: 'render', detail: 'yourgui · render(id, builderFn) re-render section' },
  { label: 'mount', detail: 'yourgui · mount(id, builderOrNode) append to ID' },
  { label: 'click', detail: 'yourgui · click(idOrEl) trigger click handler' },
  { label: 'row', detail: 'yourgui · row(builder)' },
  { label: 'column', detail: 'yourgui · column(builder)' },
  { label: 'grid', detail: 'yourgui · grid(cols, builder)' },
  { label: 'form', detail: 'yourgui · form(builder)' },
  { label: 'line', detail: 'yourgui · line()' },
  { label: 'onClick', detail: 'yourgui · onClick(el, fn)' },
  { label: 'onInput', detail: 'yourgui · onInput(el, fn)' },
  { label: 'onChange', detail: 'yourgui · onChange(el, fn)' },
  { label: 'onSubmit', detail: 'yourgui · onSubmit(formEl, fn)' },
  { label: 'yourgui.css', detail: 'yourgui · css(stylesheet)' },
  { label: 'make_unique', detail: 'cpp · make_unique(val) -> unique_ptr' },
  { label: 'make_shared', detail: 'cpp · make_shared(val) -> shared_ptr' },
  { label: 'unique_ptr', detail: 'cpp · unique_ptr(val)' },
  { label: 'shared_ptr', detail: 'cpp · shared_ptr(val)' },
  { label: 'weak_ptr', detail: 'cpp · weak_ptr(sharedPtr)' },
  { label: 'sizeof', detail: 'cpp · sizeof(typeOrVal)' },
  { label: 'addressOf', detail: 'cpp · addressOf(var) -> raw ptr' },
  { label: 'browserLocation', detail: 'cpp · browserLocation(ptr) -> URL & address' },
  { label: 'print', detail: 'core · print(...args)' },
  { label: 'alert', detail: 'popup · alert(message)' },
  { label: 'confirm', detail: 'popup · confirm(message) -> bool' },
  { label: 'prompt', detail: 'popup · prompt(message, default)' },
  { label: 'uppercase', detail: 'str · uppercase(s)' },
  { label: 'lowercase', detail: 'str · lowercase(s)' },
  { label: 'length', detail: 'core · length(x)' },
  { label: 'replace', detail: 'str · replace(s, a, b)' },
  { label: 'split', detail: 'str · split(s, sep)' },
  { label: 'join', detail: 'str · join(arr, sep)' },
  { label: 'reverse', detail: 'str/arr · reverse(x)' },
  { label: 'contains', detail: 'core · contains(col, val)' },
  { label: 'push', detail: 'arr · push(items, val)' },
  { label: 'pop', detail: 'arr · pop(items)' },
  { label: 'sort', detail: 'arr · sort(items)' },
  { label: 'shuffle', detail: 'arr · shuffle(items)' },
  { label: 'find', detail: 'arr · find(items, pred)' },
  { label: 'filter', detail: 'arr · filter(items, fn)' },
  { label: 'unique', detail: 'arr · unique(items)' },
  { label: 'first', detail: 'arr · first(items)' },
  { label: 'last', detail: 'arr · last(items)' },
  { label: 'random', detail: 'math · random(min, max)' },
  { label: 'sqrt', detail: 'math · sqrt(n)' },
  { label: 'sleep', detail: 'sys · sleep(ms)' },
  { label: 'time', detail: 'sys · time()' },
  { label: 'date', detail: 'sys · date()' },
  { label: 'timer', detail: 'sys · timer(sec, cb)' },
  { label: 'interval', detail: 'sys · interval(ms, cb)' },
  { label: 'stop', detail: 'sys · stop()' },
  { label: 'exit', detail: 'sys · exit()' },
  { label: 'browser', detail: 'browser · browser(url)' },
  { label: 'download', detail: 'sys · download(file)' },
  { label: 'readFile', detail: 'fs · readFile(path)' },
  { label: 'writeFile', detail: 'fs · writeFile(path, text)' },
  { label: 'deleteFile', detail: 'fs · deleteFile(path)' },
  { label: 'fetch', detail: 'net · fetch(url)' },
  { label: 'copy', detail: 'browser · copy(text)' },
  { label: 'speak', detail: 'browser · speak(text)' },
  { label: 'listen', detail: 'browser · listen()' },
  { label: 'stack.array', detail: 'stack · array(...items)' },
  { label: 'stack.list', detail: 'stack · list(n, fill)' },
  { label: 'stack.dict', detail: 'stack · dict(keys, vals)' },
  { label: 'stack.merge', detail: 'stack · merge(...dicts)' },
  { label: 'db.save', detail: 'db · save(table, record)' },
  { label: 'db.find', detail: 'db · find(table, query)' },
  { label: 'db.all', detail: 'db · all(table)' },
  { label: 'server.get', detail: 'http · get(path, handler)' },
  { label: 'server.start', detail: 'http · start(port)' },
  { label: 'ui.card', detail: 'ui · card(title, body)' },
  { label: 'ui.table', detail: 'ui · table(rows, cols)' },
  { label: 'ui.chart', detail: 'ui · chart(title, data)' },
  { label: 'ui.html', detail: 'ui · html(markup)' },
  { label: 'pkg.install', detail: 'pkg · install(name)' },
];

interface HighlightSegment {
  text: string;
  cls: string;
}

function highlightLine(line: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    // Comments (# or //)
    if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
      segments.push({ text: line.slice(i), cls: 'text-slate-400 dark:text-slate-500 italic' });
      break;
    }

    // String literals (including f"...")
    if (
      ((ch === 'f' || ch === 'F') && (line[i + 1] === '"' || line[i + 1] === "'")) ||
      ch === '"' ||
      ch === "'" ||
      ch === '`'
    ) {
      let start = i;
      const quote = ch === 'f' || ch === 'F' ? line[++i] : ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\' && i + 1 < line.length) {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      segments.push({ text: line.slice(start, i), cls: 'text-amber-600 dark:text-amber-300' });
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < line.length && /[0-9a-fA-FxXbB._]/.test(line[i])) i++;
      segments.push({ text: line.slice(start, i), cls: 'text-sky-600 dark:text-sky-400' });
      continue;
    }

    // Identifiers / keywords / types
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) i++;
      const word = line.slice(start, i);
      if (KEYWORD_SET.has(word)) {
        segments.push({ text: word, cls: 'text-violet-600 dark:text-violet-400 font-semibold' });
      } else if (TYPE_SET.has(word)) {
        segments.push({ text: word, cls: 'text-cyan-600 dark:text-cyan-400' });
      } else if (line[i] === '(') {
        segments.push({ text: word, cls: 'text-emerald-700 dark:text-emerald-400' });
      } else {
        segments.push({ text: word, cls: 'text-slate-900 dark:text-slate-100' });
      }
      continue;
    }

    // Operators & punctuation
    const start = i;
    while (i < line.length && !/[a-zA-Z0-9_$"'`#/]/.test(line[i])) i++;
    if (i === start) i++;
    segments.push({ text: line.slice(start, i), cls: 'text-slate-600 dark:text-slate-300' });
  }

  return segments;
}

export function Editor({
  value,
  onChange,
  onRun,
  diagnostics,
  symbols = [],
  focusedLine,
  debugLine,
  breakpoints = [],
  onToggleBreakpoint,
}: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [caretOffset, setCaretOffset] = useState(0);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const [dismissedAtOffset, setDismissedAtOffset] = useState<number | null>(null);

  const lines = useMemo(() => value.split('\n'), [value]);
  const highlightedLines = useMemo(() => lines.map((l) => highlightLine(l)), [lines]);
  const breakpointSet = useMemo(() => new Set(breakpoints), [breakpoints]);

  const errorLines = useMemo(() => {
    const map = new Map<number, CompilerDiagnostic>();
    for (const d of diagnostics) {
      if (!map.has(d.line)) map.set(d.line, d);
    }
    return map;
  }, [diagnostics]);

  // Extract current word / namespace prefix before cursor for autocomplete
  const activePrefix = useMemo(() => {
    if (dismissedAtOffset === caretOffset) return '';
    const before = value.slice(0, caretOffset);
    const match = before.match(/([a-zA-Z_$][a-zA-Z0-9_$.]*)$/);
    return match ? match[1] : '';
  }, [value, caretOffset, dismissedAtOffset]);

  const suggestions = useMemo(() => {
    if (!activePrefix || activePrefix.length < 2) return [];
    const q = activePrefix.toLowerCase();
    const userSyms = symbols.map((s) => ({
      label: s.name,
      detail: `${s.kind}${s.typeName ? ` · ${s.typeName}` : ''}`,
    }));
    const pool = [...BUILTIN_SUGGESTIONS, ...userSyms];
    const seen = new Set<string>();
    const matches: Array<{ label: string; detail: string }> = [];
    for (const item of pool) {
      if (seen.has(item.label)) continue;
      if (item.label.toLowerCase().startsWith(q) && item.label !== activePrefix) {
        seen.add(item.label);
        matches.push(item);
        if (matches.length >= 6) break;
      }
    }
    return matches;
  }, [activePrefix, symbols]);

  const applySuggestion = (label: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = caretOffset - activePrefix.length;
    const next = value.slice(0, start) + label + value.slice(caretOffset);
    onChange(next);
    const nextOffset = start + label.length;
    setCaretOffset(nextOffset);
    setSelectedSuggestionIdx(0);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = nextOffset;
      el.selectionEnd = nextOffset;
      updateCursor();
    });
  };

  const updateCursor = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    setCaretOffset(pos);
    const before = value.slice(0, pos);
    const split = before.split('\n');
    setCursorPos({
      line: split.length,
      col: split[split.length - 1].length + 1,
    });
  };

  const handleScroll = () => {
    const el = textareaRef.current;
    if (!el) return;
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
    if (preRef.current) {
      preRef.current.scrollTop = el.scrollTop;
      preRef.current.scrollLeft = el.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun();
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const chosen = suggestions[selectedSuggestionIdx] ?? suggestions[0];
        if (chosen) applySuggestion(chosen.label);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAtOffset(caretOffset);
        return;
      }
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
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Source Code
          </h2>
          {breakpoints.length > 0 && (
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 tabular-nums">
              {breakpoints.length} breakpoint{breakpoints.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span aria-hidden="true">·</span>
          <span>{lines.length} lines</span>
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Line number + breakpoint gutter */}
        <div
          ref={gutterRef}
          className="w-14 py-3 px-1.5 overflow-hidden select-none text-right font-mono text-xs leading-6 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/30 border-r border-slate-200 dark:border-slate-800 tabular-nums shrink-0"
        >
          {lines.map((_, idx) => {
            const lineNum = idx + 1;
            const diag = errorLines.get(lineNum);
            const isFocused = focusedLine === lineNum;
            const isDebug = debugLine === lineNum;
            const hasBp = breakpointSet.has(lineNum);
            return (
              <button
                key={lineNum}
                type="button"
                onClick={() => onToggleBreakpoint?.(lineNum)}
                title={onToggleBreakpoint ? 'Click to toggle breakpoint' : undefined}
                className={`w-full flex items-center justify-end gap-1.5 pr-1 rounded-sm cursor-pointer ${
                  isDebug
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : diag?.severity === 'error'
                      ? 'text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/40'
                      : diag?.severity === 'warning'
                        ? 'text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/40'
                        : isFocused
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    hasBp ? 'bg-red-500' : 'bg-transparent'
                  }`}
                />
                <span>{lineNum}</span>
              </button>
            );
          })}
        </div>

        {/* Syntax-highlighted overlay + transparent textarea */}
        <div className="relative flex-1 min-w-0 h-full overflow-hidden">
          <pre
            ref={preRef}
            aria-hidden="true"
            className="absolute inset-0 m-0 p-3 font-mono text-xs leading-6 whitespace-pre overflow-hidden pointer-events-none select-none"
          >
            {highlightedLines.map((segs, lineIdx) => {
              const isDebug = debugLine === lineIdx + 1;
              return (
                <div
                  key={lineIdx}
                  className={isDebug ? 'bg-emerald-500/10 -mx-3 px-3' : undefined}
                >
                  {segs.length === 0 ? (
                    ' '
                  ) : (
                    segs.map((seg, sIdx) => (
                      <span key={sIdx} className={seg.cls}>
                        {seg.text}
                      </span>
                    ))
                  )}
                </div>
              );
            })}
          </pre>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setDismissedAtOffset(null);
              setSelectedSuggestionIdx(0);
              onChange(e.target.value);
              setCaretOffset(e.target.selectionStart ?? 0);
              const before = e.target.value.slice(0, e.target.selectionStart ?? 0);
              const split = before.split('\n');
              setCursorPos({ line: split.length, col: split[split.length - 1].length + 1 });
            }}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="EasyJS code input"
            className="relative z-10 w-full h-full p-3 font-mono text-xs leading-6 text-transparent caret-slate-900 dark:caret-slate-100 selection:bg-emerald-500/25 bg-transparent resize-none focus:outline-none overflow-auto whitespace-pre"
          />

          {/* Autocomplete suggestions bar */}
          {suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Code suggestions"
              className="absolute bottom-3 right-3 z-20 w-72 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden"
            >
              <div className="px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span>Suggestions</span>
                <span className="font-mono">Tab to accept</span>
              </div>
              {suggestions.map((item, idx) => (
                <button
                  key={item.label}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(item.label);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                    idx === selectedSuggestionIdx
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="font-mono font-semibold truncate">{item.label}</span>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {item.detail}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
