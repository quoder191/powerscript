import 'dotenv/config';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
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
const WORKER_RESULT_PREFIX = '__PS_WORKER_RESULT__:';
const DIST_DIR = path.resolve(__dirname, 'dist');

function resolveListenPort(): number {
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT);
  if (Number.isInteger(defaultAppPort) && defaultAppPort > 0 && defaultAppPort <= 65535) {
    return defaultAppPort;
  }
  const envPort = process.env.PORT?.trim();
  const nginxPort = process.env.NGINX_PORT?.trim();
  if (envPort && (!nginxPort || envPort !== nginxPort)) {
    const parsed = Number(envPort);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return 3000;
}

const PORT = resolveListenPort();

// Resource & DoS Exhaustion Caps
const MAX_SOURCE_CHARS = 100_000;
const MAX_SOURCE_LINES = 5000;
const MAX_STDIN_ITEMS = 100;
const MAX_STDIN_ITEM_CHARS = 2048;
const MAX_TOTAL_STDIN_CHARS = 16_384;
const MAX_WORKER_TIMEOUT_MS = 5500;
const MAX_STDOUT_BYTES = 1_048_576;
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

// Replay Protection Caps
const REPLAY_WINDOW_MS = 60_000;
const MAX_REPLAY_CACHE_ENTRIES = 10_000;

// Secret Validation Constants
const MIN_SESSION_SECRET_LEN = 32;
const MIN_API_KEY_LEN = 16;
const KNOWN_WEAK_SECRETS = new Set([
  'secret',
  'changeme',
  'password',
  'default',
  'dev-secret',
  'test-secret',
  'powerscript-secret',
  'easyjs-secret',
  'admin',
  '123456',
  '12345678',
]);

export type DeploymentMode = 'public-playground' | 'production-private';

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigurationError';
  }
}

export class ServerExecutionCapacityError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = 'ServerExecutionCapacityError';
    this.statusCode = statusCode;
  }
}

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

// ---------------------------------------------------------------------------
// 1. Trusted Proxy Validation & Client IP Resolution
// ---------------------------------------------------------------------------

export type TrustedProxyRule =
  | { kind: 'loopback'; raw: string }
  | { kind: 'ipv4'; networkInt: number; maskInt: number; raw: string }
  | { kind: 'ipv6'; networkBig: bigint; maskBig: bigint; raw: string };

function parseIpv4ToInt(ip: string): number | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function parseIpv6ToBigInt(rawIp: string): bigint | null {
  if (!net.isIPv6(rawIp)) return null;
  let ip = rawIp.toLowerCase();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  // Expand trailing embedded IPv4 (e.g. ::ffff:10.0.0.1)
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const v4Int = parseIpv4ToInt(ip.slice(lastColon + 1));
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    ip = ip.slice(0, lastColon + 1) + `${hi}:${lo}`;
  }

  const dblParts = ip.split('::');
  if (dblParts.length > 2) return null;
  let groups: string[];
  if (dblParts.length === 2) {
    const left = dblParts[0] ? dblParts[0].split(':') : [];
    const right = dblParts[1] ? dblParts[1].split(':') : [];
    const fillCount = 8 - (left.length + right.length);
    if (fillCount < 1) return null;
    groups = [...left, ...Array<string>(fillCount).fill('0'), ...right];
  } else {
    groups = ip.split(':');
  }
  if (groups.length !== 8) return null;

  let acc = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    acc = (acc << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return acc;
}

export function normalizeIpAddress(rawIp: string): string {
  if (typeof rawIp !== 'string') return '';
  let clean = rawIp.trim();
  if (!clean) return '';
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx !== -1) {
    clean = clean.slice(0, zoneIdx);
  }
  if (clean.toLowerCase().startsWith('::ffff:')) {
    const maybeV4 = clean.slice('::ffff:'.length);
    if (net.isIPv4(maybeV4)) return maybeV4;
  }
  const ipType = net.isIP(clean);
  if (ipType === 0) return '';
  if (ipType === 6) {
    if (clean === '::1') return '::1';
    return clean.toLowerCase();
  }
  return clean;
}

function isLoopbackNormalizedIp(ip: string): boolean {
  if (ip === '::1') return true;
  const v4 = parseIpv4ToInt(ip);
  if (v4 !== null) {
    return (v4 >>> 24) === 127;
  }
  const v6 = parseIpv6ToBigInt(ip);
  return v6 === 1n;
}

export function parseTrustedProxyConfig(rawInput?: string[] | string): TrustedProxyRule[] {
  const entries: string[] = [];
  if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      if (typeof item !== 'string') {
        throw new ServerConfigurationError('Invalid trustedProxies entry: must be a string.');
      }
      const trimmed = item.trim();
      if (trimmed) entries.push(trimmed);
    }
  } else if (typeof rawInput === 'string' && rawInput.trim()) {
    for (const part of rawInput.split(',')) {
      const trimmed = part.trim();
      if (trimmed) entries.push(trimmed);
    }
  }

  const rules: TrustedProxyRule[] = [];
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (lower === '*' || lower === 'all' || lower === 'true' || lower === 'any') {
      throw new ServerConfigurationError(
        `Invalid trusted proxy rule "${entry}": wildcard proxy trust is forbidden.`
      );
    }
    if (lower === 'loopback') {
      rules.push({ kind: 'loopback', raw: entry });
      continue;
    }

    const slashIdx = entry.indexOf('/');
    const ipPart = slashIdx === -1 ? entry : entry.slice(0, slashIdx);
    const prefixPart = slashIdx === -1 ? null : entry.slice(slashIdx + 1);
    const normIp = normalizeIpAddress(ipPart);
    const ipKind = net.isIP(normIp);

    if (ipKind === 4) {
      const prefix =
        prefixPart === null
          ? 32
          : /^\d+$/.test(prefixPart)
            ? Number.parseInt(prefixPart, 10)
            : -1;
      if (prefix < 1 || prefix > 32) {
        throw new ServerConfigurationError(
          `Invalid IPv4 trusted proxy CIDR "${entry}": prefix must be 1..32.`
        );
      }
      const maskInt = (~0 << (32 - prefix)) >>> 0;
      const networkInt = (parseIpv4ToInt(normIp)! & maskInt) >>> 0;
      rules.push({ kind: 'ipv4', networkInt, maskInt, raw: entry });
      continue;
    }

    if (ipKind === 6) {
      const prefix =
        prefixPart === null
          ? 128
          : /^\d+$/.test(prefixPart)
            ? Number.parseInt(prefixPart, 10)
            : -1;
      if (prefix < 1 || prefix > 128) {
        throw new ServerConfigurationError(
          `Invalid IPv6 trusted proxy CIDR "${entry}": prefix must be 1..128.`
        );
      }
      const shift = BigInt(128 - prefix);
      const allOnes = (1n << 128n) - 1n;
      const maskBig = allOnes ^ ((1n << shift) - 1n);
      const networkBig = parseIpv6ToBigInt(normIp)! & maskBig;
      rules.push({ kind: 'ipv6', networkBig, maskBig, raw: entry });
      continue;
    }

    throw new ServerConfigurationError(
      `Invalid trusted proxy entry "${entry}": must be an IPv4/IPv6 address, CIDR, or "loopback".`
    );
  }

  return rules;
}

