import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compileEasyJS,
  DEFAULT_NETWORK_SECURITY_POLICY,
  type PartialCompilerSecurityPolicy,
  type ExecutionResult,
} from './src/compiler/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const WORKER_SCRIPT_PATH = path.resolve(__dirname, 'server', 'sandboxWorker.ts');
const DIST_DIR = path.resolve(__dirname, 'dist');
const PORT = Number(process.env.PORT ?? 3000);
const MAX_SOURCE_CHARS = 100_000;
const MAX_STDIN_ITEMS = 100;
const MAX_WORKER_TIMEOUT_MS = 5500;
const MAX_STDERR_BYTES = 32_768;
const MAX_LOG_LINES = 2000;

function resolveTsxImportUrl(): string {
  const loaderPath = require.resolve('tsx');
  return pathToFileURL(loaderPath).href;
}

export function sanitizeServerSecurityPolicy(
  raw?: PartialCompilerSecurityPolicy
): PartialCompilerSecurityPolicy {
  const requestedGlobalMode = raw?.globals?.globalThisMode;
  const safeGlobalMode =
    requestedGlobalMode === 'readonly' || requestedGlobalMode === 'disabled'
      ? requestedGlobalMode
      : 'disabled';

  const netEnabled = raw?.network?.enabled !== false;

  return {
    ownership: {
      forbidUseAfterMove: true,
      forbidUseAfterDrop: true,
      forbidMoveWhileBorrowed: true,
      forbidDropWhileBorrowed: true,
      forbidDanglingReferences: true,
      forbidMutableBorrowAliasing: true,
      forbidDirectMutationDuringMutableBorrow: true,
    },
    globals: {
      globalThisMode: safeGlobalMode,
      forbidHostEscapeGlobals: true,
      forbidPrototypeAccess: true,
      forbidDynamicEval: true,
    },
    network: {
      enabled: netEnabled,
      allowedProtocols: ['http:', 'https:'],
      allowedMethods: ['GET', 'HEAD'],
      blockCookies: true,
      allowCredentials: false,
      blockPrivateNetworks: true,
      allowDangerousPorts: false,
      blockedHeaders: [...DEFAULT_NETWORK_SECURITY_POLICY.blockedHeaders],
      maxRedirects: 0,
      timeoutMs: Math.min(raw?.network?.timeoutMs ?? 5000, 5000),
      maxResponseBytes: Math.min(raw?.network?.maxResponseBytes ?? 524288, 524288),
      maxRequestsPerRun: Math.min(raw?.network?.maxRequestsPerRun ?? 10, 15),
      maxUrlLength: Math.min(raw?.network?.maxUrlLength ?? 2048, 2048),
    },
    typeSafety: {
      enabled: true,
      strictNullChecks: true,
      checkFunctionCalls: true,
      checkReturnTypes: true,
      checkControlFlow: true,
      checkMemberVisibility: true,
    },
  };
}

export interface WorkerExecutionOutcome {
  execution: ExecutionResult;
  killedByTimeout: boolean;
}

export function executeCompiledInWorker(
  compiledCode: string,
  stdin: string[] = [],
  securityPolicy: PartialCompilerSecurityPolicy = sanitizeServerSecurityPolicy()
): Promise<WorkerExecutionOutcome> {
  const start = performance.now();
  const tsxImportUrl = resolveTsxImportUrl();

  return new Promise<WorkerExecutionOutcome>((resolve) => {
    let settled = false;
    let killedByTimeout = false;
    let stderrBytes = 0;
    let stderrText = '';

    const child = spawn(
      process.execPath,
      ['--max-old-space-size=64', '--import', tsxImportUrl, WORKER_SCRIPT_PATH],
      {
        cwd: os.tmpdir(),
        env: {
          PATH: process.env.PATH ?? '',
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }
    );

    const finalize = (outcome: WorkerExecutionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(outcome);
    };

    const killTimer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore if already exited
      }
      const durationMs = Number((performance.now() - start).toFixed(2));
      finalize({
        killedByTimeout: true,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs,
          error: `SecurityError: Isolated sandbox worker killed after ${MAX_WORKER_TIMEOUT_MS}ms timeout`,
        },
      });
    }, MAX_WORKER_TIMEOUT_MS);

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const slice = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes);
      stderrBytes += slice.byteLength;
      stderrText += slice.toString('utf8');
    });

    child.on('message', (msg: unknown) => {
      const payload = msg as { ok?: boolean; execution?: ExecutionResult; error?: string } | null;
      if (!payload) return;
      if (payload.ok && payload.execution) {
        const exec = payload.execution;
        const safeLogs = Array.isArray(exec.logs) ? exec.logs.slice(0, MAX_LOG_LINES) : [];
        finalize({
          killedByTimeout: false,
          execution: {
            ...exec,
            logs: safeLogs,
          },
        });
        return;
      }

      const durationMs = Number((performance.now() - start).toFixed(2));
      finalize({
        killedByTimeout: false,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs,
          error: payload.error || 'Sandbox worker failed to execute program',
        },
      });
    });

    child.on('error', (err) => {
      const durationMs = Number((performance.now() - start).toFixed(2));
      finalize({
        killedByTimeout: false,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs,
          error: `SandboxProcessError: ${err.message}`,
        },
      });
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      const durationMs = Number((performance.now() - start).toFixed(2));
      const detail = stderrText.trim()
        ? stderrText.trim().slice(0, 400)
        : `process exited with code=${code ?? 'null'} signal=${signal ?? 'none'}`;
      finalize({
        killedByTimeout: signal === 'SIGKILL' || killedByTimeout,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs,
          error: `SecurityError: Sandbox worker terminated unexpectedly (${detail})`,
        },
      });
    });

    child.send({
      type: 'execute',
      code: compiledCode,
      stdin,
      securityPolicy,
    });
  });
}

