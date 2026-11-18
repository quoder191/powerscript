import 'dotenv/config';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
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

// Resource & DoS Exhaustion Caps
const MAX_SOURCE_CHARS = 100_000;
const MAX_SOURCE_LINES = 5000;
const MAX_STDIN_ITEMS = 100;
const MAX_STDIN_ITEM_CHARS = 2048;
const MAX_TOTAL_STDIN_CHARS = 16_384;
const MAX_WORKER_TIMEOUT_MS = 5500;
const MAX_STDERR_BYTES = 32_768;
const MAX_LOG_LINES = 2000;
const MAX_LOG_LINE_CHARS = 4096;
const MAX_POINTER_EVENTS = 1000;
const MAX_VISUAL_OUTPUTS = 50;

// Worker Pool Concurrency Caps
const MAX_CONCURRENT_WORKERS = 4;
const MAX_PENDING_QUEUE = 12;
const MAX_QUEUE_WAIT_MS = 3000;

// Per-IP Sliding-Window Rate Limiter Caps
const RATE_WINDOW_MS = 60_000;
const EXECUTE_MAX_REQ_PER_WINDOW = 30;
const COMPILE_MAX_REQ_PER_WINDOW = 120;
const MAX_RATE_BUCKET_ENTRIES = 5000;

function resolveTsxImportUrl(): string {
  const loaderPath = require.resolve('tsx');
  return pathToFileURL(loaderPath).href;
}

function clampFiniteInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function sanitizeDomainList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().toLowerCase().replace(/\.+$/, '');
    if (!trimmed || trimmed.length > 253 || /[\s/\\]/.test(trimmed)) continue;
    cleaned.push(trimmed);
    if (cleaned.length >= 50) break;
  }
  return cleaned;
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
      allowedDomains: sanitizeDomainList(raw?.network?.allowedDomains),
      blockedDomains: sanitizeDomainList(raw?.network?.blockedDomains),
      maxRedirects: 0,
      timeoutMs: clampFiniteInt(raw?.network?.timeoutMs, 5000, 250, 5000),
      maxResponseBytes: clampFiniteInt(raw?.network?.maxResponseBytes, 524288, 1024, 524288),
      maxRequestsPerRun: clampFiniteInt(raw?.network?.maxRequestsPerRun, 10, 0, 15),
      maxUrlLength: clampFiniteInt(raw?.network?.maxUrlLength, 2048, 64, 2048),
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

export class ServerExecutionCapacityError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = 'ServerExecutionCapacityError';
    this.statusCode = statusCode;
  }
}

interface QueuedWorkerSlot {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class WorkerConcurrencyPool {
  private activeCount = 0;
  private readonly queue: QueuedWorkerSlot[] = [];
  private readonly activeChildren = new Set<ChildProcess>();

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueueSize: number,
    private readonly maxQueueWaitMs: number
  ) {}

  getStats(): { activeWorkers: number; queuedJobs: number; maxConcurrent: number; maxQueueSize: number } {
    return {
      activeWorkers: this.activeCount,
      queuedJobs: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
    };
  }

  registerChild(child: ChildProcess): void {
    this.activeChildren.add(child);
    child.once('exit', () => {
      this.activeChildren.delete(child);
    });
  }