function ipMatchesTrustedProxy(normalizedIp: string, rules: TrustedProxyRule[]): boolean {
  if (!normalizedIp || rules.length === 0) return false;
  const v4Int = parseIpv4ToInt(normalizedIp);
  const v6Big = v4Int === null ? parseIpv6ToBigInt(normalizedIp) : null;

  for (const rule of rules) {
    if (rule.kind === 'loopback') {
      if (isLoopbackNormalizedIp(normalizedIp)) return true;
      continue;
    }
    if (rule.kind === 'ipv4' && v4Int !== null) {
      if (((v4Int & rule.maskInt) >>> 0) === rule.networkInt) return true;
      continue;
    }
    if (rule.kind === 'ipv6' && v6Big !== null) {
      if ((v6Big & rule.maskBig) === rule.networkBig) return true;
    }
  }
  return false;
}

export interface ClientAddressResolution {
  clientIp: string;
  peerIp: string;
  trustedProxyUsed: boolean;
  validProxyChain: boolean;
  reason?: string;
}

export function resolveClientAddress(
  req: Pick<Request, 'headers' | 'socket'>,
  trustedRules: TrustedProxyRule[]
): ClientAddressResolution {
  const peerIp = normalizeIpAddress(req.socket?.remoteAddress ?? '');
  if (!peerIp) {
    return {
      clientIp: 'unknown',
      peerIp: 'unknown',
      trustedProxyUsed: false,
      validProxyChain: true,
    };
  }

  // CRITICAL: Never honor X-Forwarded-For unless the direct TCP socket peer is an explicitly trusted proxy.
  if (!ipMatchesTrustedProxy(peerIp, trustedRules)) {
    return {
      clientIp: peerIp,
      peerIp,
      trustedProxyUsed: false,
      validProxyChain: true,
    };
  }

  const rawXff = req.headers['x-forwarded-for'];
  if (rawXff === undefined) {
    return {
      clientIp: peerIp,
      peerIp,
      trustedProxyUsed: true,
      validProxyChain: true,
    };
  }

  const joined = Array.isArray(rawXff) ? rawXff.join(',') : String(rawXff);
  if (!joined.trim() || joined.length > 2048 || /[\u0000-\u001f\u007f]/.test(joined)) {
    return {
      clientIp: peerIp,
      peerIp,
      trustedProxyUsed: true,
      validProxyChain: false,
      reason: 'Malformed X-Forwarded-For header from proxy.',
    };
  }

  const rawHops = joined.split(',');
  if (rawHops.length > 16) {
    return {
      clientIp: peerIp,
      peerIp,
      trustedProxyUsed: true,
      validProxyChain: false,
      reason: 'Excessive X-Forwarded-For proxy chain length.',
    };
  }

  const normalizedHops: string[] = [];
  for (const hop of rawHops) {
    const trimmed = hop.trim();
    const norm = normalizeIpAddress(trimmed);
    if (!norm) {
      return {
        clientIp: peerIp,
        peerIp,
        trustedProxyUsed: true,
        validProxyChain: false,
        reason: 'Invalid IP address in X-Forwarded-For proxy chain.',
      };
    }
    normalizedHops.push(norm);
  }

  // Walk right-to-left: strip trusted proxy hops until reaching the first untrusted client hop.
  for (let i = normalizedHops.length - 1; i >= 0; i--) {
    if (!ipMatchesTrustedProxy(normalizedHops[i], trustedRules)) {
      return {
        clientIp: normalizedHops[i],
        peerIp,
        trustedProxyUsed: true,
        validProxyChain: true,
      };
    }
  }

  return {
    clientIp: normalizedHops[0] ?? peerIp,
    peerIp,
    trustedProxyUsed: true,
    validProxyChain: true,
  };
}

// ---------------------------------------------------------------------------
// 2. Real OS-Level Sandbox Probing, Bundling & Isolated Execution
// ---------------------------------------------------------------------------

export interface OsSandboxCapabilities {
  enforced: boolean;
  platform: string;
  isRootUid: boolean;
  workerBundleReady: boolean;
  nodePermissionFlag: boolean;
  prlimitAvailable: boolean;
  unshareNamespacesAvailable: boolean;
  networkNamespaceIsolated: boolean;
  mountRoTmpfsAvailable: boolean;
  unprivilegedUidDropAvailable: boolean;
  enforcedWorkerUid: number | null;
  seccompBpfFilter: false;
  chrootSyscall: false;
  unavailableControls: string[];
}

let cachedWorkerBundlePath: string | null = null;
let cachedWorkerBundleDir: string | null = null;
let cachedOsProbe: OsSandboxCapabilities | null = null;

export function buildWorkerBundle(): string | null {
  if (cachedWorkerBundlePath && existsSync(cachedWorkerBundlePath)) {
    return cachedWorkerBundlePath;
  }
  if (!existsSync(WORKER_SCRIPT_PATH)) {
    return null;
  }

  try {
    const esbuild = require('esbuild') as typeof import('esbuild');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ps-worker-bundle-'));
    chmodSync(dir, 0o755);
    const outFile = path.join(dir, 'worker.mjs');
    esbuild.buildSync({
      entryPoints: [WORKER_SCRIPT_PATH],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      sourcemap: false,
      minify: false,
      external: ['node:*'],
    });
    chmodSync(outFile, 0o444);
    cachedWorkerBundleDir = dir;
    cachedWorkerBundlePath = outFile;
    return outFile;
  } catch {
    return null;
  }
}