export function createSandboxServerApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '160kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/sandbox/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      mode: 'fail-closed',
      layers: {
        staticAnalyzer: 'fail-closed (SEC000 on incomplete analysis)',
        capabilityManager: 'strict prototype, eval, host-global, and computed-gadget blocking',
        borrowAndTypeSafety: 'ownership + borrow checker + strict static type checker',
        runtimeIsolation: 'OS child process (stripped env, os.tmpdir cwd, 64MB heap cap, SIGKILL watchdog) + V8 vm context (codeGeneration strings/wasm disabled)',
      },
      limits: {
        maxSourceChars: MAX_SOURCE_CHARS,
        workerTimeoutMs: MAX_WORKER_TIMEOUT_MS,
        maxHeapMb: 64,
        maxLogLines: MAX_LOG_LINES,
      },
    });
  });

  app.post('/api/compile', (req: Request, res: Response) => {
    const body = req.body as {
      source?: unknown;
      interactiveAsync?: unknown;
      optimize?: unknown;
      securityPolicy?: PartialCompilerSecurityPolicy;
    } | null;

    if (!body || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.source.length > MAX_SOURCE_CHARS) {
      res.status(413).json({
        error: `Source code exceeds maximum size limit (${MAX_SOURCE_CHARS} characters).`,
      });
      return;
    }

    const safePolicy = sanitizeServerSecurityPolicy(body.securityPolicy);
    const compiled = compileEasyJS(body.source, {
      interactiveAsync: Boolean(body.interactiveAsync ?? true),
      optimize: body.optimize === false ? false : undefined,
      securityPolicy: safePolicy,
    });

    res.status(compiled.securityVerdict.approved ? 200 : 403).json({
      success: compiled.success,
      blocked: !compiled.securityVerdict.approved,
      code: compiled.code,
      diagnostics: compiled.diagnostics,
      securityVerdict: compiled.securityVerdict,
      security: compiled.security,
      symbols: compiled.symbols,
      pointers: compiled.pointers,
      asyncFunctions: compiled.asyncFunctions,
      topLevelAsync: compiled.topLevelAsync,
      optimization: compiled.optimization,
      incremental: compiled.incremental,
      timings: compiled.timings,
    });
  });

  app.post('/api/execute', async (req: Request, res: Response) => {
    const body = req.body as {
      source?: unknown;
      stdin?: unknown;
      securityPolicy?: PartialCompilerSecurityPolicy;
    } | null;

    if (!body || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.source.length > MAX_SOURCE_CHARS) {
      res.status(413).json({
        error: `Source code exceeds maximum size limit (${MAX_SOURCE_CHARS} characters).`,
      });
      return;
    }

    const stdin = Array.isArray(body.stdin)
      ? body.stdin.slice(0, MAX_STDIN_ITEMS).map((item) => String(item ?? ''))
      : [];

    const safePolicy = sanitizeServerSecurityPolicy(body.securityPolicy);

    // Fail-closed compile & static security verification BEFORE spawning sandbox worker
    const compiled = compileEasyJS(body.source, {
      interactiveAsync: true,
      securityPolicy: safePolicy,
    });

    if (
      !compiled.success ||
      !compiled.securityVerdict.approved ||
      !compiled.securityVerdict.analysisComplete ||
      !compiled.code
    ) {
      res.status(403).json({
        success: false,
        blocked: true,
        diagnostics: compiled.diagnostics,
        securityVerdict: compiled.securityVerdict,
        security: compiled.security,
        symbols: compiled.symbols,
        pointers: compiled.pointers,
        timings: compiled.timings,
        execution: {
          logs: [],
          pointerEvents: [],
          durationMs: 0,
          error:
            compiled.securityVerdict.blockedReasons[0] ??
            'SecurityError: Compilation and security analysis failed (fail-closed rejection).',
        } satisfies ExecutionResult,
      });
      return;
    }

    const outcome = await executeCompiledInWorker(compiled.code, stdin, safePolicy);

    res.status(200).json({
      success: !outcome.execution.error,
      blocked: false,
      killedByTimeout: outcome.killedByTimeout,
      diagnostics: compiled.diagnostics,
      securityVerdict: compiled.securityVerdict,
      security: compiled.security,
      symbols: compiled.symbols,
      pointers: compiled.pointers,
      asyncFunctions: compiled.asyncFunctions,
      topLevelAsync: compiled.topLevelAsync,
      optimization: compiled.optimization,
      incremental: compiled.incremental,
      timings: compiled.timings,
      execution: outcome.execution,
    });
  });

  return app;
}

async function startServer(): Promise<void> {
  const app = createSandboxServerApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[EasyJS Sandbox Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  void startServer();
}
