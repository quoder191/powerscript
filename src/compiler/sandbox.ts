import type {
  ExecuteAsyncOptions,
  ExecuteSyncOptions,
  ExecutionResult,
  PointerRuntimeEvent,
  RegisteredRouteInfo,
  VisualOutputItem,
} from './utils/helpers.ts';
import {
  NetworkPolicyManager,
  SecurityPolicyManager,
  type CompilerSecurityPolicy,
  type PartialCompilerSecurityPolicy,
} from './security-policy.ts';
import { buildBrowserSandboxDocument } from './builder-engine.ts';

export interface SandboxIoOptions extends ExecuteAsyncOptions {
  signal?: AbortSignal;
  securityPolicy?: PartialCompilerSecurityPolicy;
  ephemeral?: boolean;
}

interface NodeVmModule {
  createContext: (
    sandbox?: Record<string, unknown>,
    options?: {
      name?: string;
      codeGeneration?: { strings?: boolean; wasm?: boolean };
    }
  ) => Record<string, unknown>;
  runInContext: (
    code: string,
    contextifiedObject: Record<string, unknown>,
    options?: { timeout?: number; filename?: string }
  ) => unknown;
}

const DEFAULT_SYNC_TIMEOUT_MS = 5000;

function getNodeVm(): NodeVmModule | null {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) {
      return null;
    }
    const proc = process as unknown as {
      getBuiltinModule?: (id: string) => unknown;
    };
    if (typeof proc.getBuiltinModule === 'function') {
      const vm = proc.getBuiltinModule('vm') as NodeVmModule | undefined;
      if (vm && typeof vm.createContext === 'function' && typeof vm.runInContext === 'function') {
        return vm;
      }
    }
  } catch {
    // Not in Node.js or vm unavailable
  }
  return null;
}

function isExitSignalError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as { isExitSignal?: boolean }).isExitSignal === true
  );
}

function createPolicyBoundedFetch(networkPolicy: CompilerSecurityPolicy['network']): typeof fetch {
  const hostFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  const manager = new NetworkPolicyManager(networkPolicy);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!hostFetch) {
      // Still run policy validation first so cookie/protocol/SSRF checks report consistently
      const check = manager.validateFetchCall(rawUrl, init, true);
      if (!check.ok) {
        throw new Error(check.reason);
      }
      throw new Error('SandboxError: Network fetch is unavailable in this environment');
    }
    return manager.executeBoundedFetch(hostFetch, rawUrl, init);
  }) as typeof fetch;
}

function createCapturedConsole(
  logs: string[],
  onLog?: (line: string) => void
): Record<string, (...args: unknown[]) => void> {
  return {
    log: (...args: unknown[]) => {
      const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      logs.push(line);
      onLog?.(line);
    },
    warn: (...args: unknown[]) => {
      const line = '[warn] ' + args.map((a) => String(a)).join(' ');
      logs.push(line);
      onLog?.(line);
    },
    error: (...args: unknown[]) => {
      const line = '[error] ' + args.map((a) => String(a)).join(' ');
      logs.push(line);
      onLog?.(line);
    },
  };
}

function buildGlobalThisShadowLine(mode: CompilerSecurityPolicy['globals']['globalThisMode']): string {
  if (mode === 'disabled') {
    return `const globalThis = typeof __ejs_disabled_globalThis !== "undefined" ? __ejs_disabled_globalThis : undefined;`;
  }
  if (mode === 'readonly') {
    return `const globalThis = Object.freeze({ Math, JSON, Date, Array, Object, String, Number, Boolean, console, location, fetch: typeof __ejs_fetch === "function" ? __ejs_fetch : undefined });`;
  }
  return '';
}

export function buildSandboxHardeningLine(freezeRealmPrototypes: boolean): string {
  if (!freezeRealmPrototypes) return '';
  return `
    try {
      Object.preventExtensions(Object.prototype);
      Object.preventExtensions(Array.prototype);
      Object.preventExtensions(Function.prototype);
      Object.preventExtensions(String.prototype);
      Object.preventExtensions(Number.prototype);
    } catch {}
  `;
}

