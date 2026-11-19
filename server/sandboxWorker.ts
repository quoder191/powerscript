import { runAsyncInSandbox } from '../src/compiler/sandbox.ts';
import type { PartialCompilerSecurityPolicy } from '../src/compiler/security-policy.ts';
import type { ExecutionResult } from '../src/compiler/utils/helpers.ts';

export const WORKER_RESULT_PREFIX = '__PS_WORKER_RESULT__:';

interface WorkerExecuteRequest {
  type: 'execute';
  code: string;
  stdin?: string[];
  securityPolicy?: PartialCompilerSecurityPolicy;
}

const MAX_WORKER_LIFETIME_MS = 6500;
const MAX_CODE_CHARS = 250_000;
const MAX_STDIN_PAYLOAD_BYTES = 512_000;
const MAX_LOG_LINES = 2000;
const MAX_LOG_LINE_CHARS = 4096;
const MAX_POINTER_EVENTS = 1000;
const MAX_VISUAL_OUTPUTS = 50;
const MAX_VISUAL_JSON_BYTES = 262_144;

const sendMessage =
  typeof process.send === 'function' ? process.send.bind(process) : null;

function clampExecutionResult(exec: ExecutionResult): ExecutionResult {
  const safeLogs = Array.isArray(exec.logs)
    ? exec.logs.slice(0, MAX_LOG_LINES).map((line) => {
        const str = String(line ?? '');
        return str.length > MAX_LOG_LINE_CHARS
          ? str.slice(0, MAX_LOG_LINE_CHARS) + '…(truncated)'
          : str;
      })
    : [];

  const safePointers = Array.isArray(exec.pointerEvents)
    ? exec.pointerEvents.slice(0, MAX_POINTER_EVENTS)
    : [];

  let safeVisuals = Array.isArray(exec.visualOutputs)
    ? exec.visualOutputs.slice(0, MAX_VISUAL_OUTPUTS)
    : undefined;

  if (safeVisuals) {
    try {
      const jsonSize = Buffer.byteLength(JSON.stringify(safeVisuals), 'utf8');
      if (jsonSize > MAX_VISUAL_JSON_BYTES) {
        safeVisuals = safeVisuals.slice(0, 1);
        if (Buffer.byteLength(JSON.stringify(safeVisuals), 'utf8') > MAX_VISUAL_JSON_BYTES) {
          safeVisuals = [];
        }
      }
    } catch {
      safeVisuals = [];
    }
  }

  return {
    ...exec,
    logs: safeLogs,
    pointerEvents: safePointers,
    visualOutputs: safeVisuals,
  };
}

let settled = false;
const finish = (payload: Record<string, unknown>, exitCode = 0): void => {
  if (settled) return;
  settled = true;
  clearTimeout(lifetimeWatchdog);
  if (sendMessage) {
    sendMessage(payload, () => {
      process.exit(exitCode);
    });
  } else {
    process.stdout.write(WORKER_RESULT_PREFIX + JSON.stringify(payload) + '\n', () => {
      process.exit(exitCode);
    });
  }
};

const lifetimeWatchdog = setTimeout(() => {
  finish(
    {
      ok: false,
      error: 'SecurityError: Isolated sandbox worker killed after 6500ms timeout',
    },
    1
  );
}, MAX_WORKER_LIFETIME_MS);
lifetimeWatchdog.unref();

process.on('uncaughtException', (err) => {
  finish(
    {
      ok: false,
      error: `SandboxWorkerError: ${err instanceof Error ? err.message : String(err)}`,
    },
    1
  );
});

process.on('unhandledRejection', (reason) => {
  finish(
    {
      ok: false,
      error: `SandboxWorkerError: ${reason instanceof Error ? reason.message : String(reason)}`,
    },
    1
  );
});

async function handleRequest(raw: unknown): Promise<void> {
  const msg = raw as WorkerExecuteRequest | null;
  if (
    !msg ||
    msg.type !== 'execute' ||
    typeof msg.code !== 'string' ||
    msg.code.length > MAX_CODE_CHARS
  ) {
    finish({ ok: false, error: 'Invalid or oversized sandbox worker request payload' }, 1);
    return;
  }

  try {
    const execution = await runAsyncInSandbox(msg.code, {
      stdin: Array.isArray(msg.stdin)
        ? msg.stdin.slice(0, 100).map((s) => String(s).slice(0, 2048))
        : [],
      securityPolicy: msg.securityPolicy,
    });
    finish({ ok: true, execution: clampExecutionResult(execution) }, 0);
  } catch (err) {
    finish(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      1
    );
  }
}

if (sendMessage) {
  process.on('message', (raw: unknown) => {
    void handleRequest(raw);
  });
} else {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  process.stdin.on('data', (chunk: Buffer) => {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_STDIN_PAYLOAD_BYTES) {
      finish({ ok: false, error: 'Sandbox worker input payload exceeded 512KB limit' }, 1);
      return;
    }
    chunks.push(chunk);
  });
  process.stdin.on('end', () => {
    if (settled) return;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      void handleRequest(parsed);
    } catch {
      finish({ ok: false, error: 'Malformed JSON payload passed to sandbox worker' }, 1);
    }
  });
  process.stdin.resume();
}
