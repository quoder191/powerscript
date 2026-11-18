import {
  compileEasyJS,
  runEasyJSAsync,
  type CompileResult,
  type RunResult,
} from './index.ts';
import type { ExecuteAsyncOptions, ExecutionResult } from './utils/helpers.ts';

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
      const gateRes = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          interactiveAsync: true,
          securityPolicy: options.securityPolicy,
        }),
      });
      if (gateRes.status === 403) {
        const blocked = (await gateRes.json()) as {
          diagnostics?: CompileResult['diagnostics'];
          securityVerdict?: CompileResult['securityVerdict'];
          security?: CompileResult['security'];
        };
        return {
          ...localCompiled,
          success: false,
          code: '',
          diagnostics: blocked.diagnostics ?? localCompiled.diagnostics,
          securityVerdict: blocked.securityVerdict ?? {
            approved: false,
            analysisComplete: false,
            blockedCount: 1,
            blockedReasons: ['Server fail-closed security gate rejected execution.'],
          },
          security: blocked.security ?? localCompiled.security,
        };
      }
    } catch {
      // If server endpoint is unreachable (e.g. offline test), still run inside hardened browser iframe sandbox
    }
    return runEasyJSAsync(source, options);
  }

  try {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        stdin: options.stdin ?? [],
        securityPolicy: options.securityPolicy,
      }),
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

    if (res.status === 403 || data.blocked) {
      return {
        ...localCompiled,
        success: false,
        code: '',
        diagnostics: data.diagnostics ?? localCompiled.diagnostics,
        securityVerdict: data.securityVerdict ?? {
          approved: false,
          analysisComplete: false,
          blockedCount: 1,
          blockedReasons: [data.error ?? 'Blocked by server security gate'],
        },
        security: data.security ?? localCompiled.security,
        execution: data.execution,
      };
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
  } catch {
    // Offline fallback: hardened browser iframe / VM sandbox
    return runEasyJSAsync(source, options);
  }
}
