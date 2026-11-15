export interface PointerRuntimeEvent {
  op: 'own' | 'move' | 'borrow' | 'shared' | 'clone' | 'drop';
  name: string;
  state: string;
  detail: string;
}

export interface ExecutionResult {
  logs: string[];
  pointerEvents: PointerRuntimeEvent[];
  durationMs: number;
  error?: string;
  haltedByExit?: boolean;
}

export interface ExecuteSyncOptions {
  stdin?: string[];
}

export interface ExecuteAsyncOptions {
  stdin?: string[];
  onLog?: (line: string) => void;
  onInput?: (prompt: string) => Promise<string>;
  onEcho?: (prompt: string, value: string) => void;
  onAlert?: (message: string) => Promise<void> | void;
  onBrowser?: (url: string) => void;
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
  g.__ejs_io = null;

  try {
    const wrapped = `
      "use strict";
      ${code}
      return typeof __ejs !== "undefined" ? __ejs.pointerEvents : [];
    `;
    const runner = new Function('console', wrapped);
    const pointerEvents = (runner(capturedConsole) ?? []) as PointerRuntimeEvent[];
    const durationMs = Number((performance.now() - start).toFixed(2));
    return { logs, pointerEvents, durationMs };
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
    onInput: options.onInput,
    onEcho: options.onEcho,
    onAlert: options.onAlert,
    onBrowser: options.onBrowser,
  };

  try {
    const wrapped = `
      "use strict";
      return (async () => {
        try {
          ${code}
        } finally {
          if (typeof __ejs !== "undefined" && typeof __ejs.cleanupTimers === "function") {
            // Keep scheduled intervals alive unless stopped via stop()/exit()
          }
        }
        return typeof __ejs !== "undefined" ? __ejs.pointerEvents : [];
      })();
    `;
    const runner = new Function('console', wrapped);
    const pointerEvents = ((await runner(capturedConsole)) ?? []) as PointerRuntimeEvent[];
    const durationMs = Number((performance.now() - start).toFixed(2));
    return { logs, pointerEvents, durationMs };
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
