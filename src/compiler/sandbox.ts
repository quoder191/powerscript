import type {
  ExecuteAsyncOptions,
  ExecuteSyncOptions,
  ExecutionResult,
  PointerRuntimeEvent,
  RegisteredRouteInfo,
  VisualOutputItem,
} from './utils/helpers.ts';

export interface SandboxIoOptions extends ExecuteAsyncOptions {
  signal?: AbortSignal;
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

function createMemoryStorageShim(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(String(key)) ? store.get(String(key))! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

function createGuardedFetch(): typeof fetch {
  const hostFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, 'https://sandbox.invalid');
    } catch {
      throw new Error(`SecurityError: Invalid fetch URL '${rawUrl}'`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`SecurityError: Blocked fetch protocol '${parsed.protocol}' in sandbox`);
    }
    if (!hostFetch) {
      throw new Error('SandboxError: Network fetch is unavailable in this environment');
    }
    return hostFetch(parsed.toString(), init);
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

function buildSafeSandboxScope(
  capturedConsole: Record<string, (...args: unknown[]) => void>,
  stdin: unknown[],
  ioHandler: Record<string, unknown>
): Record<string, unknown> {
  const memoryStorage = createMemoryStorageShim();
  const safeLocation = Object.freeze({
    href: 'https://sandbox.easyjs.local/',
    pathname: '/',
    hostname: 'sandbox.easyjs.local',
    origin: 'https://sandbox.easyjs.local',
    protocol: 'https:',
    search: '',
    hash: '',
  });

  const scope: Record<string, unknown> = {
    // Safe JS Standard Built-ins
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    JSON,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    EvalError,
    Symbol,
    BigInt,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Proxy,
    Reflect,
    Infinity,
    NaN,
    undefined,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    atob: typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: typeof crypto !== 'undefined' ? crypto : undefined,

    // Controlled sandbox I/O & isolated storage
    console: capturedConsole,
    __ejs_stdin: [...stdin],
    __ejs_io: ioHandler,
    localStorage: memoryStorage,
    sessionStorage: createMemoryStorageShim(),
    location: safeLocation,
    fetch: createGuardedFetch(),

    // Explicitly shadowed / blocked host globals
    window: undefined,
    document: undefined,
    self: undefined,
    top: undefined,
    parent: undefined,
    frames: undefined,
    opener: undefined,
    navigator: undefined,
    history: undefined,
    indexedDB: undefined,
    cookieStore: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    Worker: undefined,
    SharedWorker: undefined,
    ServiceWorker: undefined,
    importScripts: undefined,
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    global: undefined,
    Buffer: undefined,
    Deno: undefined,
    Bun: undefined,
    eval: () => {
      throw new Error('SecurityError: eval() is disabled inside the EasyJS sandbox');
    },
    Function: function BlockedFunction() {
      throw new Error('SecurityError: Dynamic Function() construction is disabled inside the EasyJS sandbox');
    },
  };

  scope.globalThis = scope;
  return scope;
}

function wrapCompiledCodeSync(code: string): string {
  return `
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
}

function wrapCompiledCodeAsync(code: string): string {
  return `
    "use strict";
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

function runWithProxyRealm<T>(
  wrappedBody: string,
  sandboxScope: Record<string, unknown>
): T {
  const blockedProp = (prop: PropertyKey) =>
    prop === '__proto__' || prop === 'constructor' || prop === 'prototype';

  const scopeProxy = new Proxy(sandboxScope, {
    has() {
      // Intercept ALL free variable lookups so nothing leaks to host window/globalThis
      return true;
    },
    get(target, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop];
      }
      return undefined;
    },
    set(target, prop, value) {
      if (blockedProp(prop)) return false;
      target[String(prop)] = value;
      return true;
    },
  });

  // Note: `with` lives outside `"use strict"` IIFE so strict mode rules still apply to EasyJS code.
  const executor = new Function(
    '__sandboxScope',
    `with (__sandboxScope) { return (function() { ${wrappedBody} }).call(undefined); }`
  );
  return executor(scopeProxy) as T;
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