  killAllActive(): void {
    for (const child of this.activeChildren) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
    this.activeChildren.clear();
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new ServerExecutionCapacityError('Client disconnected before execution started', 499);
    }

    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new ServerExecutionCapacityError(
        `Server busy: maximum concurrent sandbox worker queue (${this.maxQueueSize}) is full.`,
        503
      );
    }

    await new Promise<void>((resolve, reject) => {
      const cleanupSlot = (slot: QueuedWorkerSlot) => {
        clearTimeout(slot.timer);
        if (slot.signal && slot.onAbort) {
          slot.signal.removeEventListener('abort', slot.onAbort);
        }
      };

      const slot: QueuedWorkerSlot = {
        resolve: () => {
          cleanupSlot(slot);
          resolve();
        },
        reject: (err: Error) => {
          cleanupSlot(slot);
          reject(err);
        },
        timer: setTimeout(() => {
          const idx = this.queue.indexOf(slot);
          if (idx !== -1) this.queue.splice(idx, 1);
          slot.reject(
            new ServerExecutionCapacityError(
              `Server busy: queued sandbox request timed out after ${this.maxQueueWaitMs}ms.`,
              503
            )
          );
        }, this.maxQueueWaitMs),
        signal,
      };

      if (signal) {
        slot.onAbort = () => {
          const idx = this.queue.indexOf(slot);
          if (idx !== -1) this.queue.splice(idx, 1);
          slot.reject(
            new ServerExecutionCapacityError('Client disconnected while waiting in queue.', 499)
          );
        };
        signal.addEventListener('abort', slot.onAbort, { once: true });
      }

      this.queue.push(slot);
    });

    this.activeCount += 1;
    return () => this.release();
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        next.resolve();
        break;
      }
    }
  }
}

class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number
  ) {}

  consume(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    if (this.buckets.size >= MAX_RATE_BUCKET_ENTRIES) {
      // Evict stale entries to keep rate limiter memory strictly bounded
      for (const [k, stamps] of this.buckets.entries()) {
        const fresh = stamps.filter((t) => t > cutoff);
        if (fresh.length === 0) this.buckets.delete(k);
        else this.buckets.set(k, fresh);
      }
      if (this.buckets.size >= MAX_RATE_BUCKET_ENTRIES) {
        this.buckets.clear();
      }
    }

    const existing = this.buckets.get(key) ?? [];
    const active = existing.filter((ts) => ts > cutoff);
    if (active.length >= this.maxRequests) {
      this.buckets.set(key, active);
      const oldest = active[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }

    active.push(now);
    this.buckets.set(key, active);
    return { allowed: true, retryAfterSec: 0 };
  }
}

const defaultWorkerPool = new WorkerConcurrencyPool(
  MAX_CONCURRENT_WORKERS,
  MAX_PENDING_QUEUE,
  MAX_QUEUE_WAIT_MS
);

function getClientKey(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const firstFwd = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0] : '';
  return (firstFwd?.trim() || req.ip || req.socket.remoteAddress || 'unknown').slice(0, 128);
}

function sanitizeStdinArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  let totalChars = 0;
  for (const item of raw.slice(0, MAX_STDIN_ITEMS)) {
    const str = String(item ?? '').slice(0, MAX_STDIN_ITEM_CHARS);
    if (totalChars + str.length > MAX_TOTAL_STDIN_CHARS) {
      break;
    }
    totalChars += str.length;
    out.push(str);
  }
  return out;
}

function sanitizeExecutionOutput(exec: ExecutionResult): ExecutionResult {
  const safeLogs = Array.isArray(exec.logs)
    ? exec.logs.slice(0, MAX_LOG_LINES).map((l) => {
        const s = String(l ?? '');
        return s.length > MAX_LOG_LINE_CHARS ? s.slice(0, MAX_LOG_LINE_CHARS) + '…(truncated)' : s;
      })
    : [];

  return {
    ...exec,
    logs: safeLogs,
    pointerEvents: Array.isArray(exec.pointerEvents)
      ? exec.pointerEvents.slice(0, MAX_POINTER_EVENTS)
      : [],
    visualOutputs: Array.isArray(exec.visualOutputs)
      ? exec.visualOutputs.slice(0, MAX_VISUAL_OUTPUTS)
      : exec.visualOutputs,
  };
}

