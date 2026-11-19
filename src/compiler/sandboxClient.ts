import {
  compileEasyJS,
  runEasyJSAsync,
  type CompileResult,
  type RunResult,
} from './index.ts';
import type { ExecuteAsyncOptions, ExecutionResult } from './utils/helpers.ts';

interface CachedSession {
  token: string;
  expiresAt: number;
}

class ServerHttpRejectionError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServerHttpRejectionError';
    this.status = status;
    this.payload = payload;
  }
}

let cachedSession: CachedSession | null = null;
let pendingSessionFetch: Promise<string> | null = null;

async function fetchNewSessionToken(): Promise<string> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      // Ignore parse error
    }
    const msg =
      typeof payload.error === 'string'
        ? payload.error
        : `Session authentication rejected (HTTP ${res.status}).`;
    throw new ServerHttpRejectionError(res.status, msg, payload);
  }

  const data = (await res.json()) as { token?: unknown; expiresAt?: unknown };
  if (typeof data.token !== 'string' || !data.token) {
    throw new ServerHttpRejectionError(500, 'Invalid authentication session payload from server.');
  }

  const expiresAt =
    typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt)
      ? data.expiresAt
      : Date.now() + 60_000;

  cachedSession = { token: data.token, expiresAt };
  return data.token;
}

async function getSessionToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedSession && now < cachedSession.expiresAt - 30_000) {
    return cachedSession.token;
  }

  if (forceRefresh) {
    cachedSession = null;
  }

  if (!pendingSessionFetch) {
    pendingSessionFetch = fetchNewSessionToken().finally(() => {
      pendingSessionFetch = null;
    });
  }
  return pendingSessionFetch;
}

async function postJsonAuthenticated(
  url: string,
  body: Record<string, unknown>
): Promise<globalThis.Response> {
  let token = await getSessionToken(false);
  let res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    token = await getSessionToken(true);
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  return res;
}

function buildFailClosedRejectionResult(
  localCompiled: CompileResult,
  status: number,
  data: {
    blocked?: boolean;
    diagnostics?: CompileResult['diagnostics'];
    securityVerdict?: CompileResult['securityVerdict'];
    security?: CompileResult['security'];
    execution?: ExecutionResult;
    error?: string;
  }
): RunResult {
  const message =
    data.error ??
    (status === 401 || status === 403
      ? 'Server fail-closed security gate rejected execution.'
      : `Server sandbox rejected request (HTTP ${status}).`);

  return {
    ...localCompiled,
    success: false,
    code: '',
    diagnostics: data.diagnostics ?? localCompiled.diagnostics,
    securityVerdict: data.securityVerdict ?? {
      approved: false,
      analysisComplete: status !== 403 && status !== 401 ? localCompiled.securityVerdict.analysisComplete : false,
      blockedCount: Math.max(1, localCompiled.securityVerdict.blockedCount),
      blockedReasons: [message],
    },
    security: data.security ?? localCompiled.security,
    execution: data.execution ?? {
      logs: [],
      pointerEvents: [],
      durationMs: 0,
      error: message,
    },
  };
}

function requiresInteractiveClientHost(compiled: CompileResult, source: string, options: ExecuteAsyncOptions): boolean {
  const hasStdin = Array.isArray(options.stdin) && options.stdin.length > 0;
  if (hasStdin) return false;

  // Check if source uses YourGUI interactive DOM or interactive dialogs
  const usesInteractiveDialogs = /\b(alert|confirm|prompt|input)\s*\(/.test(source);
  const usesYourGui =
    /yourgui/.test(source) ||
    /\b(heading|button|section|input|select|checkbox|dom|row|column|style)\b/.test(source);

  if (usesInteractiveDialogs) return true;
  if (usesYourGui && compiled.code.includes('yourgui')) return true;
  return false;
}

export async function runEasyJSServerSandbox(
  source: string,
  options: ExecuteAsyncOptions = {}
): Promise<RunResult> {
  // Pre-compile locally so we always have full AST / token / sourceMap metadata for diagnostics UI
  const localCompiled = compileEasyJS(source, {
    interactiveAsync: true,
    securityPolicy: options.securityPolicy,
  });

  if (!localCompiled.success || !localCompiled.securityVerdict.approved) {
    return localCompiled;
  }

  // Interactive YourGUI & blocking popup dialogs require live client-iframe MessageChannel callbacks
  // after passing the mandatory server-side fail-closed compile & security gate.
  if (requiresInteractiveClientHost(localCompiled, source, options)) {
    try {
      const gateRes = await postJsonAuthenticated('/api/compile', {
        source,
        interactiveAsync: true,
        securityPolicy: options.securityPolicy,
      });

      if (!gateRes.ok) {
        let blocked: Record<string, unknown> = {};
        try {
          blocked = (await gateRes.json()) as Record<string, unknown>;
        } catch {
          // Ignore malformed error body
        }
        return buildFailClosedRejectionResult(localCompiled, gateRes.status, blocked as never);
      }
    } catch (err) {
      if (err instanceof ServerHttpRejectionError) {
        return buildFailClosedRejectionResult(localCompiled, err.status, {
          error: err.message,
        });
      }
      // Network connectivity failure (offline / local unit runner): fall back to hardened iframe sandbox
    }
    return runEasyJSAsync(source, options);
  }

  try {
    const res = await postJsonAuthenticated('/api/execute', {
      source,
      stdin: options.stdin ?? [],
      securityPolicy: options.securityPolicy,
    });

    const data = (await res.json()) as {
      success: boolean;
      blocked?: boolean;
      diagnostics?: CompileResult['diagnostics'];
      securityVerdict?: CompileResult['securityVerdict'];
      security?: CompileResult['security'];
      timings?: CompileResult['timings'];
      execution?: ExecutionResult;
      error?: string;
    };

    if (res.status === 401 || res.status === 403 || data.blocked) {
      return buildFailClosedRejectionResult(localCompiled, res.status, data);
    }

    if (!res.ok) {
      return {
        ...localCompiled,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs: 0,
          error: data.error ?? `Server sandbox error (HTTP ${res.status})`,
        },
      };
    }

    const execution: ExecutionResult = data.execution ?? {
      logs: [],
      pointerEvents: [],
      durationMs: 0,
    };

    for (const line of execution.logs) {
      options.onLog?.(line);
    }
    for (const vis of execution.visualOutputs ?? []) {
      options.onVisual?.(vis);
    }
    for (const route of execution.registeredRoutes ?? []) {
      options.onServerStart?.(3000, [route]);
    }

    return {
      ...localCompiled,
      timings: data.timings ?? localCompiled.timings,
      securityVerdict: data.securityVerdict ?? localCompiled.securityVerdict,
      execution,
    };
  } catch (err) {
    if (err instanceof ServerHttpRejectionError) {
      return buildFailClosedRejectionResult(localCompiled, err.status, {
        error: err.message,
      });
    }
    // Offline fallback: hardened browser iframe / VM sandbox
    return runEasyJSAsync(source, options);
  }
}
