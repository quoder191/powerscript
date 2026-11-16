export interface PointerRuntimeEvent {
  op: 'own' | 'move' | 'borrow' | 'shared' | 'clone' | 'drop';
  name: string;
  state: string;
  detail: string;
}

export interface GuiVNodeSnapshot {
  id: string;
  tag: string;
  textContent?: string;
  html?: string;
  attrs: Record<string, string | boolean>;
  style: Record<string, string>;
  children: GuiVNodeSnapshot[];
}

export type VisualOutputItem =
  | { kind: 'html'; content: string }
  | { kind: 'card'; title: string; body: string; footer?: string }
  | { kind: 'table'; columns: string[]; rows: Array<Record<string, unknown>> }
  | { kind: 'chart'; title: string; chartType: string; data: Array<{ label: string; value: number }> }
  | {
      kind: 'yourgui';
      pageId: string;
      title: string;
      styles: string[];
      nodes: GuiVNodeSnapshot[];
    };

export interface RegisteredRouteInfo {
  method: string;
  path: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  scope: string;
}

export interface CallFrame {
  name: string;
  line: number;
}

export interface ExecutionResult {
  logs: string[];
  pointerEvents: PointerRuntimeEvent[];
  visualOutputs?: VisualOutputItem[];
  registeredRoutes?: RegisteredRouteInfo[];
  finalVariables?: DebugVariable[];
  durationMs: number;
  error?: string;
  haltedByExit?: boolean;
}

export interface ExecuteSyncOptions {
  stdin?: string[];
}

export type GuiEventDispatcher = (
  elementId: string,
  eventType: string,
  payload?: { value?: string; checked?: boolean }
) => Promise<void> | void;

export interface ExecuteAsyncOptions {
  stdin?: string[];
  onLog?: (line: string) => void;
  onInput?: (prompt: string) => Promise<string>;
  onEcho?: (prompt: string, value: string) => void;
  onAlert?: (message: string) => Promise<void> | void;
  onConfirm?: (message: string) => Promise<boolean> | boolean;
  onPrompt?: (message: string, defaultValue?: string) => Promise<string | null> | string | null;
  onBrowser?: (url: string) => void;
  onVisual?: (item: VisualOutputItem) => void;
  onServerStart?: (port: number, routes: RegisteredRouteInfo[]) => void;
  registerGuiDispatcher?: (dispatcher: GuiEventDispatcher) => void;
}

function isExitSignalError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as { isExitSignal?: boolean }).isExitSignal === true
  );
}

export function executeCompiledJS(
  code: string,
  options: ExecuteSyncOptions = {}
): ExecutionResult {
  const logs: string[] = [];
  const start = performance.now();

  const capturedConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push('[warn] ' + args.map((a) => String(a)).join(' '));
    },
    error: (...args: unknown[]) => {
      logs.push('[error] ' + args.map((a) => String(a)).join(' '));
    },
  };

  const g = globalThis as Record<string, unknown>;
  const prevStdin = g.__ejs_stdin;
  const prevIo = g.__ejs_io;
  g.__ejs_stdin = options.stdin ?? [];
  g.__ejs_io = { sandboxed: true };

  try {
    const wrapped = `
      "use strict";
      ${code}
      if (typeof __ejs !== "undefined" && __ejs.yourgui && typeof __ejs.yourgui.flush === "function") {
        __ejs.yourgui.flush();
      }
      return typeof __ejs !== "undefined" ? {
        pointerEvents: __ejs.pointerEvents,
        visualOutputs: __ejs.visualOutputs || [],
        registeredRoutes: (__ejs.registeredRoutes || []).map(r => ({ method: r.method, path: r.path }))
      } : { pointerEvents: [], visualOutputs: [], registeredRoutes: [] };
    `;
    const runner = new Function('console', wrapped);
    const meta = (runner(capturedConsole) ?? {}) as {
      pointerEvents?: PointerRuntimeEvent[];
      visualOutputs?: VisualOutputItem[];
      registeredRoutes?: RegisteredRouteInfo[];
    };
    const durationMs = Number((performance.now() - start).toFixed(2));
    return {
      logs,
      pointerEvents: meta.pointerEvents ?? [],
      visualOutputs: meta.visualOutputs ?? [],
      registeredRoutes: meta.registeredRoutes ?? [],
      durationMs,
    };
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    if (isExitSignalError(err)) {
      return { logs, pointerEvents: [], durationMs, haltedByExit: true };
    }
    return {
      logs,
      pointerEvents: [],
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    g.__ejs_stdin = prevStdin;
    g.__ejs_io = prevIo;
  }
}

export async function executeCompiledJSAsync(
  code: string,
  options: ExecuteAsyncOptions = {}
): Promise<ExecutionResult> {
  const logs: string[] = [];
  const start = performance.now();

  const capturedConsole = {
    log: (...args: unknown[]) => {
      const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      logs.push(line);
      options.onLog?.(line);
    },
    warn: (...args: unknown[]) => {
      const line = '[warn] ' + args.map((a) => String(a)).join(' ');
      logs.push(line);
      options.onLog?.(line);
    },
    error: (...args: unknown[]) => {
      const line = '[error] ' + args.map((a) => String(a)).join(' ');
      logs.push(line);
      options.onLog?.(line);
    },
  };

  const g = globalThis as Record<string, unknown>;
  const prevStdin = g.__ejs_stdin;
  const prevIo = g.__ejs_io;
  g.__ejs_stdin = options.stdin ?? [];
  g.__ejs_io = {
    sandboxed: true,
    onInput: options.onInput,
    onEcho: options.onEcho,
    onAlert: options.onAlert,
    onConfirm: options.onConfirm,
    onPrompt: options.onPrompt,
    onBrowser: options.onBrowser,
    onVisual: options.onVisual,
    onServerStart: options.onServerStart,
    registerGuiDispatcher: options.registerGuiDispatcher,
  };

  try {
    const wrapped = `
      "use strict";
      return (async () => {
        try {
          ${code}
          if (typeof __ejs !== "undefined" && __ejs.yourgui && typeof __ejs.yourgui.flush === "function") {
            __ejs.yourgui.flush();
          }
          return typeof __ejs !== "undefined" ? {
            pointerEvents: __ejs.pointerEvents,
            visualOutputs: __ejs.visualOutputs || [],
            registeredRoutes: (__ejs.registeredRoutes || []).map(r => ({ method: r.method, path: r.path }))
          } : { pointerEvents: [], visualOutputs: [], registeredRoutes: [] };
        } finally {
          if (typeof __ejs !== "undefined" && typeof __ejs.cleanupTimers === "function") {
            // Keep scheduled intervals alive unless stopped via stop()/exit()
          }
        }
      })();
    `;
    const runner = new Function('console', wrapped);
    const meta = ((await runner(capturedConsole)) ?? {}) as {
      pointerEvents?: PointerRuntimeEvent[];
      visualOutputs?: VisualOutputItem[];
      registeredRoutes?: RegisteredRouteInfo[];
    };
    const durationMs = Number((performance.now() - start).toFixed(2));
    return {
      logs,
      pointerEvents: meta.pointerEvents ?? [],
      visualOutputs: meta.visualOutputs ?? [],
      registeredRoutes: meta.registeredRoutes ?? [],
      durationMs,
    };
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    if (isExitSignalError(err)) {
      return { logs, pointerEvents: [], durationMs, haltedByExit: true };
    }
    return {
      logs,
      pointerEvents: [],
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    g.__ejs_stdin = prevStdin;
    g.__ejs_io = prevIo;
  }
}

export function formatTokenLocation(line: number, column: number): string {
  return `${line}:${column}`;
}