export async function executeCompiledInWorker(
  compiledCode: string,
  stdin: string[] = [],
  securityPolicy: PartialCompilerSecurityPolicy = sanitizeServerSecurityPolicy(),
  signal?: AbortSignal,
  pool: WorkerConcurrencyPool = defaultWorkerPool
): Promise<WorkerExecutionOutcome> {
  const releaseSlot = await pool.acquire(signal);
  const start = performance.now();
  const tsxImportUrl = resolveTsxImportUrl();

  try {
    return await new Promise<WorkerExecutionOutcome>((resolve) => {
      let settled = false;
      let killedByTimeout = false;
      let stderrBytes = 0;
      let stderrText = '';

      const child = spawn(
        process.execPath,
        ['--max-old-space-size=64', '--no-addons', '--import', tsxImportUrl, WORKER_SCRIPT_PATH],
        {
          cwd: os.tmpdir(),
          env: {
            PATH: process.env.PATH ?? '',
          },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        }
      );

      pool.registerChild(child);

      const onAbort = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore
        }
        const durationMs = Number((performance.now() - start).toFixed(2));
        finalize({
          killedByTimeout: false,
          execution: {
            logs: [],
            pointerEvents: [],
            durationMs,
            haltedByExit: true,
            error: 'Execution cancelled: client disconnected.',
          },
        });
      };

      const finalize = (outcome: WorkerExecutionOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

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
          finalize({
            killedByTimeout: false,
            execution: sanitizeExecutionOutput(payload.execution),
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

      child.on('exit', (code, signalName) => {
        if (settled) return;
        const durationMs = Number((performance.now() - start).toFixed(2));
        const detail = stderrText.trim()
          ? stderrText.trim().slice(0, 400)
          : `process exited with code=${code ?? 'null'} signal=${signalName ?? 'none'}`;
        finalize({
          killedByTimeout: signalName === 'SIGKILL' || killedByTimeout,
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
  } finally {
    releaseSlot();
  }
}

export interface SandboxServerAppOptions {
  executeRateLimitPerMin?: number;
  compileRateLimitPerMin?: number;
  maxConcurrentWorkers?: number;
  maxPendingQueue?: number;
  maxQueueWaitMs?: number;
}

export function createSandboxServerApp(options: SandboxServerAppOptions = {}): Express {
  const app = express();
  const pool =
    options.maxConcurrentWorkers !== undefined ||
    options.maxPendingQueue !== undefined ||
    options.maxQueueWaitMs !== undefined
      ? new WorkerConcurrencyPool(
          options.maxConcurrentWorkers ?? MAX_CONCURRENT_WORKERS,
          options.maxPendingQueue ?? MAX_PENDING_QUEUE,
          options.maxQueueWaitMs ?? MAX_QUEUE_WAIT_MS
        )
      : defaultWorkerPool;

  const executeLimiter = new SlidingWindowRateLimiter(
    RATE_WINDOW_MS,
    options.executeRateLimitPerMin ?? EXECUTE_MAX_REQ_PER_WINDOW
  );
  const compileLimiter = new SlidingWindowRateLimiter(
    RATE_WINDOW_MS,
    options.compileRateLimitPerMin ?? COMPILE_MAX_REQ_PER_WINDOW
  );

  app.disable('x-powered-by');
  app.use(express.json({ limit: '160kb', strict: true }));

  // Cleanly handle malformed JSON bodies without leaking stack traces
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request payload exceeds 160KB limit.' });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    next(err);
  });

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
        ssrfProtection:
          'canonical IPv4/IPv6 CIDR validation + DNS pre-resolution with pinned socket IP + redirect blocking + blocked cookie/metadata headers',
        runtimeIsolation:
          'OS child process pool (stripped env, os.tmpdir cwd, 64MB heap cap, --no-addons, SIGKILL watchdog) + V8 vm context (codeGeneration strings/wasm disabled)',
      },
      limits: {
        maxSourceChars: MAX_SOURCE_CHARS,
        maxSourceLines: MAX_SOURCE_LINES,
        workerTimeoutMs: MAX_WORKER_TIMEOUT_MS,
        maxHeapMb: 64,
        maxLogLines: MAX_LOG_LINES,
        maxConcurrentWorkers: pool.getStats().maxConcurrent,
        maxPendingQueue: pool.getStats().maxQueueSize,
        executeRateLimitPerMin: options.executeRateLimitPerMin ?? EXECUTE_MAX_REQ_PER_WINDOW,
        compileRateLimitPerMin: options.compileRateLimitPerMin ?? COMPILE_MAX_REQ_PER_WINDOW,
      },
      pool: pool.getStats(),
    });
  });

  app.post('/api/compile', (req: Request, res: Response) => {
    const rate = compileLimiter.consume(getClientKey(req));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: 'Rate limit exceeded for /api/compile. Please retry shortly.',
      });
      return;
    }

    const body = req.body as {
      source?: unknown;
      interactiveAsync?: unknown;
      optimize?: unknown;
      securityPolicy?: PartialCompilerSecurityPolicy;
    } | null;

    if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.source.length > MAX_SOURCE_CHARS) {
      res.status(413).json({
        error: `Source code exceeds maximum size limit (${MAX_SOURCE_CHARS} characters).`,
      });
      return;
    }
    if (body.source.split('\n').length > MAX_SOURCE_LINES) {
      res.status(413).json({
        error: `Source code exceeds maximum line limit (${MAX_SOURCE_LINES} lines).`,
      });
      return;
    }

    const safePolicy = sanitizeServerSecurityPolicy(body.securityPolicy);
    let compiled;
    try {
      compiled = compileEasyJS(body.source, {
        interactiveAsync: Boolean(body.interactiveAsync ?? true),
        optimize: body.optimize === false ? false : undefined,
        securityPolicy: safePolicy,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        blocked: true,
        error: err instanceof Error ? err.message : 'Compilation failed due to resource budget limit.',
      });
      return;
    }

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
    const rate = executeLimiter.consume(getClientKey(req));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        success: false,
        blocked: true,
        error: 'Rate limit exceeded for /api/execute. Please retry shortly.',
      });
      return;
    }

    const body = req.body as {
      source?: unknown;
      stdin?: unknown;
      securityPolicy?: PartialCompilerSecurityPolicy;
    } | null;

    if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.source.length > MAX_SOURCE_CHARS) {
      res.status(413).json({
        error: `Source code exceeds maximum size limit (${MAX_SOURCE_CHARS} characters).`,
      });
      return;
    }
    if (body.source.split('\n').length > MAX_SOURCE_LINES) {
      res.status(413).json({
        error: `Source code exceeds maximum line limit (${MAX_SOURCE_LINES} lines).`,
      });
      return;
    }

    const stdin = sanitizeStdinArray(body.stdin);
    const safePolicy = sanitizeServerSecurityPolicy(body.securityPolicy);

    // Fail-closed compile & static security verification BEFORE spawning sandbox worker
    let compiled;
    try {
      compiled = compileEasyJS(body.source, {
        interactiveAsync: true,
        securityPolicy: safePolicy,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        blocked: true,
        error: err instanceof Error ? err.message : 'Compilation failed due to resource budget limit.',
      });
      return;
    }

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

    const abortController = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    res.on('close', onAbortCleanup);
    function onAbortCleanup() {
      onClose();
    }

    try {
      const outcome = await executeCompiledInWorker(
        compiled.code,
        stdin,
        safePolicy,
        abortController.signal,
        pool
      );
      if (res.writableEnded) return;

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
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof ServerExecutionCapacityError) {
        if (err.statusCode === 503) {
          res.setHeader('Retry-After', '2');
        }
        res.status(err.statusCode).json({
          success: false,
          blocked: true,
          error: err.message,
        });
        return;
      }
      res.status(500).json({
        success: false,
        blocked: true,
        error: err instanceof Error ? err.message : 'Unexpected sandbox execution error.',
      });
    } finally {
      res.removeListener('close', onAbortCleanup);
    }
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[EasyJS Sandbox Server] Listening on http://0.0.0.0:${PORT}`);
  });

  // Mitigate Slowloris / hanging socket exhaustion
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  const shutdown = () => {
    defaultWorkerPool.killAllActive();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  void startServer();
}
