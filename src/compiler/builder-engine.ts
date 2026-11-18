/**
 * EasyJS Sandbox Builder Engine
 *
 * Builds verified, lexically isolated execution units and CSP-enforced
 * browser sandbox documents WITHOUT using `new Function()`, `eval()`, or `with (...)`.
 */

import type { CompilerSecurityPolicy } from './security-policy.ts';

export const SANDBOX_SHADOWED_GLOBALS = [
  'window',
  'document',
  'self',
  'top',
  'parent',
  'frames',
  'opener',
  'navigator',
  'history',
  'indexedDB',
  'cookieStore',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'EventSource',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'importScripts',
  'Proxy',
  'Reflect',
  'WebAssembly',
  'SharedArrayBuffer',
  'Atomics',
  'WeakRef',
  'FinalizationRegistry',
  'AsyncFunction',
  'GeneratorFunction',
  'AsyncGeneratorFunction',
  'ActiveXObject',
  'WScript',
  'process',
  'require',
  'module',
  'exports',
  'global',
  'Buffer',
  'Deno',
  'Bun',
] as const;

export function escapeInlineScriptTag(code: string): string {
  // Prevent any compiled string/comment containing </script> or <!-- from closing the HTML <script> tag
  return code
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/<!--/g, '<\\!--');
}

export interface LexicalIsolationBuildOptions {
  code: string;
  globalThisMode: CompilerSecurityPolicy['globals']['globalThisMode'];
  asyncExecution?: boolean;
}

/**
 * Wraps compiled EasyJS code inside an explicit lexically shadowed strict unit.
 * Avoids `with (proxy)` and avoids `new Function()` / `eval()` completely.
 */
export function buildLexicallyIsolatedInvocation(
  options: LexicalIsolationBuildOptions
): string {
  const shadowedParams = SANDBOX_SHADOWED_GLOBALS.join(', ');

  const globalBindingLine =
    options.globalThisMode === 'disabled'
      ? `const globalThis = __env.__ejs_disabled_globalThis;`
      : options.globalThisMode === 'readonly'
        ? `const globalThis = __env.readonlyGlobalThis;`
        : `const globalThis = __env.sandboxGlobalThis;`;

  const execBody = `
    "use strict";
    ${options.code}
    if (typeof __ejs !== "undefined" && __ejs.yourgui && typeof __ejs.yourgui.flush === "function") {
      __ejs.yourgui.flush();
    }
    return typeof __ejs !== "undefined" ? {
      pointerEvents: __ejs.pointerEvents,
      visualOutputs: __ejs.visualOutputs || [],
      registeredRoutes: (__ejs.registeredRoutes || []).map(r => ({ method: r.method, path: r.path }))
    } : { pointerEvents: [], visualOutputs: [], registeredRoutes: [] };
  `;

  const bodyBlock =
    options.asyncExecution === false
      ? `return (() => {\n${execBody}\n})();`
      : `return (async () => {\n${execBody}\n})();`;

  return `((__env) => {
  "use strict";
  ${globalBindingLine}
  return ((
    ${shadowedParams},
    Function,
    fetch,
    __ejs_fetch,
    __ejs_Proxy,
    __ejs_stdin,
    __ejs_io,
    console,
    localStorage,
    sessionStorage,
    location,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    atob,
    btoa
  ) => {
    ${bodyBlock}
  })(
    ${SANDBOX_SHADOWED_GLOBALS.map(() => 'undefined').join(', ')},
    __env.Function,
    __env.fetch,
    __env.__ejs_fetch,
    __env.__ejs_Proxy,
    __env.__ejs_stdin,
    __env.__ejs_io,
    __env.console,
    __env.localStorage,
    __env.sessionStorage,
    __env.location,
    __env.setTimeout,
    __env.clearTimeout,
    __env.setInterval,
    __env.clearInterval,
    __env.queueMicrotask,
    __env.atob,
    __env.btoa
  );
})`;
}