export function probeOsSandboxCapabilities(forceRefresh = false): OsSandboxCapabilities {
  if (cachedOsProbe && !forceRefresh) {
    return cachedOsProbe;
  }

  const unavailableControls: string[] = [
    'seccomp-bpf (no kernel seccomp filter attached at runtime)',
    'chroot(2) (using unshare --mount ro tmpfs + Node --permission filesystem allowlist instead)',
  ];

  const isRootUid = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  const bundlePath = buildWorkerBundle();
  const workerBundleReady = Boolean(bundlePath);
  if (!workerBundleReady) {
    unavailableControls.push('esbuild worker bundle unavailable');
  }

  let nodePermissionFlag = false;
  let prlimitAvailable = false;
  let unshareNamespacesAvailable = false;
  let mountRoTmpfsAvailable = false;
  let unprivilegedUidDropAvailable = false;

  if (process.platform === 'linux') {
    const permRes = spawnSync(process.execPath, ['--permission', '-e', 'process.exit(0)'], {
      timeout: 2000,
      stdio: 'ignore',
    });
    nodePermissionFlag = permRes.status === 0;

    const prRes = spawnSync(
      'prlimit',
      ['--cpu=5', '--fsize=0', '--nofile=32', '--core=0', process.execPath, '-e', 'process.exit(0)'],
      { timeout: 2000, stdio: 'ignore' }
    );
    prlimitAvailable = prRes.status === 0;

    const unshareRes = spawnSync(
      'unshare',
      ['--net', '--ipc', '--uts', '--pid', '--fork', '--mount', 'sh', '-c', 'exit 0'],
      { timeout: 2000, stdio: 'ignore' }
    );
    unshareNamespacesAvailable = unshareRes.status === 0;

    const setprivRes = spawnSync(
      'setpriv',
      ['--reuid=65534', '--regid=65534', '--clear-groups', '--no-new-privs', 'id', '-u'],
      { timeout: 2000, encoding: 'utf8' }
    );
    unprivilegedUidDropAvailable =
      setprivRes.status === 0 && String(setprivRes.stdout ?? '').trim() === '65534';

    const probeTmp = mkdtempSync(path.join(os.tmpdir(), 'ps-probe-mount-'));
    try {
      const mountRes = spawnSync(
        'unshare',
        [
          '--mount',
          'sh',
          '-c',
          'mount -t tmpfs -o size=1M,ro,noexec,nosuid,nodev tmpfs "$1" && test -d "$1"',
          'ps-probe',
          probeTmp,
        ],
        { timeout: 2000, stdio: 'ignore' }
      );
      mountRoTmpfsAvailable = mountRes.status === 0;
    } finally {
      rmSync(probeTmp, { recursive: true, force: true });
    }
  } else {
    unavailableControls.push(`Linux namespaces/prlimit/setpriv unavailable on ${process.platform}`);
  }

  if (process.platform === 'linux') {
    if (!nodePermissionFlag) unavailableControls.push('node --permission');
    if (!prlimitAvailable) unavailableControls.push('prlimit');
    if (!unshareNamespacesAvailable) unavailableControls.push('unshare (--net --ipc --uts --pid --mount)');
    if (!mountRoTmpfsAvailable) unavailableControls.push('mount -t tmpfs ro,noexec,nosuid,nodev');
    if (!unprivilegedUidDropAvailable) unavailableControls.push('setpriv uid/gid 65534 + --no-new-privs');
  }

  const enforced =
    process.platform === 'linux' &&
    workerBundleReady &&
    nodePermissionFlag &&
    prlimitAvailable &&
    unshareNamespacesAvailable &&
    mountRoTmpfsAvailable &&
    unprivilegedUidDropAvailable;

  cachedOsProbe = {
    enforced,
    platform: process.platform,
    isRootUid,
    workerBundleReady,
    nodePermissionFlag,
    prlimitAvailable,
    unshareNamespacesAvailable,
    networkNamespaceIsolated: enforced,
    mountRoTmpfsAvailable,
    unprivilegedUidDropAvailable,
    enforcedWorkerUid: enforced ? 65534 : null,
    seccompBpfFilter: false,
    chrootSyscall: false,
    unavailableControls,
  };

  return cachedOsProbe;
}

function cleanupWorkerBundleCache(): void {
  if (cachedWorkerBundleDir) {
    rmSync(cachedWorkerBundleDir, { recursive: true, force: true });
    cachedWorkerBundleDir = null;
    cachedWorkerBundlePath = null;
  }
}

