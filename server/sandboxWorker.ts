import { runAsyncInSandbox } from '../src/compiler/sandbox.ts';
import type { PartialCompilerSecurityPolicy } from '../src/compiler/security-policy.ts';

interface WorkerExecuteRequest {
  type: 'execute';
  code: string;
  stdin?: string[];
  securityPolicy?: PartialCompilerSecurityPolicy;
}

const MAX_WORKER_LIFETIME_MS = 6500;
const sendMessage =
  typeof process.send === 'function' ? process.send.bind(process) : null;

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
    process.stdout.write(JSON.stringify(payload) + '\n', () => {
      process.exit(exitCode);
    });
  }
};

const lifetimeWatchdog = setTimeout(() => {
  finish(
    {
      ok: false,
      error: 'SecurityError: Isolated sandbox worker exceeded maximum execution lifetime (6500ms)',
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

process.on('message', async (raw: unknown) => {
  const msg = raw as WorkerExecuteRequest | null;
  if (!msg || msg.type !== 'execute' || typeof msg.code !== 'string') {
    finish({ ok: false, error: 'Invalid sandbox worker request payload' }, 1);
    return;
  }

  try {
    const execution = await runAsyncInSandbox(msg.code, {
      stdin: Array.isArray(msg.stdin) ? msg.stdin.map((s) => String(s)) : [],
      securityPolicy: msg.securityPolicy,
    });
    finish({ ok: true, execution }, 0);
  } catch (err) {
    finish(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      1
    );
  }
});