  const vm = getNodeVm();
  if (vm) {
    try {
      const vmScope = buildSafeSandboxScope(capturedConsole, stdin, ioHandler);
      const context = vm.createContext(vmScope, {
        name: 'EasyJSSyncSandbox',
        codeGeneration: { strings: false, wasm: false },
      });
      const wrapped = `(() => {\n${wrapCompiledCodeSync(code)}\n})()`;
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

  // Browser / Edge fallback: Strict Proxy-isolated realm
  try {
    const scope = buildSafeSandboxScope(capturedConsole, stdin, ioHandler);
    const meta = (runWithProxyRealm<Record<string, unknown>>(
      wrapCompiledCodeSync(code),
      scope
    ) ?? {}) as {
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

function buildIframeSandboxSrcDoc(sandboxToken: string): string {
  const tokenJson = JSON.stringify(sandboxToken);
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script>
(() => {
  const TOKEN = ${tokenJson};
  let activePort = null;
  let guiDispatcher = null;
  let reqSeq = 0;
  const pendingIo = new Map();

  const sendIoRpc = (kind, payload) =>
    new Promise((resolve, reject) => {
      if (!activePort) {
        reject(new Error('Sandbox channel closed'));
        return;
      }
      const reqId = ++reqSeq;
      pendingIo.set(reqId, { resolve, reject });
      activePort.postMessage({ token: TOKEN, type: 'io_req', reqId, kind, payload });
    });

  const memoryStorage = (() => {
    const store = new Map();
    return {
      get length() { return store.size; },
      clear() { store.clear(); },
      getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
      key(i) { return Array.from(store.keys())[i] ?? null; },
      removeItem(k) { store.delete(String(k)); },
      setItem(k, v) { store.set(String(k), String(v)); },
    };
  })();

  const nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
  const guardedFetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
    const parsed = new URL(rawUrl, 'https://sandbox.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('SecurityError: Blocked fetch protocol ' + parsed.protocol);
    }
    if (!nativeFetch) throw new Error('SandboxError: fetch unavailable');
    return nativeFetch(parsed.toString(), init);
  };

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.token !== TOKEN || data.type !== 'init_port' || !event.ports || !event.ports[0]) {
      return;
    }
    activePort = event.ports[0];

    activePort.onmessage = async (msgEvent) => {
      const msg = msgEvent.data;
      if (!msg || msg.token !== TOKEN) return;

      if (msg.type === 'io_res') {
        const entry = pendingIo.get(msg.reqId);
        if (entry) {
          pendingIo.delete(msg.reqId);
          if (msg.error) entry.reject(new Error(msg.error));
          else entry.resolve(msg.result);
        }
        return;
      }

      if (msg.type === 'gui_event') {
        if (typeof guiDispatcher === 'function') {
          try {
            await guiDispatcher(msg.elementId, msg.eventType, msg.payload);
          } catch (err) {
            activePort.postMessage({
              token: TOKEN,
              type: 'log',
              line: '[error] ' + (err && err.message ? err.message : String(err))
            });
          }
        }
        return;
      }

      if (msg.type === 'exec') {
        const logs = [];
        const capturedConsole = {
          log: (...args) => {
            const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
            logs.push(line);
            activePort.postMessage({ token: TOKEN, type: 'log', line });
          },
          warn: (...args) => {
            const line = '[warn] ' + args.map((a) => String(a)).join(' ');
            logs.push(line);
            activePort.postMessage({ token: TOKEN, type: 'log', line });
          },
          error: (...args) => {
            const line = '[error] ' + args.map((a) => String(a)).join(' ');
            logs.push(line);
            activePort.postMessage({ token: TOKEN, type: 'log', line });
          },
        };

        const ioHandler = {
          sandboxed: true,
          onInput: (promptText) => sendIoRpc('input', { promptText }),
          onAlert: (message) => sendIoRpc('alert', { message }),
          onConfirm: (message) => sendIoRpc('confirm', { message }),
          onPrompt: (message, defaultValue) => sendIoRpc('prompt', { message, defaultValue }),
          onEcho: (promptText, val) => activePort.postMessage({ token: TOKEN, type: 'echo', promptText, val }),
          onBrowser: (url) => activePort.postMessage({ token: TOKEN, type: 'browser', url }),
          onVisual: (item) => activePort.postMessage({ token: TOKEN, type: 'visual', item }),
          onServerStart: (portNum, routes) => activePort.postMessage({ token: TOKEN, type: 'server_start', portNum, routes }),
          registerGuiDispatcher: (fn) => { guiDispatcher = fn; },
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

        const scope = {
          Object, Array, String, Number, Boolean, Math, Date, JSON, RegExp,
          Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError,
          SyntaxError, ReferenceError, URIError, EvalError, Symbol, BigInt,
          Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
          Int32Array, Uint32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
          Proxy, Reflect, Infinity, NaN, undefined,
          parseInt, parseFloat, isNaN, isFinite,
          encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
          atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
          queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder, crypto,
          console: capturedConsole,
          __ejs_stdin: Array.isArray(msg.stdin) ? msg.stdin : [],
          __ejs_io: ioHandler,
          localStorage: memoryStorage,
          sessionStorage: memoryStorage,
          location: safeLocation,
          fetch: guardedFetch,
          window: undefined,
          document: undefined,
          self: undefined,
          top: undefined,
          parent: undefined,
          frames: undefined,
          opener: undefined,
          navigator: undefined,
          history: undefined,
          indexedDB: undefined,
          cookieStore: undefined,
          XMLHttpRequest: undefined,
          WebSocket: undefined,
          Worker: undefined,
          SharedWorker: undefined,
          ServiceWorker: undefined,
          importScripts: undefined,
          eval: () => { throw new Error('SecurityError: eval() is disabled inside the EasyJS sandbox'); },
          Function: function BlockedFn() { throw new Error('SecurityError: Function() is disabled inside the EasyJS sandbox'); },
        };
        scope.globalThis = scope;

        const proxy = new Proxy(scope, {
          has() { return true; },
          get(target, prop) {
            if (prop === Symbol.unscopables) return undefined;
            if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, prop)) {
              return target[prop];
            }
            return undefined;
          },
          set(target, prop, value) {
            if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') return false;
            target[String(prop)] = value;
            return true;
          },
        });

        try {
          const runner = new Function('__s', 'with (__s) { return (function() { "use strict"; return (async () => { ' + msg.code + '\n if (typeof __ejs !== "undefined" && __ejs.yourgui && typeof __ejs.yourgui.flush === "function") { __ejs.yourgui.flush(); } return typeof __ejs !== "undefined" ? { pointerEvents: __ejs.pointerEvents, visualOutputs: __ejs.visualOutputs || [], registeredRoutes: (__ejs.registeredRoutes || []).map(r => ({ method: r.method, path: r.path })) } : { pointerEvents: [], visualOutputs: [], registeredRoutes: [] }; })(); }).call(undefined); }');
          const meta = (await runner(proxy)) || {};
          activePort.postMessage({
            token: TOKEN,
            type: 'done',
            logs,
            meta,
            hasInteractiveGui: typeof guiDispatcher === 'function',
          });
        } catch (err) {
          activePort.postMessage({
            token: TOKEN,
            type: 'error',
            logs,
            isExitSignal: Boolean(err && typeof err === 'object' && err.isExitSignal === true),
            message: err && err.message ? err.message : String(err),
          });
        }
      }
    };

    activePort.start();
    activePort.postMessage({ token: TOKEN, type: 'port_ready' });
  });

  window.parent.postMessage({ token: TOKEN, type: 'iframe_ready' }, '*');
})();
</script>
</body>
</html>`;
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
  options: SandboxIoOptions
): Promise<ExecutionResult | null> {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof MessageChannel === 'undefined' ||
    !document.body
  ) {
    return null;
  }

  disposeActiveBrowserSandbox();

  const token = 'ejs_sb_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.srcdoc = buildIframeSandboxSrcDoc(token);

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

  activeSandboxIframeCleanup = cleanup;

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
        resolve(null); // Fallback if headless DOM does not execute srcdoc scripts
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
          code,
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
      const vmScope = buildSafeSandboxScope(capturedConsole, options.stdin ?? [], ioHandler);
      const context = vm.createContext(vmScope, {
        name: 'EasyJSAsyncSandbox',
        codeGeneration: { strings: false, wasm: false },
      });
      const wrapped = `(() => {\n${wrapCompiledCodeAsync(code)}\n})()`;
      const promise = vm.runInContext(wrapped, context, {
        timeout: DEFAULT_SYNC_TIMEOUT_MS,
        filename: 'easyjs-async-sandbox.js',
      }) as Promise<Record<string, unknown>>;
      const meta = ((await promise) ?? {}) as {
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

  // 2. Real Browser Opaque-Origin Iframe Sandbox (<iframe sandbox="allow-scripts">)
  const iframeResult = await runInBrowserIframeSandbox(code, options);
  if (iframeResult) {
    return iframeResult;
  }

  // 3. Fallback Proxy-Isolated Realm Sandbox (e.g., headless DOM without iframe script execution)
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
    const scope = buildSafeSandboxScope(capturedConsole, options.stdin ?? [], ioHandler);
    const meta = ((await runWithProxyRealm<Promise<Record<string, unknown>>>(
      wrapCompiledCodeAsync(code),
      scope
    )) ?? {}) as {
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