export function wrapCompiledCodeSync(
  code: string,
  globalThisMode: CompilerSecurityPolicy['globals']['globalThisMode'],
  freezeRealmPrototypes = false
): string {
  return `
    "use strict";
    ${buildSandboxHardeningLine(freezeRealmPrototypes)}
    ${buildGlobalThisShadowLine(globalThisMode)}
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
}

export function wrapCompiledCodeAsync(
  code: string,
  globalThisMode: CompilerSecurityPolicy['globals']['globalThisMode'],
  freezeRealmPrototypes = false
): string {
  return `
    "use strict";
    ${buildSandboxHardeningLine(freezeRealmPrototypes)}
    ${buildGlobalThisShadowLine(globalThisMode)}
    return (async () => {
      ${code}
      if (typeof __ejs !== "undefined" && __ejs.yourgui && typeof __ejs.yourgui.flush === "function") {
        __ejs.yourgui.flush();
      }
      return typeof __ejs !== "undefined" ? {
        pointerEvents: __ejs.pointerEvents,
        visualOutputs: __ejs.visualOutputs || [],
        registeredRoutes: (__ejs.registeredRoutes || []).map(r => ({ method: r.method, path: r.path }))
      } : { pointerEvents: [], visualOutputs: [], registeredRoutes: [] };
    })();
  `;
}



function createHardenedVmContext(
  vm: NodeVmModule,
  name: string,
  capturedConsole: Record<string, (...args: unknown[]) => void>,
  stdin: unknown[],
  ioHandler: Record<string, unknown>,
  policy: CompilerSecurityPolicy
): Record<string, unknown> {
  const boundedFetch = createPolicyBoundedFetch(policy.network);
  const context = vm.createContext(Object.create(null), {
    name,
    codeGeneration: { strings: false, wasm: false },
  });

  Object.defineProperty(context, '__ejs_host_bridge', {
    value: {
      log: capturedConsole.log,
      warn: capturedConsole.warn,
      error: capturedConsole.error,
      fetch: boundedFetch,
      stdin: [...stdin],
      io: ioHandler,
      globalThisMode: policy.globals.globalThisMode,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      atob: typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary'),
      btoa: typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64'),
      setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => setTimeout(fn, ms, ...args),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => setInterval(fn, ms, ...args),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      queueMicrotask: (fn: () => void) => queueMicrotask(fn),
    },
    configurable: true,
    writable: true,
    enumerable: false,
  });

  const bootstrap = `
    (() => {
      "use strict";
      const B = globalThis.__ejs_host_bridge;
      delete globalThis.__ejs_host_bridge;
      const __vmProxy = Proxy;
      const __blockedFn = function BlockedFunction() {
        throw new Error('SecurityError: Dynamic Function() construction is disabled inside the EasyJS sandbox');
      };
      const __blockedEval = function blockedEval() {
        throw new Error('SecurityError: eval() is disabled inside the EasyJS sandbox');
      };
      const makeStorage = () => {
        const m = new Map();
        return {
          get length() { return m.size; },
          clear() { m.clear(); },
          getItem(k) { return m.has(String(k)) ? m.get(String(k)) : null; },
          key(i) { return Array.from(m.keys())[i] ?? null; },
          removeItem(k) { m.delete(String(k)); },
          setItem(k, v) { m.set(String(k), String(v)); },
        };
      };
      const vmConsole = {
        log: (...a) => { B.log(...a); },
        warn: (...a) => { B.warn(...a); },
        error: (...a) => { B.error(...a); },
      };
      const vmFetch = async (input, init) => {
        const res = await B.fetch(input, init);
        return {
          ok: Boolean(res.ok),
          status: Number(res.status),
          statusText: String(res.statusText || ''),
          url: String(res.url || ''),
          redirected: Boolean(res.redirected),
          headers: {
            get: (k) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(String(k)) : null),
            has: (k) => (res.headers && typeof res.headers.has === 'function' ? res.headers.has(String(k)) : false),
          },
          text: async () => String(await res.text()),
          json: async () => JSON.parse(String(await res.text())),
        };
      };
      const vmIo = {
        sandboxed: true,
        onInput: B.io && typeof B.io.onInput === 'function' ? (p) => B.io.onInput(p) : undefined,
        onEcho: B.io && typeof B.io.onEcho === 'function' ? (p, v) => B.io.onEcho(p, v) : undefined,
        onAlert: B.io && typeof B.io.onAlert === 'function' ? (m) => B.io.onAlert(m) : undefined,
        onConfirm: B.io && typeof B.io.onConfirm === 'function' ? (m) => B.io.onConfirm(m) : undefined,
        onPrompt: B.io && typeof B.io.onPrompt === 'function' ? (m, d) => B.io.onPrompt(m, d) : undefined,
        onBrowser: B.io && typeof B.io.onBrowser === 'function' ? (u) => B.io.onBrowser(u) : undefined,
        onVisual: B.io && typeof B.io.onVisual === 'function' ? (item) => B.io.onVisual(item) : undefined,
        onServerStart: B.io && typeof B.io.onServerStart === 'function' ? (port, routes) => B.io.onServerStart(port, routes) : undefined,
        registerGuiDispatcher: B.io && typeof B.io.registerGuiDispatcher === 'function' ? (fn) => B.io.registerGuiDispatcher(fn) : undefined,
      };
      const safeLocation = Object.freeze({
        href: 'https://sandbox.easyjs.local/',
        pathname: '/',
        hostname: 'sandbox.easyjs.local',
        origin: 'https://sandbox.easyjs.local',
        protocol: 'https:',
        search: '',
        hash: '',
      });
      globalThis.console = vmConsole;
      globalThis.localStorage = makeStorage();
      globalThis.sessionStorage = makeStorage();
      globalThis.location = safeLocation;
      globalThis.fetch = vmFetch;
      globalThis.__ejs_fetch = vmFetch;
      globalThis.__ejs_Proxy = __vmProxy;
      globalThis.__ejs_stdin = Array.isArray(B.stdin) ? [...B.stdin] : [];
      globalThis.__ejs_io = vmIo;
      globalThis.__ejs_disabled_globalThis = new __vmProxy(Object.freeze({}), {
        get() { throw new Error("SecurityError: Access to 'globalThis' is disabled by security policy"); },
        set() { throw new Error("SecurityError: Access to 'globalThis' is disabled by security policy"); },
        has() { return false; },
      });
      globalThis.URL = function SafeURL(u, base) { return base !== undefined ? new B.URL(u, base) : new B.URL(u); };
      globalThis.URLSearchParams = function SafeURLSearchParams(init) { return new B.URLSearchParams(init); };
      globalThis.TextEncoder = function SafeTextEncoder() { return new B.TextEncoder(); };
      globalThis.TextDecoder = function SafeTextDecoder(label) { return new B.TextDecoder(label); };
      globalThis.atob = (s) => B.atob(String(s));
      globalThis.btoa = (s) => B.btoa(String(s));
      globalThis.setTimeout = (fn, ms, ...a) => {
        if (typeof fn !== 'function') throw new Error('SecurityError: setTimeout() only accepts a function callback inside the sandbox');
        return B.setTimeout(fn, ms, ...a);
      };
      globalThis.clearTimeout = (id) => B.clearTimeout(id);
      globalThis.setInterval = (fn, ms, ...a) => {
        if (typeof fn !== 'function') throw new Error('SecurityError: setInterval() only accepts a function callback inside the sandbox');
        return B.setInterval(fn, ms, ...a);
      };
      globalThis.clearInterval = (id) => B.clearInterval(id);
      globalThis.queueMicrotask = (fn) => B.queueMicrotask(fn);

      const blockedNames = [
        'Proxy', 'Reflect', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'WeakRef',
        'FinalizationRegistry', 'EventSource', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
        'window', 'document', 'self', 'top', 'parent', 'frames', 'opener', 'navigator',
        'history', 'indexedDB', 'cookieStore', 'XMLHttpRequest', 'WebSocket', 'Worker',
        'SharedWorker', 'ServiceWorker', 'importScripts', 'process', 'require', 'module',
        'exports', 'global', 'Buffer', 'Deno', 'Bun', 'AsyncFunction', 'GeneratorFunction',
        'AsyncGeneratorFunction', 'ActiveXObject', 'WScript'
      ];
      for (const n of blockedNames) {
        try {
          Object.defineProperty(globalThis, n, { value: undefined, writable: false, configurable: false });
        } catch {
          globalThis[n] = undefined;
        }
      }
      const NativeFnProto = Object.getPrototypeOf(() => {});
      const NativeAsyncFnProto = Object.getPrototypeOf(async () => {});
      const NativeGenProto = Object.getPrototypeOf(function* () {});
      const NativeAsyncGenProto = Object.getPrototypeOf(async function* () {});
      try {
        for (const p of [NativeFnProto, NativeAsyncFnProto, NativeGenProto, NativeAsyncGenProto]) {
          try {
            Object.defineProperty(p, 'constructor', { value: __blockedFn, writable: false, configurable: false });
          } catch {}
        }
        Object.defineProperty(globalThis, 'eval', { value: __blockedEval, writable: false, configurable: false });
        Object.defineProperty(globalThis, 'Function', { value: __blockedFn, writable: false, configurable: false });
        Object.preventExtensions(Object.prototype);
        Object.preventExtensions(Array.prototype);
        Object.preventExtensions(NativeFnProto);
        Object.preventExtensions(String.prototype);
        Object.preventExtensions(Number.prototype);
      } catch {}
    })();
  `;

  vm.runInContext(bootstrap, context, { timeout: 1000, filename: 'easyjs-vm-bootstrap.js' });
  return context;
}

export function runSyncInSandbox(
  code: string,
  options: ExecuteSyncOptions = {}
): ExecutionResult {
  const logs: string[] = [];
  const start = performance.now();
  const capturedConsole = createCapturedConsole(logs);
  const ioHandler = { sandboxed: true };
  const stdin = options.stdin ?? [];
  const policy = new SecurityPolicyManager(options.securityPolicy).policy;

  const vm = getNodeVm();
  if (vm) {
    try {
      const context = createHardenedVmContext(
        vm,
        'EasyJSSyncSandbox',
        capturedConsole,
        stdin,
        ioHandler,
        policy
      );
      const wrapped = `(() => {\n${wrapCompiledCodeSync(code, policy.globals.globalThisMode, false)}\n})()`;
      const meta = (vm.runInContext(wrapped, context, {
        timeout: DEFAULT_SYNC_TIMEOUT_MS,
        filename: 'easyjs-sandbox.js',
      }) ?? {}) as {
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
    }
  }

  // Fail closed when Node V8 vm is unavailable instead of ever falling back to new Function()
  const durationMs = Number((performance.now() - start).toFixed(2));
  return {
    logs,
    pointerEvents: [],
    durationMs,
    error:
      'SecurityError: Synchronous new Function() realm is disabled. Use runEasyJSAsync() (CSP-isolated iframe builder) or ASTInterpreter in browser environments.',
  };
}

let activeSandboxIframeCleanup: (() => void) | null = null;

export function disposeActiveBrowserSandbox(): void {
  if (activeSandboxIframeCleanup) {
    try {
      activeSandboxIframeCleanup();
    } catch {
      // Ignore cleanup errors
    }
    activeSandboxIframeCleanup = null;
  }
}

async function runInBrowserIframeSandbox(
  code: string,
  options: SandboxIoOptions,
  policy: CompilerSecurityPolicy
): Promise<ExecutionResult | null> {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof MessageChannel === 'undefined' ||
    !document.body
  ) {
    return null;
  }

  if (!options.ephemeral) {
    disposeActiveBrowserSandbox();
  }

  const token = 'ejs_sb_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.srcdoc = buildBrowserSandboxDocument({
    code,
    token,
    policy,
    stdin: options.stdin ?? [],
  });

  const start = performance.now();
  const logs: string[] = [];
  const channel = new MessageChannel();
  let disposed = false;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try {
      channel.port1.close();
    } catch {
      // ignore
    }
    try {
      iframe.remove();
    } catch {
      // ignore
    }
    if (activeSandboxIframeCleanup === cleanup) {
      activeSandboxIframeCleanup = null;
    }
  };

  if (!options.ephemeral) {
    activeSandboxIframeCleanup = cleanup;
  }

  if (options.signal) {
    if (options.signal.aborted) {
      cleanup();
      return { logs: [], pointerEvents: [], durationMs: 0, haltedByExit: true };
    }
    options.signal.addEventListener('abort', cleanup, { once: true });
  }

  return new Promise<ExecutionResult | null>((resolve) => {
    let handshakeResolved = false;

    const readyTimer = window.setTimeout(() => {
      if (!handshakeResolved) {
        window.removeEventListener('message', onWindowMessage);
        cleanup();
        resolve(null);
      }
    }, 800);

    const onWindowMessage = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const d = ev.data as { token?: string; type?: string } | null;
      if (!d || d.token !== token || d.type !== 'iframe_ready') return;

      window.removeEventListener('message', onWindowMessage);
      handshakeResolved = true;
      window.clearTimeout(readyTimer);

      iframe.contentWindow?.postMessage(
        { token, type: 'init_port' },
        '*',
        [channel.port2]
      );
    };

    channel.port1.onmessage = async (msgEvent: MessageEvent) => {
      const msg = msgEvent.data as Record<string, unknown> | null;
      if (!msg || msg.token !== token) return;

      if (msg.type === 'port_ready') {
        options.registerGuiDispatcher?.((elementId, eventType, payload) => {
          if (disposed) return;
          channel.port1.postMessage({
            token,
            type: 'gui_event',
            elementId,
            eventType,
            payload,
          });
        });

        channel.port1.postMessage({
          token,
          type: 'exec',
          stdin: options.stdin ?? [],
        });
        return;
      }

      if (msg.type === 'log') {
        const line = String(msg.line ?? '');
        logs.push(line);
        options.onLog?.(line);
        return;
      }

      if (msg.type === 'echo') {
        options.onEcho?.(String(msg.promptText ?? ''), String(msg.val ?? ''));
        return;
      }

      if (msg.type === 'browser') {
        options.onBrowser?.(String(msg.url ?? ''));
        return;
      }

      if (msg.type === 'visual') {
        options.onVisual?.(msg.item as VisualOutputItem);
        return;
      }

      if (msg.type === 'server_start') {
        options.onServerStart?.(
          Number(msg.portNum ?? 3000),
          (msg.routes as RegisteredRouteInfo[]) ?? []
        );
        return;
      }

      if (msg.type === 'io_req') {
        const reqId = msg.reqId;
        const kind = msg.kind;
        const payload = (msg.payload as Record<string, unknown>) ?? {};
        try {
          let result: unknown;
          if (kind === 'input') {
            result = options.onInput ? await options.onInput(String(payload.promptText ?? '')) : '';
          } else if (kind === 'alert') {
            result = options.onAlert ? await options.onAlert(String(payload.message ?? '')) : undefined;
          } else if (kind === 'confirm') {
            result = options.onConfirm ? await options.onConfirm(String(payload.message ?? '')) : false;
          } else if (kind === 'prompt') {
            result = options.onPrompt
              ? await options.onPrompt(
                  String(payload.message ?? ''),
                  payload.defaultValue !== undefined ? String(payload.defaultValue) : ''
                )
              : '';
          }
          if (!disposed) {
            channel.port1.postMessage({ token, type: 'io_res', reqId, result });
          }
        } catch (err) {
          if (!disposed) {
            channel.port1.postMessage({
              token,
              type: 'io_res',
              reqId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }

      if (msg.type === 'done') {
        const meta = (msg.meta as {
          pointerEvents?: PointerRuntimeEvent[];
          visualOutputs?: VisualOutputItem[];
          registeredRoutes?: RegisteredRouteInfo[];
        }) ?? {};
        const durationMs = Number((performance.now() - start).toFixed(2));
        const finalLogs = Array.isArray(msg.logs) ? (msg.logs as string[]) : logs;
        const keepAliveForGui = Boolean(
          msg.hasInteractiveGui && (meta.visualOutputs ?? []).some((v) => v.kind === 'yourgui')
        );
        if (!keepAliveForGui) {
          cleanup();
        }
        resolve({
          logs: finalLogs,
          pointerEvents: meta.pointerEvents ?? [],
          visualOutputs: meta.visualOutputs ?? [],
          registeredRoutes: meta.registeredRoutes ?? [],
          durationMs,
        });
        return;
      }

      if (msg.type === 'error') {
        const durationMs = Number((performance.now() - start).toFixed(2));
        const finalLogs = Array.isArray(msg.logs) ? (msg.logs as string[]) : logs;
        cleanup();
        if (msg.isExitSignal) {
          resolve({ logs: finalLogs, pointerEvents: [], durationMs, haltedByExit: true });
        } else {
          resolve({
            logs: finalLogs,
            pointerEvents: [],
            durationMs,
            error: String(msg.message ?? 'Sandbox runtime error'),
          });
        }
      }
    };

    channel.port1.start();
    window.addEventListener('message', onWindowMessage);
    document.body.appendChild(iframe);
  });
}

export async function runAsyncInSandbox(
  code: string,
  options: SandboxIoOptions = {}
): Promise<ExecutionResult> {
  const policy = new SecurityPolicyManager(options.securityPolicy).policy;

  // 1. Node.js isolated V8 VM context
  const vm = getNodeVm();
  if (vm) {
    const logs: string[] = [];
    const start = performance.now();
    const capturedConsole = createCapturedConsole(logs, options.onLog);
    const ioHandler: Record<string, unknown> = {
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
      const context = createHardenedVmContext(
        vm,
        'EasyJSAsyncSandbox',
        capturedConsole,
        options.stdin ?? [],
        ioHandler,
        policy
      );
      const wrapped = `(() => {\n${wrapCompiledCodeAsync(code, policy.globals.globalThisMode, false)}\n})()`;
      const promise = vm.runInContext(wrapped, context, {
        timeout: DEFAULT_SYNC_TIMEOUT_MS,
        filename: 'easyjs-async-sandbox.js',
      }) as Promise<Record<string, unknown>>;
      const meta = ((await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`SecurityError: Async sandbox execution timed out after ${DEFAULT_SYNC_TIMEOUT_MS}ms`));
        }, DEFAULT_SYNC_TIMEOUT_MS);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('SecurityError: Execution cancelled by user'));
        };
        if (options.signal) {
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
        Promise.resolve(promise).then(
          (val) => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            resolve(val);
          },
          (err) => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            reject(err);
          }
        );
      })) ?? {}) as {
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
    }
  }

  // 2. Real Browser Opaque-Origin CSP Iframe Sandbox (<iframe sandbox="allow-scripts">, zero new Function())
  const iframeResult = await runInBrowserIframeSandbox(code, options, policy);
  if (iframeResult) {
    return iframeResult;
  }

  // 3. Fail closed instead of ever calling new Function() or eval()
  return {
    logs: [],
    pointerEvents: [],
    durationMs: 0,
    error:
      'SecurityError: No isolated sandbox runtime (Node V8 VM or CSP-isolated iframe) is available. Unsafe new Function() fallback is disabled.',
  };
}