export interface BrowserSandboxDocumentOptions {
  code: string;
  token: string;
  policy: CompilerSecurityPolicy;
  stdin: unknown[];
}

/**
 * Builds a complete CSP-hardened iframe srcdoc without `'unsafe-eval'`,
 * without `new Function()`, and without `with (...)`.
 */
export function buildBrowserSandboxDocument(
  options: BrowserSandboxDocumentOptions
): string {
  const tokenJson = JSON.stringify(options.token);
  const netPolicyJson = JSON.stringify(options.policy.network);
  const globalThisModeJson = JSON.stringify(options.policy.globals.globalThisMode);
  const stdinJson = escapeInlineScriptTag(JSON.stringify(options.stdin ?? []));

  const safeUnitSource = escapeInlineScriptTag(
    buildLexicallyIsolatedInvocation({
      code: options.code,
      globalThisMode: options.policy.globals.globalThisMode,
      asyncExecution: true,
    })
  );

  // Notice: CSP intentionally omits 'unsafe-eval' so browser C++/JS engines forbid eval() & Function() natively.
  const cspHeader =
    "default-src 'none'; script-src 'unsafe-inline'; connect-src https: http:; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${cspHeader}" />
</head>
<body>
<script>
(() => {
  "use strict";
  const TOKEN = ${tokenJson};
  const NET_POLICY = ${netPolicyJson};
  const GLOBALTHIS_MODE = ${globalThisModeJson};
  const INITIAL_STDIN = ${stdinJson};

  const nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
  const nativeSetTimeout = (fn, ms, ...args) => {
    if (typeof fn !== 'function') throw new Error('SecurityError: setTimeout() only accepts function callbacks');
    return setTimeout(fn, ms, ...args);
  };
  const nativeClearTimeout = (id) => clearTimeout(id);
  const nativeSetInterval = (fn, ms, ...args) => {
    if (typeof fn !== 'function') throw new Error('SecurityError: setInterval() only accepts function callbacks');
    return setInterval(fn, ms, ...args);
  };
  const nativeClearInterval = (id) => clearInterval(id);
  const nativeQueueMicrotask = (fn) => {
    if (typeof fn !== 'function') throw new Error('SecurityError: queueMicrotask() requires a function callback');
    queueMicrotask(fn);
  };
  const nativeAtob = (s) => atob(String(s));
  const nativeBtoa = (s) => btoa(String(s));
  const nativeProxy = Proxy;

  const __blockedCtor = function BlockedFunction() {
    throw new Error('SecurityError: Dynamic Function() construction is disabled inside the EasyJS sandbox');
  };
  const __blockedEval = function blockedEval() {
    throw new Error('SecurityError: eval() is disabled inside the EasyJS sandbox');
  };

  const NativeFunctionProto = Object.getPrototypeOf(() => {});
  const NativeAsyncFunctionProto = Object.getPrototypeOf(async () => {});
  const NativeGeneratorProto = Object.getPrototypeOf(function* () {});
  const NativeAsyncGeneratorProto = Object.getPrototypeOf(async function* () {});

  try {
    Object.defineProperty(window, 'Function', { value: __blockedCtor, writable: false, configurable: false });
    Object.defineProperty(window, 'eval', { value: __blockedEval, writable: false, configurable: false });
  } catch {}

  let activePort = null;
  let guiDispatcher = null;
  let compiledUnit = null;
  let reqSeq = 0;
  let fetchRequestCount = 0;
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

  const DANGEROUS_PORTS = new Set([20,21,22,23,25,53,69,110,111,135,137,138,139,143,389,445,465,587,636,993,995,1433,1521,2049,2375,2376,2379,2380,3306,3389,4001,5432,5900,6379,6443,8086,8500,9090,9100,9200,10250,10255,11211,27017,27018,50070]);
  const BLOCKED_HOSTS = new Set(['localhost','localhost.localdomain','ip6-localhost','ip6-loopback','metadata','metadata.google.internal','metadata.goog','instance-data','localtest.me','lvh.me','vcap.me']);
  const BLOCKED_SUFFIXES = ['.localhost','.local','.internal','.lan','.home','.corp','.intranet','.arpa','.localdomain','.nip.io','.sslip.io','.xip.io','.localtest.me','.lvh.me','.vcap.me'];
  const parseV4 = (ip) => {
    const m = ip.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
    if (!m) return null;
    let val = 0;
    for (let i = 1; i <= 4; i++) {
      if (m[i].length > 1 && m[i].startsWith('0')) return null;
      const o = Number(m[i]);
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
      val = ((val << 8) | o) >>> 0;
    }
    return val;
  };
  const isPrivateV4Int = (addr) => {
    const a = (addr >>> 24) & 0xff, b = (addr >>> 16) & 0xff, c = (addr >>> 8) & 0xff;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  };
  const isPrivateV6 = (raw) => {
    let ip = raw.trim().toLowerCase().replace(/^\\[|\\]$/g, '');
    if (!ip || ip.includes('%')) return true;
    const lc = ip.lastIndexOf(':');
    if (lc !== -1 && ip.slice(lc + 1).includes('.')) {
      const v4 = parseV4(ip.slice(lc + 1));
      if (v4 === null) return true;
      ip = ip.slice(0, lc + 1) + (((v4 >>> 16) & 0xffff).toString(16)) + ':' + ((v4 & 0xffff).toString(16));
    }
    const dbl = ip.split('::');
    if (dbl.length > 2) return true;
    const parseSide = (s) => {
      if (!s) return [];
      const gs = s.split(':');
      const out = [];
      for (const g of gs) {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
      return out;
    };
    let w;
    if (dbl.length === 1) {
      w = parseSide(dbl[0]);
      if (!w || w.length !== 8) return true;
    } else {
      const l = parseSide(dbl[0]), r = parseSide(dbl[1]);
      if (!l || !r || 8 - (l.length + r.length) < 1) return true;
      w = [...l, ...new Array(8 - (l.length + r.length)).fill(0), ...r];
    }
    const zp = (n) => { for (let i = 0; i < n; i++) if (w[i] !== 0) return false; return true; };
    if (zp(7) && (w[7] === 0 || w[7] === 1)) return true;
    if (zp(5) && w[5] === 0xffff) return isPrivateV4Int(((w[6] << 16) | w[7]) >>> 0);
    if (zp(6)) return isPrivateV4Int(((w[6] << 16) | w[7]) >>> 0);
    if (w[0] === 0x0064 && w[1] === 0xff9b && (w[2] === 0x0001 || (w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && isPrivateV4Int(((w[6] << 16) | w[7]) >>> 0)))) return true;
    if (w[0] === 0x2002 && isPrivateV4Int(((w[1] << 16) | w[2]) >>> 0)) return true;
    if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0x0db8)) return true;
    if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true;
    if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00) return true;
    return false;
  };
  const isPrivateHost = (hostname) => {
    const h = String(hostname || '').trim().toLowerCase().replace(/^\\[|\\]$/g, '').replace(/\\.+$/, '');
    if (!h || h.includes('%')) return true;
    if (BLOCKED_HOSTS.has(h) || BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
    if (/^\\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true;
    if (/^(?:0[0-7]+|0x[0-9a-f]+|\\d+)(?:\\.(?:0[0-7]+|0x[0-9a-f]+|\\d+)){0,3}$/i.test(h)) {
      const v4 = parseV4(h);
      return v4 === null || isPrivateV4Int(v4);
    }
    if (h.includes(':')) return isPrivateV6(h);
    return false;
  };

  const guardedFetch = async (input, init) => {
    if (!NET_POLICY.enabled) throw new Error('SecurityError: Network fetch() is disabled by security policy.');
    if (fetchRequestCount >= NET_POLICY.maxRequestsPerRun) {
      throw new Error('SecurityError: fetch() request limit (' + NET_POLICY.maxRequestsPerRun + ') exceeded.');
    }
    fetchRequestCount += 1;
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!rawUrl || rawUrl.length > NET_POLICY.maxUrlLength) {
      throw new Error('SecurityError: Invalid or oversized fetch URL.');
    }
    const parsed = new URL(rawUrl);
    if (!NET_POLICY.allowedProtocols.includes(parsed.protocol)) {
      throw new Error('SecurityError: Blocked fetch protocol ' + parsed.protocol);
    }
    if (parsed.username || parsed.password) {
      throw new Error('SecurityError: Embedded URL credentials are blocked by network security policy.');
    }
    if (NET_POLICY.blockPrivateNetworks && isPrivateHost(parsed.hostname)) {
      throw new Error('SecurityError: Access to local/private network host ' + parsed.hostname + ' is blocked.');
    }
    if (parsed.port && !NET_POLICY.allowDangerousPorts && DANGEROUS_PORTS.has(Number(parsed.port))) {
      throw new Error('SecurityError: Blocked restricted port ' + parsed.port + ' in fetch().');
    }
    const opts = init && typeof init === 'object' ? init : {};
    const method = typeof opts.method === 'string' ? opts.method.trim().toUpperCase() : 'GET';
    if (!NET_POLICY.allowedMethods.includes(method)) {
      throw new Error('SecurityError: HTTP method ' + method + ' is blocked by network policy.');
    }
    if ((NET_POLICY.blockCookies || !NET_POLICY.allowCredentials) && typeof opts.credentials === 'string' && opts.credentials.toLowerCase() !== 'omit') {
      throw new Error('SecurityError: fetch() credentials and cookies are blocked by security policy.');
    }
    const cleanHeaders = {};
    const blocked = new Set((NET_POLICY.blockedHeaders || []).map((h) => String(h).toLowerCase()));
    if (opts.headers && typeof opts.headers === 'object') {
      const entries = typeof opts.headers.entries === 'function' ? Array.from(opts.headers.entries()) : Object.entries(opts.headers);
      for (const pair of entries) {
        const k = String(pair[0] || '').trim();
        const kl = k.toLowerCase();
        if (blocked.has(kl) || kl.includes('cookie')) {
          throw new Error('SecurityError: Sensitive header ' + k + ' is blocked by security policy.');
        }
        cleanHeaders[k] = String(pair[1]);
      }
    }
    if (!nativeFetch) throw new Error('SandboxError: fetch unavailable');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller && NET_POLICY.timeoutMs > 0 ? setTimeout(() => controller.abort(), NET_POLICY.timeoutMs) : null;
    let res;
    try {
      res = await nativeFetch(parsed.toString(), {
        method,
        headers: cleanHeaders,
        credentials: 'omit',
        redirect: NET_POLICY.maxRedirects === 0 ? 'error' : 'manual',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        body: method !== 'GET' && method !== 'HEAD' ? opts.body : undefined,
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (NET_POLICY.maxRedirects === 0 && res.status >= 300 && res.status < 400) {
      throw new Error('SecurityError: HTTP redirect (' + res.status + ') blocked by SSRF policy.');
    }
    const safeHeaders = new Headers();
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((v, k) => {
        const l = k.toLowerCase();
        if (!blocked.has(l) && !l.includes('cookie')) safeHeaders.set(k, v);
      });
    }
    const maxBytes = NET_POLICY.maxResponseBytes || 524288;
    const readLimited = async () => {
      const txt = await res.text();
      if (new TextEncoder().encode(txt).byteLength > maxBytes) {
        throw new Error('SecurityError: Response size exceeds policy byte limit (' + maxBytes + ' bytes)');
      }
      return txt;
    };
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url || parsed.toString(),
      headers: safeHeaders,
      text: readLimited,
      json: async () => JSON.parse(await readLimited())
    };
  };

  Object.defineProperty(window, '__ejs_register_unit', {
    value: (fn) => { compiledUnit = fn; },
    configurable: true,
    writable: false,
    enumerable: false,
  });

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

        const readonlyGlobalThis = Object.freeze({
          Object, Array, String, Number, Boolean, Math, Date, JSON,
          console: capturedConsole,
          location: safeLocation,
          fetch: guardedFetch,
        });

        const sandboxGlobalThis = Object.create(null);
        Object.assign(sandboxGlobalThis, {
          Object, Array, String, Number, Boolean, Math, Date, JSON,
          console: capturedConsole,
          location: safeLocation,
          fetch: guardedFetch,
        });

        const disabledGlobalThis = new nativeProxy(Object.freeze({}), {
          get() { throw new Error("SecurityError: Access to 'globalThis' is disabled by security policy"); },
          set() { throw new Error("SecurityError: Access to 'globalThis' is disabled by security policy"); },
          has() { return false; }
        });

        const env = {
          eval: __blockedEval,
          Function: __blockedCtor,
          fetch: guardedFetch,
          __ejs_fetch: guardedFetch,
          __ejs_Proxy: nativeProxy,
          __ejs_stdin: Array.isArray(msg.stdin) ? msg.stdin : [...INITIAL_STDIN],
          __ejs_io: ioHandler,
          console: capturedConsole,
          localStorage: memoryStorage,
          sessionStorage: memoryStorage,
          location: safeLocation,
          setTimeout: nativeSetTimeout,
          clearTimeout: nativeClearTimeout,
          setInterval: nativeSetInterval,
          clearInterval: nativeClearInterval,
          queueMicrotask: nativeQueueMicrotask,
          atob: nativeAtob,
          btoa: nativeBtoa,
          __ejs_disabled_globalThis: disabledGlobalThis,
          readonlyGlobalThis,
          sandboxGlobalThis,
        };

        try {
          if (typeof compiledUnit !== 'function') {
            throw new Error('SandboxBuilderError: Pre-built isolated execution unit missing or failed syntax validation.');
          }
          try {
            for (const proto of [NativeFunctionProto, NativeAsyncFunctionProto, NativeGeneratorProto, NativeAsyncGeneratorProto]) {
              try {
                Object.defineProperty(proto, 'constructor', { value: __blockedCtor, writable: false, configurable: false });
              } catch {}
            }
            Object.defineProperty(window, 'fetch', { value: guardedFetch, writable: false, configurable: false });
            Object.defineProperty(window, 'Function', { value: __blockedCtor, writable: false, configurable: false });
            Object.defineProperty(window, 'eval', { value: __blockedEval, writable: false, configurable: false });
            Object.preventExtensions(Object.prototype);
            Object.preventExtensions(Array.prototype);
            Object.preventExtensions(NativeFunctionProto);
            Object.preventExtensions(String.prototype);
            Object.preventExtensions(Number.prototype);
          } catch {}

          const meta = (await compiledUnit(env)) || {};
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

  window.addEventListener('error', (ev) => {
    if (activePort) {
      activePort.postMessage({
        token: TOKEN,
        type: 'error',
        logs: [],
        message: ev.message || 'Sandbox script error',
      });
    }
  });
})();
</script>
<script>
(() => {
  "use strict";
  const reg = window.__ejs_register_unit;
  try { delete window.__ejs_register_unit; } catch {}
  if (typeof reg === 'function') {
    reg(${safeUnitSource});
  }
})();
</script>
<script>
(() => {
  "use strict";
  window.parent.postMessage({ token: ${tokenJson}, type: 'iframe_ready' }, '*');
})();
</script>
</body>
</html>`;
}

export class SandboxBuilderEngine {
  static buildLexicalUnit(options: LexicalIsolationBuildOptions): string {
    return buildLexicallyIsolatedInvocation(options);
  }

  static buildBrowserDocument(options: BrowserSandboxDocumentOptions): string {
    return buildBrowserSandboxDocument(options);
  }

  static escapeScriptTag(code: string): string {
    return escapeInlineScriptTag(code);
  }
}
