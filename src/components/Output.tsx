import { useMemo, useState } from 'react';
import { Check, Copy, ChevronRight, ChevronDown } from 'lucide-react';
import type { CompileResult, ProgramNode } from '../compiler/index.ts';
import { TokenType } from '../compiler/lexer/tokens.ts';
import type { PointerRuntimeEvent } from '../compiler/utils/helpers.ts';

type OutputTab = 'js' | 'tokens' | 'ast' | 'pointers';

interface OutputProps {
  compileResult: CompileResult;
  pointerEvents: PointerRuntimeEvent[];
}

export function Output({ compileResult, pointerEvents }: OutputProps) {
  const [activeTab, setActiveTab] = useState<OutputTab>('js');
  const [showPrelude, setShowPrelude] = useState(false);
  const [hideNewlines, setHideNewlines] = useState(true);
  const [tokenFilter, setTokenFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const displayedJS = useMemo(() => {
    if (!compileResult.code) return '';
    if (showPrelude) return compileResult.code;
    const splitMarker = '// --- EasyJS Program ---';
    if (compileResult.code.includes(splitMarker)) {
      const idx = compileResult.code.indexOf(splitMarker);
      let body = compileResult.code.slice(idx + splitMarker.length).trim();
      if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1).trim();
      }
      return body;
    }
    return compileResult.code;
  }, [compileResult.code, showPrelude]);

  const filteredTokens = useMemo(() => {
    const q = tokenFilter.trim().toLowerCase();
    return compileResult.tokens.filter((tok) => {
      if (hideNewlines && tok.type === TokenType.Newline) return false;
      if (!q) return true;
      return (
        tok.type.toLowerCase().includes(q) ||
        tok.lexeme.toLowerCase().includes(q)
      );
    });
  }, [compileResult.tokens, hideNewlines, tokenFilter]);

  const handleCopy = async () => {
    if (!displayedJS) return;
    try {
      await navigator.clipboard.writeText(displayedJS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable in restricted frames
    }
  };

  return (
    <section
      aria-label="Compiler Output Inspector"
      className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950"
    >
      {/* Header & Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
          {(
            [
              { id: 'js', label: 'Generated JS' },
              { id: 'tokens', label: `Tokens (${compileResult.tokens.length})` },
              { id: 'ast', label: 'AST' },
              { id: 'pointers', label: `Pointers (${compileResult.pointers.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>Compile {compileResult.timings.totalMs} ms</span>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'js' && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-800 text-xs shrink-0">
              <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showPrelude}
                  onChange={(e) => setShowPrelude(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700"
                />
                Include runtime prelude
              </label>

              <button
                type="button"
                onClick={handleCopy}
                disabled={!displayedJS}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy JS'}
              </button>
            </div>

            {compileResult.success ? (
              <pre className="p-4 font-mono text-xs leading-6 text-slate-800 dark:text-slate-200 whitespace-pre overflow-auto flex-1">
                {displayedJS || '// No emitted statements'}
              </pre>
            ) : (
              <div className="p-6 text-xs text-slate-600 dark:text-slate-400">
                Code generation paused due to {compileResult.diagnostics.length} compiler diagnostic(s). Inspect the Diagnostics tab below for exact line and column details.
              </div>
            )}
          </div>
        )}

        {activeTab === 'tokens' && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <input
                type="search"
                value={tokenFilter}
                onChange={(e) => setTokenFilter(e.target.value)}
                placeholder="Filter token type or lexeme..."
                className="w-60 px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded focus:outline-none focus:border-emerald-600"
              />
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideNewlines}
                  onChange={(e) => setHideNewlines(e.target.checked)}
                />
                Hide newlines
              </label>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="py-2 px-4 font-medium">Loc</th>
                    <th className="py-2 px-4 font-medium">Token Type</th>
                    <th className="py-2 px-4 font-medium">Lexeme</th>
                    <th className="py-2 px-4 font-medium">Literal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono">
                  {filteredTokens.map((tok, idx) => (
                    <tr
                      key={`${tok.start}-${idx}`}
                      className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    >
                      <td className="py-1.5 px-4 text-slate-500 tabular-nums">
                        {tok.line}:{tok.column}
                      </td>
                      <td className="py-1.5 px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                        {tok.type}
                      </td>
                      <td className="py-1.5 px-4 text-slate-900 dark:text-slate-100">
                        {tok.lexeme === '\n' ? '\\n' : tok.lexeme || 'EOF'}
                      </td>
                      <td className="py-1.5 px-4 text-slate-500 dark:text-slate-400">
                        {tok.literal !== null && tok.literal !== tok.lexeme
                          ? JSON.stringify(tok.literal)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ast' && (
          <div className="p-4 font-mono text-xs overflow-auto">
            <AstTreeNode label="Program" value={compileResult.ast} defaultOpen />
          </div>
        )}

        {activeTab === 'pointers' && (
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Static Ownership & Pointer Rules
              </h3>
              {compileResult.pointers.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No smart or rule pointers declared in this program. Use <code className="font-mono">own</code>, <code className="font-mono">ref</code>, or <code className="font-mono">shared</code> to track memory ownership.
                </p>
              ) : (
                <table className="w-full text-left border-collapse text-xs border border-slate-200 dark:border-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-medium">Pointer</th>
                      <th className="py-2 px-3 font-medium">Mode</th>
                      <th className="py-2 px-3 font-medium">Static State</th>
                      <th className="py-2 px-3 font-medium text-right">Borrows</th>
                      <th className="py-2 px-3 font-medium text-right">Line</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                    {compileResult.pointers.map((ptr, idx) => (
                      <tr key={`${ptr.name}-${idx}`}>
                        <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-medium">
                          {ptr.name}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                          {ptr.mode}
                        </td>
                        <td
                          className={`py-2 px-3 font-medium ${
                            ptr.state === 'active'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : ptr.state === 'moved'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {ptr.state}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {ptr.borrowCount}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-500">
                          {ptr.line}:{ptr.column}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {pointerEvents.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Runtime Pointer Lifecycle Events
                </h3>
                <table className="w-full text-left border-collapse text-xs border border-slate-200 dark:border-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-medium">Op</th>
                      <th className="py-2 px-3 font-medium">Target</th>
                      <th className="py-2 px-3 font-medium">State</th>
                      <th className="py-2 px-3 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                    {pointerEvents.map((ev, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-3 text-emerald-700 dark:text-emerald-400">
                          {ev.op}
                        </td>
                        <td className="py-1.5 px-3 text-slate-900 dark:text-slate-100">
                          {ev.name}
                        </td>
                        <td className="py-1.5 px-3 text-slate-600 dark:text-slate-300">
                          {ev.state}
                        </td>
                        <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400">
                          {ev.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Symbol Table ({compileResult.symbols.length})
              </h3>
              <table className="w-full text-left border-collapse text-xs border border-slate-200 dark:border-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="py-2 px-3 font-medium">Symbol</th>
                    <th className="py-2 px-3 font-medium">Kind</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium text-right">Scope</th>
                    <th className="py-2 px-3 font-medium text-right">Loc</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {compileResult.symbols.map((sym, idx) => (
                    <tr key={`${sym.name}-${idx}`}>
                      <td className="py-1.5 px-3 text-slate-900 dark:text-slate-100 font-medium">
                        {sym.name}
                      </td>
                      <td className="py-1.5 px-3 text-slate-600 dark:text-slate-300">
                        {sym.kind}
                      </td>
                      <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400">
                        {sym.typeName ?? 'inferred'}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                        {sym.scopeDepth}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                        {sym.line}:{sym.column}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function AstTreeNode({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: ProgramNode | unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (value === null || typeof value !== 'object') {
    return (
      <div className="pl-4 py-0.5 leading-5">
        <span className="text-slate-500 dark:text-slate-400">{label}: </span>
        <span className="text-emerald-700 dark:text-emerald-400">
          {JSON.stringify(value)}
        </span>
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const obj = value as Record<string, unknown>;
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(obj).filter(([k]) => k !== 'line' && k !== 'column');

  const summary =
    !isArr && typeof obj.kind === 'string'
      ? obj.kind
      : isArr
        ? `[${entries.length}]`
        : '{...}';

  return (
    <div className="pl-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 py-0.5 text-left hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        )}
        <span className="text-slate-700 dark:text-slate-300 font-medium">
          {label}
        </span>
        <span className="text-slate-400 dark:text-slate-500">
          {summary}
        </span>
      </button>

      {open && (
        <div className="border-l border-slate-200 dark:border-slate-800 ml-1.5 pl-2">
          {entries.map(([k, v]) => (
            <AstTreeNode
              key={k}
              label={k}
              value={v}
              defaultOpen={k === 'body' || k === 'statements'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