function killProcessTree(child: ChildProcess): void {
  if (typeof child.pid === 'number' && child.pid > 0) {
    try {
      // Negative PID signals the detached worker's entire process group
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to single-process kill
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore if already exited
  }
}

export interface WorkerExecutionOutcome {
  execution: ExecutionResult;
  killedByTimeout: boolean;
  osSandboxEnforced: boolean;
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
      killProcessTree(child);
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

function parseWorkerStdoutResult(
  stdoutText: string
): { ok?: boolean; execution?: ExecutionResult; error?: string } | null {
  const lines = stdoutText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith(WORKER_RESULT_PREFIX)) {
      const jsonStr = line.slice(WORKER_RESULT_PREFIX.length);
      try {
        return JSON.parse(jsonStr) as { ok?: boolean; execution?: ExecutionResult; error?: string };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function executeCompiledInWorker(
  compiledCode: string,
  stdin: string[] = [],
  securityPolicy: PartialCompilerSecurityPolicy = sanitizeServerSecurityPolicy(),
  signal?: AbortSignal,
  pool: WorkerConcurrencyPool = defaultWorkerPool,
  osCapabilities: OsSandboxCapabilities = probeOsSandboxCapabilities()
): Promise<WorkerExecutionOutcome> {
  const releaseSlot = await pool.acquire(signal);
  const start = performance.now();
  const useOsSandbox = osCapabilities.enforced;
  const bundlePath = useOsSandbox ? buildWorkerBundle() : null;
  let scratchDir: string | null = null;

  try {
    if (useOsSandbox && bundlePath) {
      scratchDir = mkdtempSync(path.join(os.tmpdir(), 'ps-run-'));
      chmodSync(scratchDir, 0o700);
      try {
        chownSync(scratchDir, 65534, 65534);
      } catch {
        // Ignore if non-root
      }
    }

    return await new Promise<WorkerExecutionOutcome>((resolve) => {
      let settled = false;
      let killedByTimeout = false;
      let stdoutBytes = 0;
      let stdoutText = '';
      let stderrBytes = 0;
      let stderrText = '';

      let child: ChildProcess;
      if (useOsSandbox && bundlePath && scratchDir) {
        const innerShell =
          'mount -t tmpfs -o size=1M,ro,noexec,nosuid,nodev tmpfs "$1" && cd "$1" && exec prlimit --cpu=5 --fsize=0 --nofile=32 --core=0 setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs "$2" --permission --allow-fs-read="$3" --max-old-space-size=64 --max-semi-space-size=8 --no-addons "$3"';

        child = spawn(
          'unshare',
          ['--net', '--ipc', '--uts', '--pid', '--fork', '--mount', 'sh', '-c', innerShell, 'ps-sandbox', scratchDir, process.execPath, bundlePath],
          {
            cwd: os.tmpdir(),
            detached: true,
            env: {
              PATH: '/usr/local/bin:/usr/bin:/bin',
              HOME: scratchDir,
              TMPDIR: scratchDir,
              UV_THREADPOOL_SIZE: '1',
              NODE_NO_WARNINGS: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
      } else {
        const tsxImportUrl = resolveTsxImportUrl();
        child = spawn(
          process.execPath,
          ['--max-old-space-size=64', '--max-semi-space-size=8', '--no-addons', '--import', tsxImportUrl, WORKER_SCRIPT_PATH],
          {
            cwd: os.tmpdir(),
            detached: true,
            env: {
              PATH: '/usr/local/bin:/usr/bin:/bin',
              UV_THREADPOOL_SIZE: '1',
              NODE_NO_WARNINGS: '1',
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          }
        );
      }

      pool.registerChild(child);

      const cleanupRunDir = () => {
        if (scratchDir) {
          try {
            rmSync(scratchDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup failure
          }
          scratchDir = null;
        }
      };

      const finalize = (outcome: WorkerExecutionOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        killProcessTree(child);
        cleanupRunDir();
        resolve(outcome);
      };

      const onAbort = () => {
        killProcessTree(child);
        const durationMs = Number((performance.now() - start).toFixed(2));
        finalize({
          killedByTimeout: false,
          osSandboxEnforced: useOsSandbox,
          execution: {
            logs: [],
            pointerEvents: [],
            durationMs,
            haltedByExit: true,
            error: 'Execution cancelled: client disconnected.',
          },
        });
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
        killProcessTree(child);
        const durationMs = Number((performance.now() - start).toFixed(2));
        finalize({
          killedByTimeout: true,
          osSandboxEnforced: useOsSandbox,
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

      if (useOsSandbox) {
        child.stdout?.on('data', (chunk: Buffer) => {
          if (stdoutBytes >= MAX_STDOUT_BYTES) return;
          const slice = chunk.subarray(0, MAX_STDOUT_BYTES - stdoutBytes);
          stdoutBytes += slice.byteLength;
          stdoutText += slice.toString('utf8');
        });
      }

      const handleWorkerPayload = (payload: { ok?: boolean; execution?: ExecutionResult; error?: string } | null) => {
        if (!payload) return false;
        if (payload.ok && payload.execution) {
          finalize({
            killedByTimeout: false,
            osSandboxEnforced: useOsSandbox,
            execution: sanitizeExecutionOutput(payload.execution),
          });
          return true;
        }

        const durationMs = Number((performance.now() - start).toFixed(2));
        finalize({
          killedByTimeout: false,
          osSandboxEnforced: useOsSandbox,
          execution: {
            logs: [],
            pointerEvents: [],
            durationMs,
            error: payload.error || 'Sandbox worker failed to execute program',
          },
        });
        return true;
      };

      if (!useOsSandbox) {
        child.on('message', (msg: unknown) => {
          handleWorkerPayload(msg as { ok?: boolean; execution?: ExecutionResult; error?: string } | null);
        });
      }

      child.on('error', (err) => {
        const durationMs = Number((performance.now() - start).toFixed(2));
        finalize({
          killedByTimeout: false,
          osSandboxEnforced: useOsSandbox,
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
        if (useOsSandbox) {
          const parsed = parseWorkerStdoutResult(stdoutText);
          if (handleWorkerPayload(parsed)) {
            return;
          }
        }
        const durationMs = Number((performance.now() - start).toFixed(2));
        const detail = stderrText.trim()
          ? stderrText.trim().slice(0, 400)
          : `process exited with code=${code ?? 'null'} signal=${signalName ?? 'none'}`;
        finalize({
          killedByTimeout: signalName === 'SIGKILL' || signalName === 'SIGXCPU' || killedByTimeout,
          osSandboxEnforced: useOsSandbox,
          execution: {
            logs: [],
            pointerEvents: [],
            durationMs,
            error: `SecurityError: Sandbox worker terminated unexpectedly (${detail})`,
          },
        });
      });

      const workerPayload = {
        type: 'execute',
        code: compiledCode,
        stdin,
        securityPolicy,
      };
      if (useOsSandbox) {
        child.stdin?.end(JSON.stringify(workerPayload));
      } else {
        child.send(workerPayload);
      }
    });
  } finally {
    if (scratchDir) {
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure
      }
    }
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------
// 3. Session Authentication, RBAC Scopes, Revocation, Replay Protection & CSRF
// ---------------------------------------------------------------------------

export type SandboxScope = 'compile' | 'execute' | 'status';

const ALL_SANDBOX_SCOPES: SandboxScope[] = ['compile', 'execute', 'status'];
const DEFAULT_SESSION_TTL_MS = 15 * 60_000;
const SESSION_COOKIE_NAME = 'ps_session';
const SESSION_RATE_MAX_PER_WINDOW = 60;

interface SignedSessionPayload {
  sub: string;
  scopes: SandboxScope[];
  iat: number;
  exp: number;
  jti: string;
  ip: string;
  mode?: DeploymentMode;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecodeToUtf8(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signSandboxSessionToken(options: {
  secret: string;
  scopes: SandboxScope[];
  clientIp?: string;
  ttlMs?: number;
  mode?: DeploymentMode;
}): { token: string; expiresAt: number; jti: string } {
  const now = Date.now();
  const ttlMs = clampFiniteInt(options.ttlMs, DEFAULT_SESSION_TTL_MS, 50, 24 * 3600_000);
  const expiresAt = now + ttlMs;
  const jti = randomBytes(12).toString('hex');
  const payload: SignedSessionPayload = {
    sub: 'sandbox-client',
    scopes: options.scopes.filter(
      (s): s is SandboxScope => s === 'compile' || s === 'execute' || s === 'status'
    ),
    iat: now,
    exp: expiresAt,
    jti,
    ip: normalizeIpAddress(options.clientIp ?? '127.0.0.1') || '127.0.0.1',
    mode: options.mode,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', options.secret).update(encodedPayload).digest('base64url');
  return {
    token: `${encodedPayload}.${sig}`,
    expiresAt,
    jti,
  };
}

function verifySandboxSessionToken(
  token: string,
  secret: string,
  expectedIp: string,
  enforceIpBinding: boolean
): { valid: true; payload: SignedSessionPayload } | { valid: false; reason: string } {
  if (!token || token.length > 2048) {
    return { valid: false, reason: 'Invalid session token format.' };
  }
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1 || token.indexOf('.', dotIdx + 1) !== -1) {
    return { valid: false, reason: 'Malformed session token.' };
  }
  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expectedSig = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'Invalid session token signature.' };
  }

  let parsed: SignedSessionPayload;
  try {
    parsed = JSON.parse(base64UrlDecodeToUtf8(encodedPayload)) as SignedSessionPayload;
  } catch {
    return { valid: false, reason: 'Corrupted session token payload.' };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray(parsed.scopes) ||
    typeof parsed.exp !== 'number' ||
    typeof parsed.iat !== 'number' ||
    typeof parsed.jti !== 'string' ||
    !parsed.jti ||
    typeof parsed.ip !== 'string'
  ) {
    return { valid: false, reason: 'Invalid session token claims.' };
  }

  if (Date.now() > parsed.exp) {
    return { valid: false, reason: 'Session token expired.' };
  }

  if (enforceIpBinding) {
    const reqIp = normalizeIpAddress(expectedIp);
    const tokenIp = normalizeIpAddress(parsed.ip);
    if (!reqIp || !tokenIp || reqIp !== tokenIp) {
      return { valid: false, reason: 'Session token IP mismatch.' };
    }
  }

  return { valid: true, payload: parsed };
}

function constantTimeEqualsSecret(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function isWeakSecret(val: string): boolean {
  const lower = val.trim().toLowerCase();
  if (KNOWN_WEAK_SECRETS.has(lower)) return true;
  if (/^(.)\1+$/.test(lower)) return true;
  return false;
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isSameOriginHeaderValid(
  req: Request,
  trustedProxyUsed: boolean
): { ok: true } | { ok: false; reason: string } {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite.toLowerCase() === 'cross-site') {
    return { ok: false, reason: 'Forbidden: cross-site request blocked by CSRF policy.' };
  }

  const allowedHosts = new Set<string>();
  if (typeof req.headers.host === 'string' && req.headers.host.trim()) {
    allowedHosts.add(req.headers.host.trim().toLowerCase());
  }
  // CRITICAL: Only trust X-Forwarded-Host when socket connection originated from an explicitly configured trusted proxy
  if (trustedProxyUsed) {
    const forwardedHost = req.headers['x-forwarded-host'];
    if (typeof forwardedHost === 'string' && forwardedHost.trim()) {
      const first = forwardedHost.split(',')[0]?.trim().toLowerCase();
      if (first && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(first)) {
        allowedHosts.add(first);
      }
    }
  }

  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string') {
    if (!originHeader || originHeader === 'null') {
      return { ok: false, reason: 'Forbidden: null/opaque Origin rejected.' };
    }
    try {
      const parsedOrigin = new URL(originHeader);
      if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
        return { ok: false, reason: 'Forbidden: unsupported Origin scheme.' };
      }
      if (!allowedHosts.has(parsedOrigin.host.toLowerCase())) {
        return { ok: false, reason: 'Forbidden: cross-origin request rejected.' };
      }
    } catch {
      return { ok: false, reason: 'Forbidden: malformed Origin header.' };
    }
    return { ok: true };
  }

  const refererHeader = req.headers.referer;
  if (typeof refererHeader === 'string' && refererHeader.trim()) {
    try {
      const parsedReferer = new URL(refererHeader);
      if (!allowedHosts.has(parsedReferer.host.toLowerCase())) {
        return { ok: false, reason: 'Forbidden: cross-origin Referer rejected.' };
      }
    } catch {
      return { ok: false, reason: 'Forbidden: malformed Referer header.' };
    }
  }

  return { ok: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const PLATFORM_UNSET_ENV_SENTINELS = new Set([
  '',
  'nothing',
  'none',
  'null',
  'undefined',
  'unset',
]);

function readNormalizedEnvVar(rawVal: string | undefined): string | undefined {
  if (typeof rawVal !== 'string') return undefined;
  const trimmed = rawVal.trim();
  if (PLATFORM_UNSET_ENV_SENTINELS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

function resolveDeploymentMode(
  raw?: unknown,
  hasConfiguredApiKey = Boolean(readNormalizedEnvVar(process.env.POWERSCRIPT_API_KEY))
): DeploymentMode {
  const envMode = readNormalizedEnvVar(process.env.POWERSCRIPT_DEPLOYMENT_MODE);
  const mode =
    raw ??
    envMode ??
    (process.env.NODE_ENV === 'production' && hasConfiguredApiKey
      ? 'production-private'
      : 'public-playground');
  if (mode === 'public-playground' || mode === 'production-private') {
    return mode;
  }
  throw new ServerConfigurationError(
    `Invalid deploymentMode "${String(mode)}": expected "public-playground" or "production-private".`
  );
}

export interface SandboxServerAppOptions {
  deploymentMode?: DeploymentMode;
  trustedProxies?: string[] | string;
  allowDegradedOsSandbox?: boolean;
  requireReplayHeaders?: boolean;
  osCapabilitiesOverride?: OsSandboxCapabilities;
  executeRateLimitPerMin?: number;
  compileRateLimitPerMin?: number;
  sessionRateLimitPerMin?: number;
  maxConcurrentWorkers?: number;
  maxPendingQueue?: number;
  maxQueueWaitMs?: number;
  sessionSecret?: string;
  sessionTtlMs?: number;
  apiKey?: string;
  enforceIpBinding?: boolean;
}

export function createSandboxServerApp(options: SandboxServerAppOptions = {}): Express {
  const app = express();
  const configuredApiKey =
    options.apiKey !== undefined
      ? options.apiKey
      : readNormalizedEnvVar(process.env.POWERSCRIPT_API_KEY) ?? '';
  const deploymentMode = resolveDeploymentMode(
    options.deploymentMode,
    Boolean(configuredApiKey)
  );
  const trustedProxyRules = parseTrustedProxyConfig(
    options.trustedProxies !== undefined
      ? options.trustedProxies
      : readNormalizedEnvVar(process.env.POWERSCRIPT_TRUSTED_PROXIES)
  );
  const allowDegradedOsSandbox =
    options.allowDegradedOsSandbox ??
    readNormalizedEnvVar(process.env.POWERSCRIPT_ALLOW_DEGRADED_SANDBOX)?.toLowerCase() === 'true';
  const osCapabilities = options.osCapabilitiesOverride ?? probeOsSandboxCapabilities();

  const rawSessionSecret =
    options.sessionSecret !== undefined
      ? options.sessionSecret
      : readNormalizedEnvVar(process.env.POWERSCRIPT_SESSION_SECRET);
  if (rawSessionSecret !== undefined) {
    if (rawSessionSecret.length < MIN_SESSION_SECRET_LEN || isWeakSecret(rawSessionSecret)) {
      throw new ServerConfigurationError(
        `Invalid sessionSecret: must be at least ${MIN_SESSION_SECRET_LEN} characters and non-trivial.`
      );
    }
  }
  const sessionSecret = rawSessionSecret || randomBytes(32).toString('hex');

  if (deploymentMode === 'production-private') {
    if (!configuredApiKey) {
      throw new ServerConfigurationError(
        'ConfigurationError: POWERSCRIPT_API_KEY is mandatory in "production-private" deployment mode.'
      );
    }
    if (configuredApiKey.length < MIN_API_KEY_LEN || isWeakSecret(configuredApiKey)) {
      throw new ServerConfigurationError(
        `ConfigurationError: API key must be at least ${MIN_API_KEY_LEN} non-trivial characters in "production-private" mode.`
      );
    }
  }

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

  const sessionTtlMs = clampFiniteInt(
    options.sessionTtlMs,
    DEFAULT_SESSION_TTL_MS,
    50,
    24 * 3600_000
  );
  const enforceIpBinding = options.enforceIpBinding ?? true;
  const requireReplayHeaders =
    options.requireReplayHeaders ?? deploymentMode === 'production-private';

  const executeLimiter = new SlidingWindowRateLimiter(
    RATE_WINDOW_MS,
    options.executeRateLimitPerMin ?? EXECUTE_MAX_REQ_PER_WINDOW
  );
  const compileLimiter = new SlidingWindowRateLimiter(
    RATE_WINDOW_MS,
    options.compileRateLimitPerMin ?? COMPILE_MAX_REQ_PER_WINDOW
  );
  const sessionLimiter = new SlidingWindowRateLimiter(
    RATE_WINDOW_MS,
    options.sessionRateLimitPerMin ?? SESSION_RATE_MAX_PER_WINDOW
  );

  // Server-side revocation list (jti -> expMs) & replay protection cache (tokenId:nonce -> expMs)
  const revokedJtis = new Map<string, number>();
  const seenReplayNonces = new Map<string, number>();

  const pruneExpiringMap = (map: Map<string, number>, maxEntries: number): void => {
    const now = Date.now();
    for (const [k, exp] of map.entries()) {
      if (exp <= now) map.delete(k);
    }
    if (map.size >= maxEntries) {
      const toRemove = map.size - maxEntries + 1;
      let removed = 0;
      for (const k of map.keys()) {
        map.delete(k);
        removed += 1;
        if (removed >= toRemove) break;
      }
    }
  };

  type AuthSuccess = {
    authenticated: true;
    scopes: SandboxScope[];
    method: 'api-key' | 'session';
    jti?: string;
    exp?: number;
  };
  type AuthFailure = { authenticated: false; reason: string };

  const authenticateRequest = (
    req: Request,
    resolvedClientIp: string
  ): AuthSuccess | AuthFailure => {
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;
    const apiKeyHeader =
      typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : null;

    if (configuredApiKey) {
      if (apiKeyHeader) {
        if (constantTimeEqualsSecret(apiKeyHeader, configuredApiKey)) {
          return { authenticated: true, scopes: ALL_SANDBOX_SCOPES, method: 'api-key' };
        }
        return { authenticated: false, reason: 'Unauthorized: invalid API key.' };
      }
      if (bearerToken && constantTimeEqualsSecret(bearerToken, configuredApiKey)) {
        return { authenticated: true, scopes: ALL_SANDBOX_SCOPES, method: 'api-key' };
      }
    } else if (apiKeyHeader) {
      return { authenticated: false, reason: 'Unauthorized: API key authentication is not configured.' };
    }

    const cookieToken = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
    const candidateToken = bearerToken ?? cookieToken;
    if (!candidateToken) {
      return { authenticated: false, reason: 'Unauthorized: authentication token required.' };
    }

    const verified = verifySandboxSessionToken(
      candidateToken,
      sessionSecret,
      resolvedClientIp,
      enforceIpBinding
    );
    if (!verified.valid) {
      return { authenticated: false, reason: `Unauthorized: ${verified.reason}` };
    }

    if (verified.payload.mode && verified.payload.mode !== deploymentMode) {
      return { authenticated: false, reason: 'Unauthorized: token deployment mode mismatch.' };
    }

    pruneExpiringMap(revokedJtis, MAX_REPLAY_CACHE_ENTRIES);
    if (revokedJtis.has(verified.payload.jti)) {
      return { authenticated: false, reason: 'Unauthorized: session token has been revoked.' };
    }

    return {
      authenticated: true,
      scopes: verified.payload.scopes,
      method: 'session',
      jti: verified.payload.jti,
      exp: verified.payload.exp,
    };
  };

  const checkAndConsumeReplay = (
    req: Request,
    auth: AuthSuccess
  ): { ok: true } | { ok: false; status: number; reason: string } => {
    const rawNonce = req.headers['x-request-nonce'];
    const rawTs = req.headers['x-request-timestamp'];
    const hasNonce = typeof rawNonce === 'string' && rawNonce.length > 0;
    const hasTs = typeof rawTs === 'string' && rawTs.length > 0;

    if (!hasNonce && !hasTs) {
      if (requireReplayHeaders) {
        return {
          ok: false,
          status: 401,
          reason: 'Replay protection headers (X-Request-Nonce and X-Request-Timestamp) are required.',
        };
      }
      return { ok: true };
    }

    if (!hasNonce || !hasTs) {
      return {
        ok: false,
        status: 400,
        reason: 'Incomplete replay protection headers: provide both X-Request-Nonce and X-Request-Timestamp.',
      };
    }

    if (!/^[a-zA-Z0-9._-]{8,128}$/.test(rawNonce)) {
      return {
        ok: false,
        status: 400,
        reason: 'Malformed X-Request-Nonce header.',
      };
    }

    const tsMs = Number(rawTs);
    const now = Date.now();
    if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > REPLAY_WINDOW_MS) {
      return {
        ok: false,
        status: 401,
        reason: 'Expired or skewed X-Request-Timestamp replay window.',
      };
    }

    pruneExpiringMap(seenReplayNonces, MAX_REPLAY_CACHE_ENTRIES);
    const identityKey = auth.jti ?? auth.method;
    const cacheKey = `${identityKey}:${rawNonce}`;
    if (seenReplayNonces.has(cacheKey)) {
      return {
        ok: false,
        status: 409,
        reason: 'Replay detected: request nonce has already been used.',
      };
    }
    seenReplayNonces.set(cacheKey, now + REPLAY_WINDOW_MS);
    return { ok: true };
  };

  const resolveProxyOrReject = (req: Request, res: Response): ClientAddressResolution | null => {
    const resolved = resolveClientAddress(req, trustedProxyRules);
    if (!resolved.validProxyChain) {
      res.status(400).json({
        success: false,
        blocked: true,
        error: resolved.reason ?? 'Invalid X-Forwarded-For proxy chain.',
      });
      return null;
    }
    return resolved;
  };

  const enforceCsrfAuthAndReplay = (requiredScope?: SandboxScope) => {
    return (
      req: Request,
      res: Response,
      next: NextFunction
    ): void => {
      const resolvedClient = resolveProxyOrReject(req, res);
      if (!resolvedClient) return;

      const originCheck = isSameOriginHeaderValid(req, resolvedClient.trustedProxyUsed);
      if (!originCheck.ok) {
        res.status(403).json({
          success: false,
          blocked: true,
          error: originCheck.reason,
        });
        return;
      }

      const auth = authenticateRequest(req, resolvedClient.clientIp);
      if (!auth.authenticated) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="PowerScript Sandbox"');
        res.status(401).json({
          success: false,
          blocked: true,
          error: auth.reason,
        });
        return;
      }

      if (requiredScope && !auth.scopes.includes(requiredScope)) {
        res.status(403).json({
          success: false,
          blocked: true,
          error: `Forbidden: token lacks required scope "${requiredScope}".`,
        });
        return;
      }

      const replay = checkAndConsumeReplay(req, auth);
      if (!replay.ok) {
        res.status(replay.status).json({
          success: false,
          blocked: true,
          error: replay.reason,
        });
        return;
      }

      (res.locals as { clientAddr?: ClientAddressResolution; auth?: AuthSuccess }).clientAddr =
        resolvedClient;
      (res.locals as { clientAddr?: ClientAddressResolution; auth?: AuthSuccess }).auth = auth;
      next();
    };
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '160kb', strict: true }));

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

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), usb=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const resolvedClient = resolveProxyOrReject(req, res);
    if (!resolvedClient) return;

    const rate = sessionLimiter.consume(resolvedClient.clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: 'Rate limit exceeded for /api/auth/session. Please retry shortly.',
      });
      return;
    }

    const originCheck = isSameOriginHeaderValid(req, resolvedClient.trustedProxyUsed);
    if (!originCheck.ok) {
      res.status(403).json({ error: originCheck.reason });
      return;
    }

    // CRITICAL: In 'production-private' mode, never issue anonymous sessions.
    if (deploymentMode === 'production-private') {
      const apiKeyHeader =
        typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
      const authHeader = req.headers.authorization;
      const bearerKey =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length).trim()
          : '';
      const candidateKey = apiKeyHeader || bearerKey;
      if (!candidateKey || !constantTimeEqualsSecret(candidateKey, configuredApiKey)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="PowerScript Sandbox"');
        res.status(401).json({
          error: 'Unauthorized: valid API key is required to obtain a session in private production mode.',
        });
        return;
      }
    }

    let requestedScopes: SandboxScope[] = ALL_SANDBOX_SCOPES;
    if (typeof req.query.scopes === 'string' && req.query.scopes.trim()) {
      const rawScopes = req.query.scopes.split(',').map((s) => s.trim()).filter(Boolean);
      const valid = rawScopes.every(
        (s): s is SandboxScope => s === 'compile' || s === 'execute' || s === 'status'
      );
      if (!valid || rawScopes.length === 0) {
        res.status(400).json({ error: 'Invalid scopes requested. Allowed: compile, execute, status.' });
        return;
      }
      requestedScopes = Array.from(new Set(rawScopes)) as SandboxScope[];
    }

    const { token, expiresAt } = signSandboxSessionToken({
      secret: sessionSecret,
      scopes: requestedScopes,
      clientIp: resolvedClient.clientIp,
      ttlMs: sessionTtlMs,
      mode: deploymentMode,
    });

    const isHttps =
      req.secure ||
      (resolvedClient.trustedProxyUsed && req.headers['x-forwarded-proto'] === 'https');
    const maxAgeSec = Math.max(1, Math.ceil(sessionTtlMs / 1000));
    const cookieFlags = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/api',
      `Max-Age=${maxAgeSec}`,
    ];
    if (isHttps) {
      cookieFlags.push('Secure');
    }
    res.setHeader('Set-Cookie', cookieFlags.join('; '));

    res.json({
      token,
      tokenType: 'Bearer',
      expiresAt,
      scopes: requestedScopes,
      deploymentMode,
    });
  });

  app.post('/api/auth/revoke', enforceCsrfAuthAndReplay(), (req: Request, res: Response) => {
    const auth = (res.locals as { auth?: AuthSuccess }).auth;
    if (auth?.jti) {
      revokedJtis.set(auth.jti, auth.exp ?? Date.now() + sessionTtlMs);
    }
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`
    );
    res.json({
      ok: true,
      revoked: Boolean(auth?.jti),
    });
  });

  app.get('/api/sandbox/status', (req: Request, res: Response) => {
    const resolvedClient = resolveProxyOrReject(req, res);
    if (!resolvedClient) return;

    const auth = authenticateRequest(req, resolvedClient.clientIp);
    if (!auth.authenticated || !auth.scopes.includes('status')) {
      res.json({
        ok: true,
        mode: 'fail-closed',
        deploymentMode,
        authenticated: false,
      });
      return;
    }

    res.json({
      ok: true,
      mode: 'fail-closed',
      deploymentMode,
      authenticated: true,
      osIsolation: {
        enforced: osCapabilities.enforced,
        degradedAllowed: allowDegradedOsSandbox,
        platform: osCapabilities.platform,
        unshareNamespaces: osCapabilities.unshareNamespacesAvailable,
        networkNamespaceIsolated: osCapabilities.networkNamespaceIsolated,
        mountRoTmpfs: osCapabilities.mountRoTmpfsAvailable,
        prlimitCpuFsizeNofile: osCapabilities.prlimitAvailable,
        unprivilegedUidDrop: osCapabilities.unprivilegedUidDropAvailable,
        enforcedWorkerUid: osCapabilities.enforcedWorkerUid,
        nodePermissionModel: osCapabilities.nodePermissionFlag,
        seccompBpfFilter: osCapabilities.seccompBpfFilter,
        chrootSyscall: osCapabilities.chrootSyscall,
        unavailableControls: osCapabilities.unavailableControls,
      },
      virtualFilesystem: {
        type: 'ephemeral-in-memory-map',
        osChroot: false,
        isolatedPerExecution: true,
        persistentAcrossSessions: false,
        limits: {
          maxFiles: 64,
          maxFileChars: 131072,
          maxTotalChars: 524288,
        },
      },
      proxyTrust: {
        configured: trustedProxyRules.length > 0,
        ruleCount: trustedProxyRules.length,
        clientIpResolved: resolvedClient.clientIp,
      },
      replayProtection: {
        requiredInPrivateMode: requireReplayHeaders,
        windowMs: REPLAY_WINDOW_MS,
      },
      layers: {
        staticAnalyzer: 'fail-closed (SEC000 on incomplete analysis)',
        capabilityManager: 'strict prototype, eval, host-global, and computed-gadget blocking',
        borrowAndTypeSafety: 'ownership + borrow checker + strict static type checker',
        ssrfProtection:
          'canonical IPv4/IPv6 CIDR validation + DNS pre-resolution with pinned socket IP + redirect blocking + blocked cookie/metadata headers',
        runtimeIsolation: osCapabilities.enforced
          ? 'OS unshare (--net --ipc --uts --pid --fork --mount) + ro tmpfs + prlimit + setpriv uid=65534 --no-new-privs + node --permission (allow-fs-read bundle only) + 64MB heap cap + V8 vm context'
          : `DEGRADED HOST MODE (unavailable OS controls: ${osCapabilities.unavailableControls.join('; ')}) — Node child process + 64MB heap cap + V8 vm context`,
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

  app.post('/api/compile', enforceCsrfAuthAndReplay('compile'), (req: Request, res: Response) => {
    const clientAddr = (res.locals as { clientAddr: ClientAddressResolution }).clientAddr;
    const rate = compileLimiter.consume(clientAddr.clientIp);
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
      securityPolicy?: unknown;
    } | null;

    if (!isPlainObject(body) || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.interactiveAsync !== undefined && typeof body.interactiveAsync !== 'boolean') {
      res.status(400).json({ error: 'Invalid request: "interactiveAsync" must be a boolean.' });
      return;
    }
    if (body.optimize !== undefined && typeof body.optimize !== 'boolean') {
      res.status(400).json({ error: 'Invalid request: "optimize" must be a boolean.' });
      return;
    }
    if (body.securityPolicy !== undefined && !isPlainObject(body.securityPolicy)) {
      res.status(400).json({ error: 'Invalid request: "securityPolicy" must be an object.' });
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

    const safePolicy = sanitizeServerSecurityPolicy(
      body.securityPolicy as PartialCompilerSecurityPolicy | undefined
    );
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

  app.post('/api/execute', enforceCsrfAuthAndReplay('execute'), async (req: Request, res: Response) => {
    const clientAddr = (res.locals as { clientAddr: ClientAddressResolution }).clientAddr;
    const rate = executeLimiter.consume(clientAddr.clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        success: false,
        blocked: true,
        error: 'Rate limit exceeded for /api/execute. Please retry shortly.',
      });
      return;
    }

    // Fail closed in private production mode when required OS sandbox controls are unavailable
    if (deploymentMode === 'production-private' && !osCapabilities.enforced && !allowDegradedOsSandbox) {
      res.status(503).json({
        success: false,
        blocked: true,
        error: `SecurityError: OS-level sandbox isolation unavailable on this host (${osCapabilities.unavailableControls.join(', ')}). Refusing execution in production-private mode.`,
      });
      return;
    }

    const body = req.body as {
      source?: unknown;
      stdin?: unknown;
      securityPolicy?: unknown;
    } | null;

    if (!isPlainObject(body) || typeof body.source !== 'string') {
      res.status(400).json({ error: 'Invalid request: "source" must be a string.' });
      return;
    }
    if (body.securityPolicy !== undefined && !isPlainObject(body.securityPolicy)) {
      res.status(400).json({ error: 'Invalid request: "securityPolicy" must be an object.' });
      return;
    }
    if (body.stdin !== undefined) {
      if (!Array.isArray(body.stdin)) {
        res.status(400).json({ error: 'Invalid request: "stdin" must be an array.' });
        return;
      }
      if (body.stdin.length > MAX_STDIN_ITEMS) {
        res.status(413).json({
          error: `Stdin exceeds maximum item limit (${MAX_STDIN_ITEMS} items).`,
        });
        return;
      }
      for (const item of body.stdin) {
        const t = typeof item;
        if (t !== 'string' && t !== 'number' && t !== 'boolean') {
          res.status(400).json({
            error: 'Invalid request: "stdin" items must be primitive strings, numbers, or booleans.',
          });
          return;
        }
      }
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
    const safePolicy = sanitizeServerSecurityPolicy(
      body.securityPolicy as PartialCompilerSecurityPolicy | undefined
    );

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
    const onAbortCleanup = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    res.on('close', onAbortCleanup);

    try {
      const outcome = await executeCompiledInWorker(
        compiled.code,
        stdin,
        safePolicy,
        abortController.signal,
        pool,
        osCapabilities
      );
      if (res.writableEnded) return;

      res.status(200).json({
        success: !outcome.execution.error,
        blocked: false,
        killedByTimeout: outcome.killedByTimeout,
        osSandboxEnforced: outcome.osSandboxEnforced,
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
        error: 'Unexpected sandbox execution error.',
      });
    } finally {
      res.removeListener('close', onAbortCleanup);
    }
  });

  // Safe error boundary (never expose secrets or stack traces to callers)
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Internal sandbox server error.',
      });
    }
  });

  return app;
}

async function startServer(): Promise<void> {
  const osCaps = probeOsSandboxCapabilities();
  const app = createSandboxServerApp({ osCapabilitiesOverride: osCaps });
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
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; child-src 'self' blob: data:; frame-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
      );
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[PowerScript Sandbox Server] Listening on http://0.0.0.0:${PORT} | mode=${resolveDeploymentMode()} | osSandboxEnforced=${osCaps.enforced}`
    );
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  const shutdown = () => {
    defaultWorkerPool.killAllActive();
    cleanupWorkerBundleCache();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function checkIsMainModule(): boolean {
  if (!process.argv[1]) return false;
  const argPath = path.resolve(process.argv[1]);
  const selfPath = path.resolve(__filename);
  if (argPath === selfPath) return true;
  try {
    return realpathSync(argPath) === realpathSync(selfPath);
  } catch {
    return false;
  }
}

process.once('exit', () => {
  cleanupWorkerBundleCache();
});

if (checkIsMainModule()) {
  void startServer();
}
