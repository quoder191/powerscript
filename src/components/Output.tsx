import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Globe, LayoutGrid, Terminal } from 'lucide-react';
import type {
  CompileResult,
  DebugSnapshot,
  DebugVariable,
  ExecutionResult,
  GuiVNodeSnapshot,
  RegisteredRouteInfo,
  VisualOutputItem,
} from '../compiler/index.ts';

interface OutputProps {
  compileResult: CompileResult;
  execution?: ExecutionResult;
  liveLogs: string[];
  isRunning: boolean;
  visualOutputs: VisualOutputItem[];
  registeredRoutes: RegisteredRouteInfo[];
  finalVariables: DebugVariable[];
  debugSnapshot: DebugSnapshot | null;
  activeFileName?: string | null;
  onGuiEvent?: (
    elementId: string,
    eventType: string,
    payload?: { value?: string; checked?: boolean }
  ) => void;
}

export function Output({
  compileResult,
  execution,
  liveLogs,
  isRunning,
  visualOutputs,
  registeredRoutes,
  finalVariables,
  debugSnapshot,
  activeFileName,
  onGuiEvent,
}: OutputProps) {
  const activeYourGui = useMemo(
    () =>
      visualOutputs.find(
        (v): v is Extract<VisualOutputItem, { kind: 'yourgui' }> => v.kind === 'yourgui'
      ),
    [visualOutputs]
  );

  const errorDiagnostics = useMemo(
    () => compileResult.diagnostics.filter((d) => d.severity === 'error'),
    [compileResult.diagnostics]
  );

  const activeVariables = debugSnapshot?.variables ?? finalVariables;
  const activeCallStack = debugSnapshot?.callStack ?? [];
  const isPausedDebugger = debugSnapshot?.status === 'paused';

  const displayedLogs = isPausedDebugger
    ? debugSnapshot.logs
    : isRunning
      ? liveLogs
      : (execution?.logs ?? liveLogs);

  const hasCompileErrors = errorDiagnostics.length > 0;
  const runtimeError = !isRunning ? execution?.error : undefined;

  return (
    <section
      aria-label="Frontend Preview"
      className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950"
    >
      {/* Clean Preview Header (no inspector tab clutter) */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {activeYourGui?.title || activeFileName || 'Frontend Preview'}
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums shrink-0">
          {isPausedDebugger && debugSnapshot?.currentLine != null && (
            <>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                Paused at L{debugSnapshot.currentLine}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          {isRunning ? (
            <span className="text-emerald-600 dark:text-emerald-400">Running...</span>
          ) : hasCompileErrors || runtimeError ? (
            <span className="text-red-600 dark:text-red-400 font-medium">
              {hasCompileErrors
                ? `${errorDiagnostics.length} build error(s)`
                : 'Runtime error'}
            </span>
          ) : (
            <span>Ready · {execution?.durationMs ?? compileResult.timings.totalMs} ms</span>
          )}
        </div>
      </div>

      {/* Live Preview & Effect Body */}
      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
        {/* Error Effect Banner (always shown when broken, without dumping source code) */}
        {hasCompileErrors && (
          <div className="p-4 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/25 space-y-2 shrink-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Preview halted: {errorDiagnostics.length} error(s) detected</span>
            </div>
            <ul className="space-y-1.5 text-xs font-mono text-red-800 dark:text-red-200">
              {errorDiagnostics.slice(0, 5).map((d, idx) => (
                <li key={idx} className="leading-relaxed">
                  Line {d.line}:{d.column} — {d.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {runtimeError && (
          <div className="p-4 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/25 space-y-1 shrink-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Runtime Error</span>
            </div>
            <p className="text-xs font-mono text-red-800 dark:text-red-200 whitespace-pre-wrap">
              {runtimeError}
            </p>
          </div>
        )}

        {/* Primary Visual / YourGUI Output */}
        {visualOutputs.length > 0 && (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {visualOutputs.map((item, idx) => (
              <VisualRenderer
                key={item.kind === 'yourgui' ? item.pageId : idx}
                item={item}
                onGuiEvent={onGuiEvent}
              />
            ))}
          </div>
        )}

        {/* Effect Fallback for Non-GUI Programs (or while debugging without GUI) */}
        {visualOutputs.length === 0 && !hasCompileErrors && (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {displayedLogs.length > 0 ? (
              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Terminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Program Output Effect</span>
                </div>
                <div className="font-mono text-xs leading-6 text-slate-800 dark:text-slate-200 whitespace-pre-wrap space-y-0.5">
                  {displayedLogs.map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                </div>
              </div>
            ) : (
              !runtimeError && (
                <div className="flex items-center gap-2.5 p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-xs text-slate-600 dark:text-slate-400">
                  <LayoutGrid className="w-4 h-4 shrink-0 text-slate-400" />
                  <span>
                    {isRunning
                      ? 'Executing program...'
                      : 'Program finished with no rendered frontend elements or output logs.'}
                  </span>
                </div>
              )
            )}

            {registeredRoutes.length > 0 && (
              <div className="rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Active HTTP Routes ({registeredRoutes.length})
                </div>
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {registeredRoutes.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3.5 font-semibold text-emerald-700 dark:text-emerald-400 w-24">
                          {r.method}
                        </td>
                        <td className="py-2 px-3.5 text-slate-900 dark:text-slate-100">
                          {r.path}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Debugger State Strip when actively step-debugging */}
        {isPausedDebugger && (activeVariables.length > 0 || activeCallStack.length > 0) && (
          <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15 p-3 space-y-2 shrink-0">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
              <span>Live Debugger State (Line {debugSnapshot.currentLine ?? 1})</span>
              <span className="font-mono font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                {activeVariables.length} vars · {activeCallStack.length} stack frames
              </span>
            </div>
            {activeVariables.length > 0 && (
              <div className="max-h-40 overflow-auto border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeVariables.map((v, idx) => (
                      <tr key={`${v.name}-${idx}`}>
                        <td className="py-1 px-2.5 font-semibold text-slate-900 dark:text-slate-100">
                          {v.name}
                        </td>
                        <td className="py-1 px-2.5 text-cyan-700 dark:text-cyan-400">
                          {v.type}
                        </td>
                        <td className="py-1 px-2.5 text-emerald-700 dark:text-emerald-400 break-all">
                          {v.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function VisualRenderer({
  item,
  onGuiEvent,
}: {
  item: VisualOutputItem;
  onGuiEvent?: (
    elementId: string,
    eventType: string,
    payload?: { value?: string; checked?: boolean }
  ) => void;
}) {
  if (item.kind === 'yourgui') {
    return <YourGuiBrowserPreview item={item} onGuiEvent={onGuiEvent} />;
  }

  if (item.kind === 'card') {
    return (
      <div className="p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5 shrink-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
          {item.body}
        </p>
        {item.footer && (
          <div className="pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {item.footer}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === 'table') {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto shrink-0">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <tr>
              {item.columns.map((col) => (
                <th key={col} className="py-2 px-3 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
            {item.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {item.columns.map((col) => (
                  <td key={col} className="py-1.5 px-3 text-slate-800 dark:text-slate-200 tabular-nums">
                    {row[col] === undefined ? '—' : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (item.kind === 'chart') {
    const maxVal = Math.max(1, ...item.data.map((d) => Math.abs(d.value)));
    return (
      <div className="p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 space-y-3 shrink-0">
        <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
        <div className="space-y-2">
          {item.data.map((d, i) => {
            const pct = Math.max(2, Math.round((Math.abs(d.value) / maxVal) * 100));
            return (
              <div key={i} className="grid grid-cols-[90px_1fr_56px] items-center gap-3 text-xs font-mono">
                <span className="truncate text-slate-700 dark:text-slate-300">{d.label}</span>
                <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 rounded transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {d.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const safeHtmlContent = useMemo(() => sanitizeStaticHtmlForSandbox(item.content), [item.content]);

  return (
    <iframe
      title="EasyJS Visual HTML Output"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={safeHtmlContent}
      className="w-full h-56 bg-white rounded-md border border-slate-200 dark:border-slate-800 shrink-0"
    />
  );
}

const STATIC_HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; object-src 'none'; base-uri 'none'; form-action 'none';";

function sanitizeStaticHtmlForSandbox(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/<\s*(script|iframe|object|embed|svg|math|meta|base|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|svg|math|meta|base|link)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:javascript|vbscript)\s*:/gi, 'blocked:');
  return `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${STATIC_HTML_CSP}" /></head><body>${cleaned}</body></html>`;
}

function countGuiNodes(nodes: GuiVNodeSnapshot[]): number {
  let count = 0;
  for (const n of nodes) {
    count += 1 + countGuiNodes(n.children);
  }
  return count;
}

function createFrameToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return 'ygf_' + Math.random().toString(36).slice(2) + '_' + Date.now();
}

export function buildYourGuiIframeSrcDoc(pageId: string, frameToken = ''): string {
  const bootstrapData = JSON.stringify({ pageId, frameToken });
  const previewCsp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: http: data:; media-src https: http:; font-src https: http: data:; object-src 'none'; base-uri 'none'; form-action 'none';";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${previewCsp}" />
<style id="yourgui-base-css">
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
    background: #ffffff;
    line-height: 1.5;
  }
  button {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 150ms ease, opacity 150ms ease;
  }
  button:hover:not(:disabled) {
    background: #1d4ed8;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  input, select, textarea {
    font-family: inherit;
    font-size: 13px;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #0f172a;
    background: #ffffff;
  }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 16px 0;
  }
  a {
    color: #2563eb;
  }
</style>
<style id="yourgui-user-css"></style>
<script>
(() => {
  const PAGE = ${bootstrapData};
  let latestPayload = null;

  const ALLOWED_TAGS = new Set([
    'div','span','p','section','article','main','header','footer','nav','aside',
    'h1','h2','h3','h4','h5','h6','button','input','textarea','select','option','optgroup',
    'label','form','hr','br','a','img','video','audio','source',
    'ul','ol','li','table','thead','tbody','tfoot','tr','th','td',
    'strong','b','em','i','u','s','code','pre','blockquote','small','sub','sup'
  ]);
  const DROP_SUBTREE_TAGS = new Set([
    'script','style','iframe','object','embed','svg','math','meta','base','link','template','noscript'
  ]);
  const ALLOWED_ATTRS = new Set([
    'id','class','type','value','placeholder','name','checked','disabled','readonly','required',
    'min','max','step','maxlength','minlength','rows','cols','selected','multiple',
    'alt','title','href','src','poster','target','rel','controls','loop','muted',
    'autoplay','colspan','rowspan','for','role'
  ]);
  const URL_ATTRS = new Set(['href','src','poster']);

  const sanitizeUrl = (raw, allowImageData) => {
    const val = String(raw || '').trim();
    if (!val) return '';
    if (val === '#' || val.startsWith('#') || (val.startsWith('/') && !val.startsWith('//'))) {
      return val;
    }
    const compact = val.replace(/[\\u0000-\\u0020\\u007f]+/g, '');
    if (/^(javascript|vbscript|file):/i.test(compact)) return '#';
    if (/^data:/i.test(compact)) {
      if (allowImageData && /^data:image\\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(compact)) {
        return val;
      }
      return '#';
    }
    try {
      const u = new URL(val);
      if (u.protocol === 'http:' || u.protocol === 'https:') return val;
    } catch {
      if (!compact.includes(':')) return val;
    }
    return '#';
  };

  const sanitizeCss = (rawCss) => {
    return String(rawCss || '')
      .slice(0, 32768)
      .replace(/<\\/\\s*style/gi, ' ')
      .replace(/@import\\b[^;}\\n]*;?/gi, '/* blocked */')
      .replace(/@charset\\b[^;}\\n]*;?/gi, '')
      .replace(/expression\\s*\\([^)]*\\)/gi, 'none')
      .replace(/-moz-binding\\s*:[^;}\\n]*/gi, '')
      .replace(/behavior\\s*:[^;}\\n]*/gi, '')
      .replace(/url\\s*\\([^)]*\\)/gi, 'none')
      .replace(/javascript\\s*:/gi, '')
      .replace(/vbscript\\s*:/gi, '');
  };

  const sanitizeStyleVal = (val) => {
    const s = String(val ?? '').slice(0, 512);
    if (/expression\\s*\\(|-moz-binding|behavior\\s*:|@import|url\\s*\\(|javascript\\s*:|vbscript\\s*:/i.test(s)) {
      return '';
    }
    return s.replace(/[;{}]/g, ' ').trim();
  };

  const isAllowedAttr = (attrName) => {
    const k = String(attrName || '').toLowerCase();
    if (k.startsWith('on')) return false;
    if (k === 'data-yg-id') return false;
    return ALLOWED_ATTRS.has(k) || /^aria-[a-z0-9_-]+$/.test(k) || /^data-[a-z0-9_-]+$/.test(k);
  };

  const sanitizeElementTree = (srcNode, outDoc) => {
    if (srcNode.nodeType === 3) {
      return outDoc.createTextNode(srcNode.textContent || '');
    }
    if (srcNode.nodeType !== 1) return null;
    const tag = String(srcNode.tagName || '').toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return null;

    if (!ALLOWED_TAGS.has(tag)) {
      const frag = outDoc.createDocumentFragment();
      for (const ch of Array.from(srcNode.childNodes)) {
        const clean = sanitizeElementTree(ch, outDoc);
        if (clean) frag.appendChild(clean);
      }
      return frag;
    }

    const cleanEl = outDoc.createElement(tag);
    for (const attr of Array.from(srcNode.attributes || [])) {
      const k = String(attr.name || '').toLowerCase();
      if (!isAllowedAttr(k)) continue;
      if (URL_ATTRS.has(k)) {
        const safeUrl = sanitizeUrl(attr.value, k === 'src' || k === 'poster');
        cleanEl.setAttribute(k, safeUrl || '#');
      } else {
        cleanEl.setAttribute(k, attr.value);
      }
    }
    if (tag === 'a' && cleanEl.getAttribute('target') === '_blank') {
      cleanEl.setAttribute('rel', 'noopener noreferrer');
    }
    for (const ch of Array.from(srcNode.childNodes)) {
      const clean = sanitizeElementTree(ch, outDoc);
      if (clean) cleanEl.appendChild(clean);
    }
    return cleanEl;
  };

  const sanitizeHtml = (raw) => {
    const str = String(raw || '').slice(0, 32768);
    if (typeof DOMParser === 'function') {
      try {
        const parsed = new DOMParser().parseFromString(str, 'text/html');
        const container = document.createElement('div');
        for (const child of Array.from(parsed.body.childNodes)) {
          const safeChild = sanitizeElementTree(child, document);
          if (safeChild) container.appendChild(safeChild);
        }
        return container.innerHTML;
      } catch {
        // Fallback text escape below
      }
    }
    const fallback = document.createElement('div');
    fallback.textContent = str;
    return fallback.innerHTML;
  };

  const postEvt = (id, eventType, el) => {
    window.parent.postMessage({
      source: 'yourgui',
      pageId: PAGE.pageId,
      frameToken: PAGE.frameToken,
      elementId: id,
      eventType,
      value: el && 'value' in el ? el.value : undefined,
      checked: el && 'checked' in el ? Boolean(el.checked) : undefined
    }, '*');
  };

  const buildNode = (snap) => {
    const rawTag = String(snap.tag || 'div').toLowerCase();
    const safeTag = ALLOWED_TAGS.has(rawTag) ? rawTag : 'div';
    const el = document.createElement(safeTag);
    el.setAttribute('data-yg-id', String(snap.id || ''));

    if (snap.attrs) {
      for (const [rawKey, v] of Object.entries(snap.attrs)) {
        const k = String(rawKey).toLowerCase();
        if (k === 'class') { el.className = String(v); }
        else if (k === 'value' && 'value' in el) { el.value = String(v); }
        else if (k === 'checked' && 'checked' in el) { el.checked = Boolean(v); }
        else if (!isAllowedAttr(k)) { continue; }
        else if (URL_ATTRS.has(k)) {
          const safeUrl = sanitizeUrl(String(v ?? ''), k === 'src' || k === 'poster');
          el.setAttribute(k, safeUrl || '#');
        }
        else if (v === true) { el.setAttribute(k, ''); }
        else if (v !== false && v !== null && v !== undefined) { el.setAttribute(k, String(v)); }
      }
    }
    if (safeTag === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }

    if (snap.style) {
      for (const [sk, sv] of Object.entries(snap.style)) {
        if (!/^[a-zA-Z-]+$/.test(sk) || sk === '__proto__' || sk === 'constructor' || sk === 'prototype') continue;
        const safeSv = sanitizeStyleVal(sv);
        if (safeSv) el.style[sk] = safeSv;
      }
    }

    if (snap.html !== undefined && (!snap.children || snap.children.length === 0)) {
      el.innerHTML = sanitizeHtml(snap.html);
    } else if (snap.textContent !== undefined && (!snap.children || snap.children.length === 0)) {
      el.textContent = snap.textContent;
    }

    if (Array.isArray(snap.children)) {
      for (const c of snap.children) {
        el.appendChild(buildNode(c));
      }
    }

    if (safeTag === 'button' || safeTag === 'a') {
      el.addEventListener('click', (e) => {
        if (safeTag === 'a' && (snap.attrs?.href === '#' || !snap.attrs?.href)) e.preventDefault();
        postEvt(snap.id, 'click', el);
      });
    } else {
      el.addEventListener('click', (e) => {
        if (e.target === el) postEvt(snap.id, 'click', el);
      });
    }

    if (safeTag === 'input' || safeTag === 'textarea') {
      el.addEventListener('input', () => postEvt(snap.id, 'input', el));
      el.addEventListener('change', () => postEvt(snap.id, 'change', el));
    } else if (safeTag === 'select') {
      el.addEventListener('change', () => postEvt(snap.id, 'change', el));
    } else if (safeTag === 'form') {
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        postEvt(snap.id, 'submit', el);
      });
    }

    return el;
  };

  const renderSnapshot = (payload) => {
    latestPayload = payload;
    if (!document.body) return;

    const styleEl = document.getElementById('yourgui-user-css');
    if (styleEl) {
      styleEl.textContent = Array.isArray(payload.styles)
        ? payload.styles.map((css) => sanitizeCss(css)).join('\\n\\n')
        : '';
    }

    const activeEl = document.activeElement;
    const activeId = activeEl && activeEl.getAttribute ? activeEl.getAttribute('data-yg-id') : null;
    const selStart = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
    const selEnd = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;

    document.body.innerHTML = '';
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    for (const node of nodes) {
      document.body.appendChild(buildNode(node));
    }

    if (activeId) {
      let nextActive = null;
      const candidates = document.querySelectorAll('[data-yg-id]');
      for (const candidate of candidates) {
        if (candidate.getAttribute('data-yg-id') === activeId) {
          nextActive = candidate;
          break;
        }
      }
      if (nextActive && typeof nextActive.focus === 'function') {
        nextActive.focus();
        if (selStart !== null && selEnd !== null && typeof nextActive.setSelectionRange === 'function') {
          try { nextActive.setSelectionRange(selStart, selEnd); } catch {}
        }
      }
    }
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (
      !data ||
      data.source !== 'yourgui-host' ||
      data.pageId !== PAGE.pageId ||
      data.frameToken !== PAGE.frameToken
    ) {
      return;
    }
    renderSnapshot(data);
  });

  window.addEventListener('DOMContentLoaded', () => {
    window.parent.postMessage({ source: 'yourgui', type: 'ready', pageId: PAGE.pageId, frameToken: PAGE.frameToken }, '*');
    if (latestPayload) renderSnapshot(latestPayload);
  });
})();
</script>
</head>
<body></body>
</html>`;
}

function YourGuiBrowserPreview({
  item,
  onGuiEvent,
}: {
  item: Extract<VisualOutputItem, { kind: 'yourgui' }>;
  onGuiEvent?: (
    elementId: string,
    eventType: string,
    payload?: { value?: string; checked?: boolean }
  ) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const itemRef = useRef(item);
  const onGuiEventRef = useRef(onGuiEvent);
  itemRef.current = item;
  onGuiEventRef.current = onGuiEvent;

  const frameToken = useMemo(() => createFrameToken(), [item.pageId]);
  const srcDoc = useMemo(
    () => buildYourGuiIframeSrcDoc(item.pageId, frameToken),
    [item.pageId, frameToken]
  );
  const nodeCount = useMemo(() => countGuiNodes(item.nodes), [item.nodes]);

  const pushRender = () => {
    const win = iframeRef.current?.contentWindow;
    const current = itemRef.current;
    if (!win) return;
    win.postMessage(
      {
        source: 'yourgui-host',
        pageId: current.pageId,
        frameToken,
        title: current.title,
        styles: current.styles,
        nodes: current.nodes,
      },
      '*'
    );
  };

  useEffect(() => {
    pushRender();
  }, [item]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        type?: string;
        pageId?: string;
        frameToken?: string;
        elementId?: string;
        eventType?: string;
        value?: string;
        checked?: boolean;
      } | null;
      if (
        !data ||
        data.source !== 'yourgui' ||
        data.pageId !== item.pageId ||
        data.frameToken !== frameToken
      ) {
        return;
      }
      if (data.type === 'ready') {
        pushRender();
        return;
      }
      if (
        typeof data.elementId === 'string' &&
        typeof data.eventType === 'string' &&
        onGuiEventRef.current
      ) {
        onGuiEventRef.current(data.elementId, data.eventType, {
          value: data.value,
          checked: data.checked,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [item.pageId, frameToken]);

  return (
    <div className="flex flex-col flex-1 min-h-[320px] rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
        <span className="truncate">{item.title || 'YourGUI App'}</span>
        <span className="shrink-0">{nodeCount} elements</span>
      </div>

      <iframe
        ref={iframeRef}
        title={item.title || 'YourGUI Live Website Preview'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="w-full flex-1 min-h-[280px] bg-white border-0"
      />
    </div>
  );
}
