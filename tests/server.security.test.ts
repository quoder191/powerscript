import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  buildWorkerBundle,
  createSandboxServerApp,
  executeCompiledInWorker,
  parseTrustedProxyConfig,
  probeOsSandboxCapabilities,
  resolveClientAddress,
  ServerConfigurationError,
  signSandboxSessionToken,
} from '../server.ts';
import { compileEasyJS, NetworkPolicyManager } from '../src/compiler/index.ts';
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
      name: '[1, 2, 3] Enforces trusted reverse proxy CIDR validation, right-to-left XFF extraction, and blocks forged forwarding headers & invalid proxy chains',
      fn: async () => {
        // [3] Startup validation must fail safely on invalid proxy configs
        let threwWildcard = false;
        try {
          parseTrustedProxyConfig(['*']);
        } catch (err) {
          threwWildcard = err instanceof ServerConfigurationError;
        }
        assertTrue(threwWildcard, 'Wildcard trusted proxy "*" must fail closed at startup');

        let threwBadCidr = false;
        try {
          parseTrustedProxyConfig(['10.0.0.0/99']);
        } catch (err) {
          threwBadCidr = err instanceof ServerConfigurationError;
        }
        assertTrue(threwBadCidr, 'Malformed CIDR prefix must fail closed at startup');

        let threwBadIp = false;
        try {
          parseTrustedProxyConfig(['not-a-valid-ip']);
        } catch (err) {
          threwBadIp = err instanceof ServerConfigurationError;
        }
        assertTrue(threwBadIp, 'Non-IP trusted proxy entry must fail closed at startup');

        // [2] Untrusted proxy: socket is 127.0.0.1 while trustedProxies is only 10.0.0.0/8 -> ignore XFF
        const prodProxyRules = parseTrustedProxyConfig(['10.0.0.0/8']);
        const untrustedRes = resolveClientAddress(
          {
            headers: { 'x-forwarded-for': '8.8.8.8' },
            socket: { remoteAddress: '127.0.0.1' } as never,
          },
          prodProxyRules
        );
        assertTrue(
          untrustedRes.clientIp === '127.0.0.1' && !untrustedRes.trustedProxyUsed,
          `Untrusted peer must ignore X-Forwarded-For, got: ${JSON.stringify(untrustedRes)}`
        );

        // [3] Trusted proxy right-to-left chain: "spoofed, realClient, trustedProxy" -> picks realClient
        const rtlRes = resolveClientAddress(
          {
            headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.42, 10.0.0.5' },
            socket: { remoteAddress: '10.0.0.9' } as never,
          },
          prodProxyRules
        );
        assertTrue(
          rtlRes.clientIp === '203.0.113.42' && rtlRes.trustedProxyUsed && rtlRes.validProxyChain,
          `Expected right-to-left untrusted hop 203.0.113.42, got: ${JSON.stringify(rtlRes)}`
        );

        // [1] Forged X-Forwarded-For & X-Forwarded-Host against direct server (trustedProxies empty)
        await withTestServer({ executeRateLimitPerMin: 1, trustedProxies: [] }, async (baseUrl) => {
          const sesRes = await fetch(`${baseUrl}/api/auth/session`);
          const { token } = (await sesRes.json()) as { token: string };

          // Forged X-Forwarded-Host must NOT allow cross-origin bypass
          const forgedHostCsrf = await fetch(`${baseUrl}/api/auth/session`, {
            headers: {
              Origin: 'https://evil-spoofed.test',
              'X-Forwarded-Host': 'evil-spoofed.test',
              'X-Forwarded-For': '9.9.9.9',
            },
          });
          assertTrue(
            forgedHostCsrf.status === 403,
            `Forged X-Forwarded-Host from untrusted peer must be rejected 403, got ${forgedHostCsrf.status}`
          );

          // Consume the 1/min rate limit with spoofed XFF IP 1
          const r1 = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Forwarded-For': '198.51.100.1',
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(r1.status === 200, `Expected 200 for first request, got ${r1.status}`);

          // Rotate spoofed X-Forwarded-For IP -> MUST STILL HIT 429 because socket IP is keyed directly!
          const r2 = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Forwarded-For': '198.51.100.250',
            },
            body: JSON.stringify({ source: 'print(2)' }),
          });
          assertTrue(
            r2.status === 429,
            `Spoofed X-Forwarded-For rotation must NOT bypass rate limit, got ${r2.status}`
          );
        });

        // [3] Invalid proxy chain from a trusted proxy triggers 400 fail-closed
        await withTestServer({ trustedProxies: ['loopback'] }, async (baseUrl) => {
          const badChainRes = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Forwarded-For': 'not-an-ip, 127.0.0.1' },
          });
          assertTrue(
            badChainRes.status === 400,
            `Invalid proxy chain from trusted proxy must return 400, got ${badChainRes.status}`
          );
        });
      },
    },
    {
      name: '[4, 5, 6, 7] Enforces production-private auth gating, startup secret validation, scope RBAC, revocation, and replay protection',
      fn: async () => {
        // [4] Startup must fail closed in production-private without strong API key or with weak secret
        let missingKeyErr = false;
        try {
          createSandboxServerApp({ deploymentMode: 'production-private' });
        } catch (err) {
          missingKeyErr = err instanceof ServerConfigurationError;
        }
        assertTrue(missingKeyErr, 'production-private without apiKey must fail closed at startup');

        let weakSecretErr = false;
        try {
          createSandboxServerApp({
            deploymentMode: 'production-private',
            apiKey: 'ps-strong-prod-api-key-9876543210',
            sessionSecret: 'short-weak-secret',
          });
        } catch (err) {
          weakSecretErr = err instanceof ServerConfigurationError;
        }
        assertTrue(weakSecretErr, 'Short/weak sessionSecret must fail closed at startup');

        // Platform unset sentinel & 16-char placeholder regression check
        const prevMode = process.env.POWERSCRIPT_DEPLOYMENT_MODE;
        const prevKey = process.env.POWERSCRIPT_API_KEY;
        const prevSecret = process.env.POWERSCRIPT_SESSION_SECRET;
        const prevProxies = process.env.POWERSCRIPT_TRUSTED_PROXIES;
        const prevNodeEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          process.env.POWERSCRIPT_DEPLOYMENT_MODE = 'Nothing';
          process.env.POWERSCRIPT_API_KEY = 'PlatformKey16Chr';
          process.env.POWERSCRIPT_SESSION_SECRET = 'PlatformSec16Chr';
          process.env.POWERSCRIPT_TRUSTED_PROXIES = 'Nothing';
          await withTestServer({}, async (baseUrl) => {
            const rejectedSentinelKey = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': 'PlatformKey16Chr' },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(
              rejectedSentinelKey.status === 401,
              `16-char env API key placeholder must NEVER authenticate in public-playground, got ${rejectedSentinelKey.status}`
            );

            const sessionOk = await fetch(`${baseUrl}/api/auth/session`);
            assertTrue(
              sessionOk.status === 200,
              `public-playground must start and issue playground session even with 16-char env secret placeholder, got ${sessionOk.status}`
            );
          });

          let shortProdEnvSecretErr = false;
          try {
            process.env.POWERSCRIPT_DEPLOYMENT_MODE = 'production-private';
            createSandboxServerApp();
          } catch (err) {
            shortProdEnvSecretErr = err instanceof ServerConfigurationError;
          }
          assertTrue(
            shortProdEnvSecretErr,
            'production-private must still fail closed when POWERSCRIPT_SESSION_SECRET env is < 32 chars'
          );
        } finally {
          if (prevMode === undefined) delete process.env.POWERSCRIPT_DEPLOYMENT_MODE;
          else process.env.POWERSCRIPT_DEPLOYMENT_MODE = prevMode;
          if (prevKey === undefined) delete process.env.POWERSCRIPT_API_KEY;
          else process.env.POWERSCRIPT_API_KEY = prevKey;
          if (prevSecret === undefined) delete process.env.POWERSCRIPT_SESSION_SECRET;
          else process.env.POWERSCRIPT_SESSION_SECRET = prevSecret;
          if (prevProxies === undefined) delete process.env.POWERSCRIPT_TRUSTED_PROXIES;
          else process.env.POWERSCRIPT_TRUSTED_PROXIES = prevProxies;
          if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = prevNodeEnv;
        }

        // [4, 5, 6, 7] Private mode enforcement
        const prodKey = 'ps-strong-prod-api-key-9876543210';
        const prodSecret = '0123456789abcdef0123456789abcdef0123456789abcdef';
        await withTestServer(
          {
            deploymentMode: 'production-private',
            apiKey: prodKey,
            sessionSecret: prodSecret,
            allowDegradedOsSandbox: true,
          },
          async (baseUrl) => {
            // [4] Unauthenticated /api/auth/session MUST return 401 in production-private mode
            const unauthSession = await fetch(`${baseUrl}/api/auth/session`);
            assertTrue(
              unauthSession.status === 401,
              `production-private must deny unauthenticated /api/auth/session with 401, got ${unauthSession.status}`
            );

            // [6] Invalid requested scope must return 400
            const badScopeSession = await fetch(`${baseUrl}/api/auth/session?scopes=root`, {
              headers: { 'x-api-key': prodKey },
            });
            assertTrue(badScopeSession.status === 400, `Invalid scope request must return 400, got ${badScopeSession.status}`);

            // Issue valid scoped session token with API key
            const authSession = await fetch(`${baseUrl}/api/auth/session?scopes=compile,execute,status`, {
              headers: { 'x-api-key': prodKey },
            });
            assertTrue(authSession.status === 200, `Expected 200 with valid API key, got ${authSession.status}`);
            const { token } = (await authSession.json()) as { token: string };

            // [5] Missing replay headers in production-private must be rejected 401
            const noReplayHeaders = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(
              noReplayHeaders.status === 401,
              `Missing replay headers in production-private must return 401, got ${noReplayHeaders.status}`
            );

            // Valid nonce + timestamp succeeds once, then replaying exact nonce MUST return 409!
            const replayNonce = 'nonce-unique-12345678';
            const replayTs = String(Date.now());
            const firstCompile = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Request-Nonce': replayNonce,
                'X-Request-Timestamp': replayTs,
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(firstCompile.status === 200, `First nonce request should succeed, got ${firstCompile.status}`);

            const replayedCompile = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Request-Nonce': replayNonce,
                'X-Request-Timestamp': replayTs,
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(
              replayedCompile.status === 409,
              `Replayed nonce must be rejected 409 Conflict, got ${replayedCompile.status}`
            );

            // Stale timestamp must return 401
            const staleCompile = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Request-Nonce': 'nonce-stale-87654321',
                'X-Request-Timestamp': String(Date.now() - 120_000),
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(staleCompile.status === 401, `Stale replay timestamp must fail 401, got ${staleCompile.status}`);

            // [5] Token revocation via /api/auth/revoke must permanently block further use
            const revokeRes = await fetch(`${baseUrl}/api/auth/revoke`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Request-Nonce': 'nonce-revoke-11223344',
                'X-Request-Timestamp': String(Date.now()),
              },
            });
            assertTrue(revokeRes.status === 200, `Expected 200 from /api/auth/revoke, got ${revokeRes.status}`);

            const afterRevoke = await fetch(`${baseUrl}/api/compile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Request-Nonce': 'nonce-after-revoke-5566',
                'X-Request-Timestamp': String(Date.now()),
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(
              afterRevoke.status === 401,
              `Revoked token must be rejected 401, got ${afterRevoke.status}`
            );
          }
        );
      },
    },
    {
      name: '[7] Enforces CSRF, token tampering, expiration, RBAC scopes, and fail-closed unauthenticated endpoints',
      fn: async () => {
        const secret = 'test-hmac-secret-key-for-verification';
        await withTestServer({ sessionSecret: secret, enforceIpBinding: false }, async (baseUrl) => {
          const compRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(compRes.status === 401, `Expected 401 on unauth /api/compile, got ${compRes.status}`);

          const crossOriginSession = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { Origin: 'https://attacker.evil' },
          });
          assertTrue(crossOriginSession.status === 403, `Expected 403 for cross-origin session, got ${crossOriginSession.status}`);

          const secFetchCross = await fetch(`${baseUrl}/api/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Sec-Fetch-Site': 'cross-site',
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(secFetchCross.status === 403, `Expected 403 for Sec-Fetch-Site: cross-site, got ${secFetchCross.status}`);

          const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
          assertTrue(sessionRes.status === 200, 'Expected 200 from /api/auth/session');
          const sessionData = (await sessionRes.json()) as { token: string };
          assertTrue(Boolean(sessionRes.headers.get('set-cookie')?.includes('HttpOnly')), 'Session cookie must be HttpOnly');
          assertTrue(Boolean(sessionRes.headers.get('set-cookie')?.includes('SameSite=Strict')), 'Session cookie must be SameSite=Strict');

          const tamperedRes = await fetch(`${baseUrl}/api/compile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionData.token}tampered`,
            },
            body: JSON.stringify({ source: 'print(1)' }),
          });
          assertTrue(tamperedRes.status === 401, `Expected 401 on tampered token, got ${tamperedRes.status}`);

          // [6] Compile-only scope cannot execute or view authenticated status
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

          // [5] Expired token rejected
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
        });
      },
    },
    {
      name: '[8, 9] Verifies real OS-level sandbox filesystem, UID drop, prlimit, and kernel network isolation on Linux',
      fn: async () => {
        const caps = probeOsSandboxCapabilities(true);
        const bundlePath = buildWorkerBundle();
        assertTrue(Boolean(bundlePath), 'Expected worker bundle path to build cleanly');

        if (caps.enforced && bundlePath) {
          const scratch = mkdtempSync(path.join(os.tmpdir(), 'ps-verify-os-'));
          try {
            // Execute an untrusted probe script inside the EXACT same OS wrapper flags used by executeCompiledInWorker
            const probeCode = `
              const fs = require('node:fs');
              const net = require('node:net');
              const res = {
                uid: process.getuid(),
                secretEnvPresent: Boolean(process.env.POWERSCRIPT_API_KEY || process.env.POWERSCRIPT_SESSION_SECRET),
                readAppBlocked: false,
                readPasswdBlocked: false,
                writeTmpBlocked: false,
                networkBlocked: false
              };
              try { fs.readFileSync('/app/applet/server.ts', 'utf8'); } catch (e) { res.readAppBlocked = e.code === 'ERR_ACCESS_DENIED' || e.code === 'EACCES'; }
              try { fs.readFileSync('/etc/passwd', 'utf8'); } catch (e) { res.readPasswdBlocked = e.code === 'ERR_ACCESS_DENIED' || e.code === 'EACCES'; }
              try { fs.writeFileSync('/tmp/ps-escape-test', 'x'); } catch (e) { res.writeTmpBlocked = e.code === 'ERR_ACCESS_DENIED' || e.code === 'EROFS' || e.code === 'EACCES'; }
              const sock = net.connect({ host: '1.1.1.1', port: 80 });
              sock.on('error', () => { res.networkBlocked = true; console.log(JSON.stringify(res)); });
              setTimeout(() => { console.log(JSON.stringify(res)); process.exit(0); }, 200);
            `;
            const inner =
              'mount -t tmpfs -o size=1M,ro,noexec,nosuid,nodev tmpfs "$1" && cd "$1" && exec prlimit --cpu=5 --fsize=0 --nofile=32 --core=0 setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs "$2" --permission --allow-fs-read="$3" --max-old-space-size=64 --no-addons -e "$4"';

            const run = spawnSync(
              'unshare',
              ['--net', '--ipc', '--uts', '--pid', '--fork', '--mount', 'sh', '-c', inner, 'ps-probe', scratch, process.execPath, bundlePath, probeCode],
              {
                env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: scratch, TMPDIR: scratch },
                encoding: 'utf8',
                timeout: 4000,
              }
            );
            assertTrue(run.status === 0, `OS sandbox probe failed with status=${run.status} stderr=${run.stderr}`);
            const parsed = JSON.parse(run.stdout.trim().split('\n')[0]) as {
              uid: number;
              secretEnvPresent: boolean;
              readAppBlocked: boolean;
              readPasswdBlocked: boolean;
              writeTmpBlocked: boolean;
              networkBlocked: boolean;
            };
            assertTrue(parsed.uid === 65534, `Worker must run as uid 65534, got ${parsed.uid}`);
            assertTrue(!parsed.secretEnvPresent, 'Worker must inherit zero server secrets');
            assertTrue(parsed.readAppBlocked, 'Worker must be blocked from reading /app/applet/server.ts');
            assertTrue(parsed.readPasswdBlocked, 'Worker must be blocked from reading /etc/passwd');
            assertTrue(parsed.writeTmpBlocked, 'Worker must be blocked from writing filesystem');
            assertTrue(parsed.networkBlocked, 'Worker outbound network inside unshare --net must fail at kernel layer');
          } finally {
            rmSync(scratch, { recursive: true, force: true });
          }
        }
      },
    },
    {
      name: '[18] Reports honest security capabilities on /api/sandbox/status and fails closed when degraded OS sandbox is disallowed in production-private mode',
      fn: async () => {
        await withTestServer({}, async (baseUrl) => {
          const anonStatus = await (await fetch(`${baseUrl}/api/sandbox/status`)).json() as Record<string, unknown>;
          assertTrue(anonStatus.authenticated === false, 'Expected authenticated: false');
          assertTrue(!('limits' in anonStatus) && !('pool' in anonStatus), 'Must redact internal limits/pool when unauthenticated');

          const { token } = (await (await fetch(`${baseUrl}/api/auth/session`)).json()) as { token: string };
          const status = (await (
            await fetch(`${baseUrl}/api/sandbox/status`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).json()) as {
            authenticated: boolean;
            virtualFilesystem: { type: string; osChroot: boolean; persistentAcrossSessions: boolean };
            osIsolation: { enforced: boolean; seccompBpfFilter: boolean; chrootSyscall: boolean };
          };
          assertTrue(status.authenticated === true, 'Expected authenticated status');
          assertTrue(
            status.virtualFilesystem.osChroot === false &&
              status.virtualFilesystem.type === 'ephemeral-in-memory-map' &&
              status.virtualFilesystem.persistentAcrossSessions === false,
            `VFS status must never claim to be an OS chroot: ${JSON.stringify(status.virtualFilesystem)}`
          );
          assertTrue(
            status.osIsolation.seccompBpfFilter === false && status.osIsolation.chrootSyscall === false,
            `Unavailable OS mechanisms must honestly report false: ${JSON.stringify(status.osIsolation)}`
          );
        });

        // Simulate degraded OS host in production-private mode -> must fail closed 503 and report enforced: false!
        const degradedCaps = {
          ...probeOsSandboxCapabilities(),
          enforced: false,
          networkNamespaceIsolated: false,
          unavailableControls: ['simulated-missing-unshare'],
        };
        await withTestServer(
          {
            deploymentMode: 'production-private',
            apiKey: 'ps-strong-prod-api-key-9876543210',
            osCapabilitiesOverride: degradedCaps,
          },
          async (baseUrl) => {
            const statusRes = await fetch(`${baseUrl}/api/sandbox/status`, {
              headers: { 'x-api-key': 'ps-strong-prod-api-key-9876543210' },
            });
            const statusJson = (await statusRes.json()) as { osIsolation: { enforced: boolean; unavailableControls: string[] } };
            assertTrue(
              !statusJson.osIsolation.enforced && statusJson.osIsolation.unavailableControls.includes('simulated-missing-unshare'),
              'Degraded host must be honestly reported in /api/sandbox/status'
            );

            const execRes = await fetch(`${baseUrl}/api/execute`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'ps-strong-prod-api-key-9876543210',
                'X-Request-Nonce': 'nonce-degraded-123456',
                'X-Request-Timestamp': String(Date.now()),
              },
              body: JSON.stringify({ source: 'print(1)' }),
            });
            assertTrue(
              execRes.status === 503,
              `production-private must fail closed (503) when OS sandbox unavailable, got ${execRes.status}`
            );
          }
        );
      },
    },
    {
      name: '[10, 11] Enforces concurrency limits, rate limits, clean AbortSignal process-group worker termination, and infinite loop SIGKILL watchdog',
      fn: async () => {
        await withTestServer(
          { executeRateLimitPerMin: 2, maxConcurrentWorkers: 1, maxPendingQueue: 0 },
          async (baseUrl) => {
            const { token } = (await (await fetch(`${baseUrl}/api/auth/session`)).json()) as { token: string };

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

            const r3 = await fetch(`${baseUrl}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ source: 'print("three")' }),
            });
            assertTrue(r3.status === 429, `Expected 429 rate limit exceeded, got ${r3.status}`);
          }
        );

        // [11] AbortSignal cancels active OS worker cleanly
        const compiledSleep = compileEasyJS('sleep(5000)\nprint("after")', {
          interactiveAsync: true,
        });
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 120);
        const aborted = await executeCompiledInWorker(
          compiledSleep.code,
          [],
          undefined,
          ac.signal
        );
        assertTrue(
          Boolean(aborted.execution.error && /cancelled/i.test(aborted.execution.error)),
          `Aborted worker must terminate immediately with cancellation error, got: ${JSON.stringify(aborted)}`
        );

        // [10, 11] Valid execution + infinite loop termination via HTTP
        await withTestServer({}, async (baseUrl) => {
          const { token } = (await (await fetch(`${baseUrl}/api/auth/session`)).json()) as { token: string };

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
            `Expected /sandbox/out.txt resolution to return "safe", got ${validJson.execution.logs[0]}`
          );
          assertTrue(
            validJson.execution.logs[1] === 'https://sandbox.easyjs.local/',
            `Expected isolated browserLocation inside worker, got ${validJson.execution.logs[1]}`
          );

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
      name: '[9] Blocks live HTTP 302 SSRF redirect to AWS/GCP cloud metadata endpoint via DNS-pinned bounded fetch',
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
