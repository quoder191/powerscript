import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createSandboxServerApp,
  signSandboxSessionToken,
} from '../server.ts';
import { NetworkPolicyManager } from '../src/compiler/index.ts';
import { SecurityPolicyManager } from '../src/compiler/security-policy.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function withTestServer<T>(
  appOptions: Parameters<typeof createSandboxServerApp>[0],
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = createSandboxServerApp(appOptions);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function runServerAdversarialTests(): Promise<TestCaseResult[]> {
  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    {
      name: 'Fails closed (401) on unauthenticated /api/compile & /api/execute and redacts /api/sandbox/status',
      fn: async () => {
        await withTestServer({}, async (baseUrl) => {
          const compRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(compRes.status === 401, `Expected 401 on unauth /api/compile, got ${compRes.status}`);

          const execRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(execRes.status === 401, `Expected 401 on unauth /api/execute, got ${execRes.status}`);

          const statusRes = await fetch(`${baseUrl}/api/sandbox/status`);
          assertTrue(statusRes.status === 200, 'Expected 200 on status');
          const statusBody = (await statusRes.json()) as Record<string, unknown>;
          assertTrue(statusBody.authenticated === false, 'Expected authenticated: false');
          assertTrue(!('limits' in statusBody) && !('pool' in statusBody), 'Must redact internal limits/pool when unauthenticated');

          // Security headers verification
          assertTrue(statusRes.headers.get('x-content-type-options') === 'nosniff', 'Missing nosniff header');
          assertTrue(statusRes.headers.get('x-frame-options') === 'DENY', 'Missing DENY X-Frame-Options on API');
          assertTrue(statusRes.headers.get('referrer-policy') === 'no-referrer', 'Missing no-referrer header');
          assertTrue(Boolean(statusRes.headers.get('cache-control')?.includes('no-store')), 'Missing no-store header');
        });
      },
    },
    {
      name: 'Enforces CSRF Origin & Sec-Fetch-Site checks and validates token tampering, expiration, and RBAC scopes',
      fn: async () => {
        const secret = 'test-hmac-secret-key-for-verification';
        await withTestServer({ sessionSecret: secret, enforceIpBinding: false }, async (baseUrl) => {
          // Cross-site Origin check
          const crossOriginSession = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { Origin: 'https://attacker.evil' },
          });
          assertTrue(crossOriginSession.status === 403, `Expected 403 for cross-origin session, got ${crossOriginSession.status}`);

          // Sec-Fetch-Site cross-site check
          const secFetchCross = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Sec-Fetch-Site': 'cross-site',
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(secFetchCross.status === 403, `Expected 403 for Sec-Fetch-Site: cross-site, got ${secFetchCross.status}`);

          // Obtain genuine session token + cookie
          const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
          assertTrue(sessionRes.status === 200, 'Expected 200 from /api/auth/session');
          const sessionData = (await sessionRes.json()) as { token: string };
          assertTrue(Boolean(sessionRes.headers.get('set-cookie')?.includes('HttpOnly')), 'Session cookie must be HttpOnly');
          assertTrue(Boolean(sessionRes.headers.get('set-cookie')?.includes('SameSite=Strict')), 'Session cookie must be SameSite=Strict');

          // Tampered token rejected
          const tamperedRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionData.token}tampered`,
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(tamperedRes.status === 401, `Expected 401 on tampered token, got ${tamperedRes.status}`);

          // Compile-only scope cannot access /api/execute
          const compileOnly = signSandboxSessionToken({
            secret,
            scopes: ['compile'],
            ttlMs: 5000,
          });
          const scopeDeniedRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${compileOnly.token}`,
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(scopeDeniedRes.status === 403, `Expected 403 for missing execute scope, got ${scopeDeniedRes.status}`);

          // Expired token rejected
          const shortLived = signSandboxSessionToken({
            secret,
            scopes: ['compile', 'execute', 'status'],
            ttlMs: 50,
          });
          await new Promise((r) => setTimeout(r, 80));
          const expiredRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${shortLived.token}`,
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(expiredRes.status === 401, `Expected 401 for expired token, got ${expiredRes.status}`);

          // Authenticated status reveals internal configuration cleanly
          const authStatusRes = await fetch(`${baseUrl}/api/sandbox/status`, {
            headers: { Authorization: `Bearer ${sessionData.token}` },
          });
          const authStatus = (await authStatusRes.json()) as Record<string, unknown>;
          assertTrue(authStatus.authenticated === true && 'limits' in authStatus && 'pool' in authStatus, 'Authenticated status must include limits and pool');
        });
      },
    },
    {
      name: 'Validates API key authentication, malformed inputs, and rejects malicious code before worker spawn',
      fn: async () => {
        await withTestServer({ apiKey: 'ps-prod-key-999' }, async (baseUrl) => {
          const badKeyRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong' },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(badKeyRes.status === 401, 'Invalid API key must return 401');

          const badPolicyRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'ps-prod-key-999' },
            body: JSON.stringify({ source: 'print(1)', securityPolicy: [] }),
          });
          assertTrue(badPolicyRes.status === 400, 'Non-object securityPolicy must return 400');

          const badStdinRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'ps-prod-key-999' },
            body: JSON.stringify({ source: 'print(1)', stdin: [{ nested: true }] }),
          });
          assertTrue(badStdinRes.status === 400, 'Non-primitive stdin item must return 400');

          const hugeSourceRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'ps-prod-key-999' },
            body: JSON.stringify({ source: 'a'.repeat(100_005) }),
          });
          assertTrue(hugeSourceRes.status === 413, `Oversized source must return 413, got ${hugeSourceRes.status}`);

          const evilExecRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'ps-prod-key-999' },
            body: JSON.stringify({ source: 'import fs from "fs"\nprint(fs)' }),
          });
          assertTrue(evilExecRes.status === 403, `Host module import in /api/execute must fail closed 403, got ${evilExecRes.status}`);
        });
      },
    },
    {
      name: 'Enforces sliding-window rate limiting (429) and worker pool saturation (503)',
      fn: async () => {
        await withTestServer(
          { executeRateLimitPerMin: 2, maxConcurrentWorkers: 1, maxPendingQueue: 0 },
          async (baseUrl) => {
            const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
            const { token } = (await sessionRes.json()) as { token: string };

            // Launch 1 slow worker that takes 600ms, then fire 2nd concurrent execute -> expects 503
            const p1 = fetch(`${baseUrl}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ source: 'sleep(600)\nprint("done1")' }),
            });
            await new Promise((r) => setTimeout(r, 80));
            const r2 = await fetch(`${baseUrl}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ source: 'print("two")' }),
            });
            assertTrue(r2.status === 503, `Expected 503 worker pool saturation, got ${r2.status}`);
            assertTrue(r2.headers.get('retry-after') === '2', 'Expected Retry-After header on 503');

            const r1 = await p1;
            assertTrue(r1.status === 200, `Expected 200 for 1st worker, got ${r1.status}`);

            // 3rd execute exceeds rate limit of 2/min -> expects 429
            const r3 = await fetch(`${baseUrl}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ source: 'print("three")' }),
            });
            assertTrue(r3.status === 429, `Expected 429 rate limit exceeded, got ${r3.status}`);
            assertTrue(Boolean(r3.headers.get('retry-after')), 'Expected Retry-After header on 429');
          }
        );
      },
    },
    {
      name: 'Isolates OS worker process: executes valid code in /sandbox chroot and SIGKILL-terminates infinite loops',
      fn: async () => {
        await withTestServer({}, async (baseUrl) => {
          const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
          const { token } = (await sessionRes.json()) as { token: string };

          const validRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              source:
                'writeFile("out.txt", "safe")\nprint(readFile("/sandbox/out.txt"))\nprint(browserLocation().href)',
            }),
          });
          assertTrue(validRes.status === 200, `Expected 200 from valid OS worker execution, got ${validRes.status}`);
          const validJson = (await validRes.json()) as {
            success: boolean;
            execution: { logs: string[]; error?: string };
          };
          assertTrue(validJson.success, `Valid program failed: ${validJson.execution.error}`);
          assertTrue(
            validJson.execution.logs[0] === 'safe',
            `Expected /sandbox/out.txt chroot resolution to return "safe", got ${validJson.execution.logs[0]}`
          );
          assertTrue(
            validJson.execution.logs[1] === 'https://sandbox.easyjs.local/',
            `Expected isolated browserLocation inside worker, got ${validJson.execution.logs[1]}`
          );

          // Infinite loop aborted by V8 5000ms VM timeout inside worker (or OS SIGKILL watchdog at 5500ms)
          const loopRes = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ source: 'while true { }' }),
          });
          assertTrue(loopRes.status === 200, 'Expected clean timeout report envelope');
          const loopJson = (await loopRes.json()) as {
            success: boolean;
            killedByTimeout: boolean;
            execution: { error?: string };
          };
          assertTrue(
            !loopJson.success &&
              (loopJson.killedByTimeout || /timed out after \d+ms/i.test(loopJson.execution.error ?? '')),
            `Infinite loop must terminate cleanly via VM timeout or SIGKILL, got: ${JSON.stringify(loopJson)}`
          );
        });
      },
    },
    {
      name: 'Blocks live HTTP 302 SSRF redirect to AWS/GCP cloud metadata endpoint via DNS-pinned bounded fetch',
      fn: async () => {
        const redirectServer = http.createServer((_req, res) => {
          res.writeHead(302, {
            Location: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
          });
          res.end();
        });
        await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', () => resolve()));
        const { port } = redirectServer.address() as AddressInfo;
        try {
          const defaultNetPolicy = new SecurityPolicyManager().policy.network;
          const strictMgr = new NetworkPolicyManager(defaultNetPolicy);

          // 1. Default policy blocks direct localhost SSRF immediately
          let directErr = '';
          try {
            await strictMgr.executeBoundedFetch(globalThis.fetch, `http://127.0.0.1:${port}/redir`, {
              method: 'GET',
            });
          } catch (e) {
            directErr = e instanceof Error ? e.message : String(e);
          }
          assertTrue(
            /SecurityError/i.test(directErr),
            `Direct localhost redirect source must be blocked by SSRF policy, got: ${directErr}`
          );

          // 2. Even if an attacker reached an external server returning 302 -> metadata IP, redirect is blocked
          const redirectOnlyMgr = new NetworkPolicyManager({
            ...defaultNetPolicy,
            blockPrivateNetworks: false,
            maxRedirects: 0,
          });
          let redirErr = '';
          try {
            await redirectOnlyMgr.executeBoundedFetch(
              globalThis.fetch,
              `http://127.0.0.1:${port}/redir`,
              { method: 'GET' }
            );
          } catch (e) {
            redirErr = e instanceof Error ? e.message : String(e);
          }
          assertTrue(
            /SecurityError.*redirect/i.test(redirErr),
            `Expected HTTP 302 redirect to be blocked by SSRF policy, got: ${redirErr}`
          );
        } finally {
          await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
        }
      },
    },
  ];

  const results: TestCaseResult[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ suite: 'Server & OS Sandbox Security', name: t.name, passed: true });
    } catch (err) {
      results.push({
        suite: 'Server & OS Sandbox Security',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
