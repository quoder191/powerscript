/**
 * PowerScript / EasyJS Security Policy & Network Policy Manager
 *
 * Centralizes compile-time and runtime security policies for:
 * - Bounded fetch() (blocks cookies, credentials, SSRF/local/metadata IPs, C2 methods, oversized responses)
 * - globalThis policy (disabled by default, or readonly/sandboxed via policy)
 * - Ownership & borrow safety policy
 * - Type-safety policy
 */

import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from './types.ts';

export type GlobalThisPolicyMode = 'disabled' | 'readonly' | 'sandboxed';

export interface NetworkSecurityPolicy {
  enabled: boolean;
  allowedProtocols: string[];
  allowedMethods: string[];
  blockCookies: boolean;
  allowCredentials: boolean;
  blockPrivateNetworks: boolean;
  allowDangerousPorts: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  blockedHeaders: string[];
  maxRedirects: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRequestsPerRun: number;
  maxUrlLength: number;
}

export interface GlobalAccessPolicy {
  globalThisMode: GlobalThisPolicyMode;
  forbidHostEscapeGlobals: boolean;
  forbidPrototypeAccess: boolean;
  forbidDynamicEval: boolean;
}

export interface TypeSafetyPolicy {
  enabled: boolean;
  strictNullChecks: boolean;
  checkFunctionCalls: boolean;
  checkReturnTypes: boolean;
  checkControlFlow: boolean;
  checkMemberVisibility: boolean;
}

export interface CompilerSecurityPolicy {
  ownership: SecurityPolicy;
  network: NetworkSecurityPolicy;
  globals: GlobalAccessPolicy;
  typeSafety: TypeSafetyPolicy;
}

export interface PartialCompilerSecurityPolicy {
  ownership?: Partial<SecurityPolicy>;
  network?: Partial<NetworkSecurityPolicy>;
  globals?: Partial<GlobalAccessPolicy>;
  typeSafety?: Partial<TypeSafetyPolicy>;
}

export const DEFAULT_BLOCKED_HEADERS = [
  'cookie',
  'cookie2',
  'set-cookie',
  'set-cookie2',
  'authorization',
  'proxy-authorization',
  'x-csrf-token',
  'x-xsrf-token',
  'origin',
  'referer',
  'host',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
];

export const DEFAULT_NETWORK_SECURITY_POLICY: NetworkSecurityPolicy = {
  enabled: true,
  allowedProtocols: ['http:', 'https:'],
  allowedMethods: ['GET', 'HEAD'],
  blockCookies: true,
  allowCredentials: false,
  blockPrivateNetworks: true,
  allowDangerousPorts: false,
  blockedHeaders: [...DEFAULT_BLOCKED_HEADERS],
  maxRedirects: 0,
  timeoutMs: 5000,
  maxResponseBytes: 524288, // 512 KB cap
  maxRequestsPerRun: 15,
  maxUrlLength: 2048,
};

export const DEFAULT_GLOBAL_ACCESS_POLICY: GlobalAccessPolicy = {
  globalThisMode: 'disabled',
  forbidHostEscapeGlobals: true,
  forbidPrototypeAccess: true,
  forbidDynamicEval: true,
};

export const DEFAULT_TYPE_SAFETY_POLICY: TypeSafetyPolicy = {
  enabled: true,
  strictNullChecks: true,
  checkFunctionCalls: true,
  checkReturnTypes: true,
  checkControlFlow: true,
  checkMemberVisibility: true,
};

export const DEFAULT_COMPILER_SECURITY_POLICY: CompilerSecurityPolicy = {
  ownership: {
    ...DEFAULT_SECURITY_POLICY,
    requireExplicitBorrowEnd: false,
    warnOnOwnerNotConsumedAtScopeExit: false,
  },
  network: { ...DEFAULT_NETWORK_SECURITY_POLICY },
  globals: { ...DEFAULT_GLOBAL_ACCESS_POLICY },
  typeSafety: { ...DEFAULT_TYPE_SAFETY_POLICY },
};

export class SecurityPolicyManager {
  readonly policy: CompilerSecurityPolicy;

  constructor(overrides?: PartialCompilerSecurityPolicy) {
    this.policy = {
      ownership: {
        ...DEFAULT_COMPILER_SECURITY_POLICY.ownership,
        ...(overrides?.ownership ?? {}),
      },
      network: {
        ...DEFAULT_COMPILER_SECURITY_POLICY.network,
        ...(overrides?.network ?? {}),
        allowedProtocols: overrides?.network?.allowedProtocols
          ? [...overrides.network.allowedProtocols]
          : [...DEFAULT_NETWORK_SECURITY_POLICY.allowedProtocols],
        allowedMethods: overrides?.network?.allowedMethods
          ? overrides.network.allowedMethods.map((m) => m.toUpperCase())
          : [...DEFAULT_NETWORK_SECURITY_POLICY.allowedMethods],
        blockedHeaders: overrides?.network?.blockedHeaders
          ? overrides.network.blockedHeaders.map((h) => h.toLowerCase())
          : [...DEFAULT_NETWORK_SECURITY_POLICY.blockedHeaders],
      },
      globals: {
        ...DEFAULT_COMPILER_SECURITY_POLICY.globals,
        ...(overrides?.globals ?? {}),
      },
      typeSafety: {
        ...DEFAULT_COMPILER_SECURITY_POLICY.typeSafety,
        ...(overrides?.typeSafety ?? {}),
      },
    };
  }

  getNetworkManager(): NetworkPolicyManager {
    return new NetworkPolicyManager(this.policy.network);
  }
}

const DANGEROUS_PORTS = new Set([
  20, 21, 22, 23, 25, 53, 69, 110, 111, 135, 137, 138, 139, 143, 389,
  445, 465, 587, 636, 993, 995, 1433, 1521, 2049, 2375, 2376, 2379, 2380,
  3306, 3389, 4001, 5432, 5900, 6379, 6443, 8086, 8500, 9090, 9100, 9200,
  10250, 10255, 11211, 27017, 27018, 50070,
]);

const BLOCKED_METADATA_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'localtest.me',
  'lvh.me',
  'vcap.me',
]);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.arpa',
  '.localdomain',
  '.nip.io',
  '.sslip.io',
  '.xip.io',
  '.localtest.me',
  '.lvh.me',
  '.vcap.me',
];

export function parseCanonicalIpv4(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part.startsWith('0')) {
      // Reject ambiguous octal-looking dotted octets fail-closed
      return null;
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

export function isPrivateOrReservedIpv4Int(addr: number): boolean {
  const a = (addr >>> 24) & 0xff;
  const b = (addr >>> 16) & 0xff;
  const c = (addr >>> 8) & 0xff;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT + Alibaba metadata)
  if (a === 127) return true; // 127.0.0.0/8 (Loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF Protocol)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 (6to4 Relay)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved/Broadcast)
  return false;
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parsed = parseCanonicalIpv4(ip.trim());
  if (parsed === null) return true; // Fail closed on malformed/octal IPv4 literals
  return isPrivateOrReservedIpv4Int(parsed);
}

export function parseCanonicalIpv6(rawIp: string): number[] | null {
  let ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip || ip.includes('%')) {
    // Zone IDs (e.g. fe80::1%eth0) always target local interfaces -> reject
    return null;
  }

  // Handle embedded dotted-IPv4 suffix (e.g. ::ffff:127.0.0.1 or 64:ff9b::10.0.0.1)
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const ipv4Int = parseCanonicalIpv4(ip.slice(lastColon + 1));
    if (ipv4Int === null) return null;
    const hi = ((ipv4Int >>> 16) & 0xffff).toString(16);
    const lo = (ipv4Int & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const dblParts = ip.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups = side.split(':');
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  if (dblParts.length === 1) {
    const words = parseSide(dblParts[0]);
    return words && words.length === 8 ? words : null;
  }

  const left = parseSide(dblParts[0]);
  const right = parseSide(dblParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const words = parseCanonicalIpv6(rawIp);
  if (!words) return true; // Fail closed on invalid IPv6 or zone IDs

  const isZeroPrefix = (count: number) => {
    for (let i = 0; i < count; i++) {
      if (words[i] !== 0) return false;
    }
    return true;
  };

  // ::/128 (unspecified) and ::1/128 (loopback)
  if (isZeroPrefix(7) && (words[7] === 0 || words[7] === 1)) {
    return true;
  }

  // ::ffff:0:0/96 (IPv4-mapped IPv6, e.g. ::ffff:7f00:1 / ::ffff:a9fe:a9fe)
  if (isZeroPrefix(5) && words[5] === 0xffff) {
    const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
    return isPrivateOrReservedIpv4Int(embeddedV4);
  }

  // ::/96 (deprecated IPv4-compatible IPv6)
  if (isZeroPrefix(6)) {
    const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
    return isPrivateOrReservedIpv4Int(embeddedV4);
  }

  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (words[0] === 0x0064 && words[1] === 0xff9b) {
    if (words[2] === 0x0001) return true; // Local-use NAT64
    if (words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
      const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
      return isPrivateOrReservedIpv4Int(embeddedV4);
    }
  }

  // 2002::/16 (6to4 embedding IPv4 in words[1], words[2])
  if (words[0] === 0x2002) {
    const embeddedV4 = ((words[1] << 16) | words[2]) >>> 0;
    return isPrivateOrReservedIpv4Int(embeddedV4);
  }

  // 2001::/32 (Teredo tunneling) & 2001:db8::/32 (Documentation)
  if (words[0] === 0x2001 && (words[1] === 0x0000 || words[1] === 0x0db8)) {
    return true;
  }

  // 100::/64 (Discard-Only)
  if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) {
    return true;
  }

  // fc00::/7 (Unique Local Address, including AWS fd00:ec2::254)
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (Link-local)
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // fec0::/10 (Deprecated Site-local)
  if ((words[0] & 0xffc0) === 0xfec0) return true;

  // ff00::/8 (Multicast)
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, '');
  if (!bare) return true;
  if (bare.includes(':')) {
    return isPrivateOrReservedIpv6(bare);
  }
  return isPrivateOrReservedIpv4(bare);
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  // Strip IPv6 brackets and trailing DNS root dot (prevents "localhost." bypass)
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');

  if (!host || host.includes('%')) return true;

  if (BLOCKED_METADATA_HOSTS.has(host)) {
    return true;
  }

  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  // Block integer, hex, octal, and shorthand IPv4 notations (e.g. 2130706433, 0x7f000001, 127.1, 0177.0.0.1)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }
  if (/^(?:0[0-7]+|0x[0-9a-f]+|\d+)(?:\.(?:0[0-7]+|0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) {
    return isPrivateOrReservedIpv4(host);
  }

  // IPv6 literal check
  if (host.includes(':')) {
    return isPrivateOrReservedIpv6(host);
  }

  return false;
}

export type FetchValidationResult =
  | {
      ok: true;
      url: string;
      method: string;
      sanitizedInit: RequestInit;
    }
  | {
      ok: false;
      code: string;
      reason: string;
    };

interface NodeDnsModule {
  lookup: (
    hostname: string,
    options: { all: true; verbatim: true },
    callback: (
      err: Error | null,
      addresses: Array<{ address: string; family: number }>
    ) => void
  ) => void;
}

interface NodeNetModule {
  isIP: (input: string) => number;
}

interface NodeHttpIncomingMessage {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  destroy: (err?: Error) => void;
  socket?: { remoteAddress?: string };
}

interface NodeHttpClientRequest {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  write: (chunk: string) => void;
  end: () => void;
  destroy: (err?: Error) => void;
}

interface NodeHttpModule {
  request: (
    url: URL,
    options: Record<string, unknown>,
    cb: (res: NodeHttpIncomingMessage) => void
  ) => NodeHttpClientRequest;
}

function getNodeNetworkBuiltins(): {
  dns: NodeDnsModule;
  net: NodeNetModule;
  http: NodeHttpModule;
  https: NodeHttpModule;
} | null {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) {
      return null;
    }
    const proc = process as unknown as {
      getBuiltinModule?: (id: string) => unknown;
    };
    if (typeof proc.getBuiltinModule !== 'function') {
      return null;
    }
    const dns = proc.getBuiltinModule('dns') as NodeDnsModule | undefined;
    const net = proc.getBuiltinModule('net') as NodeNetModule | undefined;
    const http = proc.getBuiltinModule('http') as NodeHttpModule | undefined;
    const https = proc.getBuiltinModule('https') as NodeHttpModule | undefined;
    if (dns && net && http && https) {
      return { dns, net, http, https };
    }
  } catch {
    // Browser or restricted non-Node environment
  }
  return null;
}

export class NetworkPolicyManager {
  private readonly policy: NetworkSecurityPolicy;
  private requestCount = 0;

  constructor(policy: Partial<NetworkSecurityPolicy> = {}) {
    this.policy = {
      ...DEFAULT_NETWORK_SECURITY_POLICY,
      ...policy,
      allowedProtocols: policy.allowedProtocols
        ? [...policy.allowedProtocols]
        : [...DEFAULT_NETWORK_SECURITY_POLICY.allowedProtocols],
      allowedMethods: policy.allowedMethods
        ? policy.allowedMethods.map((m) => m.toUpperCase())
        : [...DEFAULT_NETWORK_SECURITY_POLICY.allowedMethods],
      blockedHeaders: policy.blockedHeaders
        ? policy.blockedHeaders.map((h) => h.toLowerCase())
        : [...DEFAULT_NETWORK_SECURITY_POLICY.blockedHeaders],
    };
  }

  getPolicy(): NetworkSecurityPolicy {
    return this.policy;
  }

  validateFetchCall(
    rawUrl: string,
    rawOptions?: unknown,
    countAgainstQuota = false
  ): FetchValidationResult {
    if (!this.policy.enabled) {
      return {
        ok: false,
        code: 'NET001',
        reason: 'SecurityError: Network fetch() is disabled by security policy.',
      };
    }

    if (countAgainstQuota) {
      if (this.requestCount >= this.policy.maxRequestsPerRun) {
        return {
          ok: false,
          code: 'NET006',
          reason: `SecurityError: fetch() request limit (${this.policy.maxRequestsPerRun}) exceeded in this execution.`,
        };
      }
      this.requestCount += 1;
    }

    const urlStr = String(rawUrl ?? '').trim();
    if (!urlStr || urlStr.length > this.policy.maxUrlLength) {
      return {
        ok: false,
        code: 'NET001',
        reason: `SecurityError: Invalid or oversized fetch URL (max ${this.policy.maxUrlLength} chars).`,
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return {
        ok: false,
        code: 'NET001',
        reason: `SecurityError: Invalid fetch URL '${urlStr}' (must be an absolute http/https URL).`,
      };
    }

    if (!this.policy.allowedProtocols.includes(parsed.protocol)) {
      return {
        ok: false,
        code: 'NET002',
        reason: `SecurityError: Blocked fetch protocol '${parsed.protocol}' by network security policy.`,
      };
    }

    if (parsed.username || parsed.password) {
      return {
        ok: false,
        code: 'NET005',
        reason: 'SecurityError: Embedded URL credentials are blocked by network security policy.',
      };
    }

    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (this.policy.blockPrivateNetworks && isPrivateOrLoopbackHost(host)) {
      return {
        ok: false,
        code: 'NET003',
        reason: `SecurityError: Access to local/private network host '${parsed.hostname}' is blocked by security policy.`,
      };
    }

    if (parsed.port) {
      const portNum = Number(parsed.port);
      if (
        !Number.isInteger(portNum) ||
        portNum < 1 ||
        portNum > 65535 ||
        (!this.policy.allowDangerousPorts && DANGEROUS_PORTS.has(portNum))
      ) {
        return {
          ok: false,
          code: 'NET003',
          reason: `SecurityError: Blocked restricted port '${parsed.port}' in fetch().`,
        };
      }
    }

    if (this.policy.blockedDomains && this.policy.blockedDomains.length > 0) {
      const blocked = this.policy.blockedDomains.some((d) => {
        const clean = d.toLowerCase().replace(/\.+$/, '');
        return host === clean || host.endsWith('.' + clean);
      });
      if (blocked) {
        return {
          ok: false,
          code: 'NET003',
          reason: `SecurityError: Domain '${parsed.hostname}' is blocked by network policy.`,
        };
      }
    }

    if (this.policy.allowedDomains && this.policy.allowedDomains.length > 0) {
      const allowed = this.policy.allowedDomains.some((d) => {
        const clean = d.toLowerCase().replace(/\.+$/, '');
        return host === clean || host.endsWith('.' + clean);
      });
      if (!allowed) {
        return {
          ok: false,
          code: 'NET003',
          reason: `SecurityError: Domain '${parsed.hostname}' is not in the network allowlist.`,
        };
      }
    }

    const opts =
      rawOptions && typeof rawOptions === 'object'
        ? (rawOptions as Record<string, unknown>)
        : {};

    const method = typeof opts.method === 'string' ? opts.method.trim().toUpperCase() : 'GET';
    if (!this.policy.allowedMethods.includes(method)) {
      return {
        ok: false,
        code: 'NET004',
        reason: `SecurityError: HTTP method '${method}' is blocked by network policy (allowed: ${this.policy.allowedMethods.join(', ')}).`,
      };
    }

    // Block cookies & ambient credentials
    if (this.policy.blockCookies || !this.policy.allowCredentials) {
      if (
        typeof opts.credentials === 'string' &&
        opts.credentials.toLowerCase() !== 'omit'
      ) {
        return {
          ok: false,
          code: 'NET005',
          reason: `SecurityError: fetch() credentials mode '${opts.credentials}' is blocked (cookies/credentials cannot be accessed).`,
        };
      }
    }

    // Sanitize & inspect headers
    const cleanHeaders: Record<string, string> = {};
    if (opts.headers && typeof opts.headers === 'object') {
      const entries =
        opts.headers instanceof Headers
          ? Array.from(opts.headers.entries())
          : Array.isArray(opts.headers)
            ? opts.headers
            : Object.entries(opts.headers as Record<string, unknown>);

      for (const pair of entries) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const k = String(pair[0]).trim();
        const lower = k.toLowerCase();
        if (this.policy.blockedHeaders.includes(lower) || lower.includes('cookie')) {
          return {
            ok: false,
            code: 'NET005',
            reason: `SecurityError: Sensitive header '${k}' is blocked by network security policy (cookies/credentials forbidden).`,
          };
        }
        cleanHeaders[k] = String(pair[1]);
      }
    }

    if ((method === 'GET' || method === 'HEAD') && opts.body !== undefined && opts.body !== null) {
      return {
        ok: false,
        code: 'NET004',
        reason: `SecurityError: Request body is not allowed with HTTP '${method}'.`,
      };
    }

    const sanitizedInit: RequestInit = {
      method,
      headers: cleanHeaders,
      credentials: 'omit',
      redirect: this.policy.maxRedirects === 0 ? 'error' : 'manual',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    };

    if (opts.body !== undefined && opts.body !== null && method !== 'GET' && method !== 'HEAD') {
      sanitizedInit.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }

    return {
      ok: true,
      url: parsed.toString(),
      method,
      sanitizedInit,
    };
  }

  private buildSafeResponse(
    status: number,
    statusText: string,
    url: string,
    rawHeaders: Array<[string, string]>,
    readBoundedText: () => Promise<string>
  ): Response {
    const blockedHeaderSet = new Set(this.policy.blockedHeaders.map((h) => h.toLowerCase()));
    const safeHeaders = new Headers();
    for (const [key, val] of rawHeaders) {
      const lower = key.toLowerCase();
      if (!blockedHeaderSet.has(lower) && !lower.includes('cookie')) {
        safeHeaders.set(key, val);
      }
    }

    const safeResponse = {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      url,
      type: 'cors' as ResponseType,
      redirected: false,
      headers: safeHeaders,
      bodyUsed: false,
      async text() {
        return readBoundedText();
      },
      async json() {
        const txt = await readBoundedText();
        return JSON.parse(txt);
      },
      async arrayBuffer() {
        const txt = await readBoundedText();
        return new TextEncoder().encode(txt).buffer;
      },
      clone() {
        return safeResponse;
      },
    };

    return safeResponse as unknown as Response;
  }

  private async executeNodeDnsPinnedFetch(
    nodeMods: NonNullable<ReturnType<typeof getNodeNetworkBuiltins>>,
    urlString: string,
    init: RequestInit
  ): Promise<Response> {
    const parsed = new URL(urlString);
    const bareHost = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    const timeoutMs = Math.max(250, this.policy.timeoutMs || 5000);
    const maxBytes = this.policy.maxResponseBytes || 524288;

    let pinnedIp: string;
    let pinnedFamily: 4 | 6;

    const ipKind = nodeMods.net.isIP(bareHost);
    if (ipKind === 4 || ipKind === 6) {
      if (this.policy.blockPrivateNetworks && isPrivateOrReservedIp(bareHost)) {
        throw new Error(
          `SecurityError: Access to private/reserved IP '${bareHost}' is blocked by SSRF policy.`
        );
      }
      pinnedIp = bareHost;
      pinnedFamily = ipKind;
    } else {
      const resolved = await new Promise<Array<{ address: string; family: number }>>(
        (resolve, reject) => {
          const dnsTimer = setTimeout(() => {
            reject(new Error(`SecurityError: DNS resolution timed out for '${bareHost}'.`));
          }, Math.min(timeoutMs, 2500));

          nodeMods.dns.lookup(bareHost, { all: true, verbatim: true }, (err, addresses) => {
            clearTimeout(dnsTimer);
            if (err || !Array.isArray(addresses) || addresses.length === 0) {
              reject(
                new Error(
                  `SecurityError: DNS resolution failed for host '${bareHost}'.`
                )
              );
              return;
            }
            resolve(addresses);
          });
        }
      );

      // Fail closed if ANY resolved A/AAAA record points to a private/loopback/metadata IP
      if (this.policy.blockPrivateNetworks) {
        for (const entry of resolved) {
          if (isPrivateOrReservedIp(entry.address)) {
            throw new Error(
              `SecurityError: DNS resolution for '${bareHost}' yielded blocked private/reserved IP '${entry.address}' (DNS rebinding / SSRF protection).`
            );
          }
        }
      }

      const first = resolved[0];
      pinnedIp = first.address;
      pinnedFamily = first.family === 6 ? 6 : 4;
    }

    const transport = parsed.protocol === 'https:' ? nodeMods.https : nodeMods.http;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(reqTimer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const pinnedLookup = (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, address: string, family: number) => void
      ) => {
        cb(null, pinnedIp, pinnedFamily);
      };

      const req = transport.request(
        parsed,
        {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
          lookup: pinnedLookup,
          servername: parsed.protocol === 'https:' && nodeMods.net.isIP(bareHost) === 0 ? bareHost : undefined,
        },
        (res) => {
          const status = res.statusCode ?? 0;

          // Verify connected remote socket IP as second line of defense against rebinding
          const remoteAddr = res.socket?.remoteAddress;
          if (this.policy.blockPrivateNetworks && remoteAddr && isPrivateOrReservedIp(remoteAddr)) {
            res.destroy();
            req.destroy();
            fail(
              new Error(
                `SecurityError: Socket connected to blocked private address '${remoteAddr}'.`
              )
            );
            return;
          }

          // Block HTTP redirects cleanly when maxRedirects === 0
          if (this.policy.maxRedirects === 0 && status >= 300 && status < 400) {
            res.destroy();
            req.destroy();
            fail(
              new Error(
                `SecurityError: HTTP redirect (${status}) blocked by SSRF policy.`
              )
            );
            return;
          }

          const rawLen = res.headers['content-length'];
          const lenStr = Array.isArray(rawLen) ? rawLen[0] : rawLen;
          if (lenStr && Number(lenStr) > maxBytes) {
            res.destroy();
            req.destroy();
            fail(
              new Error(
                `SecurityError: Response size (${lenStr} bytes) exceeds policy limit (${maxBytes} bytes)`
              )
            );
            return;
          }

          const headerPairs: Array<[string, string]> = [];
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            headerPairs.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
          }

          let bodyPromise: Promise<string> | null = null;
          const readBoundedText = (): Promise<string> => {
            if (bodyPromise) return bodyPromise;
            bodyPromise = new Promise<string>((resBody, rejBody) => {
              const chunks: Uint8Array[] = [];
              let total = 0;
              let bodyDone = false;

              res.on('data', (chunk: unknown) => {
                if (bodyDone) return;
                const buf = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
                total += buf.byteLength;
                if (total > maxBytes) {
                  bodyDone = true;
                  res.destroy();
                  req.destroy();
                  rejBody(
                    new Error(
                      `SecurityError: Response stream exceeded policy byte limit (${maxBytes} bytes)`
                    )
                  );
                  return;
                }
                chunks.push(buf);
              });

              res.on('end', () => {
                if (bodyDone) return;
                bodyDone = true;
                clearTimeout(reqTimer);
                const merged = new Uint8Array(total);
                let offset = 0;
                for (const c of chunks) {
                  merged.set(c, offset);
                  offset += c.byteLength;
                }
                resBody(new TextDecoder().decode(merged));
              });

              res.on('error', (err: unknown) => {
                if (bodyDone) return;
                bodyDone = true;
                clearTimeout(reqTimer);
                rejBody(err instanceof Error ? err : new Error(String(err)));
              });
            });
            return bodyPromise;
          };

          if (settled) return;
          settled = true;
          clearTimeout(reqTimer);
          resolve(
            this.buildSafeResponse(
              status,
              res.statusMessage ?? '',
              parsed.toString(),
              headerPairs,
              readBoundedText
            )
          );
        }
      );

      const reqTimer = setTimeout(() => {
        req.destroy(new Error(`SecurityError: fetch() timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on('error', (err: unknown) => {
        fail(err);
      });

      if (typeof init.body === 'string' && init.body.length > 0) {
        req.write(init.body);
      }
      req.end();
    });
  }

  async executeBoundedFetch(
    hostFetch: typeof fetch,
    rawUrl: string,
    rawOptions?: unknown
  ): Promise<Response> {
    const check = this.validateFetchCall(rawUrl, rawOptions, true);
    if (!check.ok) {
      throw new Error(check.reason);
    }

    // In Node.js / Server Worker, enforce DNS resolution validation + pinned socket IP
    const nodeMods = getNodeNetworkBuiltins();
    if (nodeMods) {
      return this.executeNodeDnsPinnedFetch(nodeMods, check.url, check.sanitizedInit);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller && this.policy.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.policy.timeoutMs)
        : null;

    let response: Response;
    try {
      response = await hostFetch(check.url, {
        ...check.sanitizedInit,
        signal: controller?.signal,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`SecurityError: fetch() timed out after ${this.policy.timeoutMs}ms`);
      }
      throw err;
    }
    if (timer) clearTimeout(timer);

    if (this.policy.maxRedirects === 0 && response.status >= 300 && response.status < 400) {
      throw new Error(`SecurityError: HTTP redirect (${response.status}) blocked by SSRF policy.`);
    }

    // Reject oversized Content-Length upfront
    const contentLengthHeader = response.headers?.get?.('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > this.policy.maxResponseBytes) {
      throw new Error(
        `SecurityError: Response size (${contentLengthHeader} bytes) exceeds policy limit (${this.policy.maxResponseBytes} bytes)`
      );
    }

    const maxBytes = this.policy.maxResponseBytes;
    const headerPairs: Array<[string, string]> = [];
    if (response.headers && typeof response.headers.forEach === 'function') {
      response.headers.forEach((val, key) => {
        headerPairs.push([key, val]);
      });
    }

    const readBoundedText = async (): Promise<string> => {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              throw new Error(
                `SecurityError: Response stream exceeded policy byte limit (${maxBytes} bytes)`
              );
            }
            chunks.push(value);
          }
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        return new TextDecoder().decode(merged);
      }

      const txt = await response.text();
      if (new TextEncoder().encode(txt).byteLength > maxBytes) {
        throw new Error(
          `SecurityError: Response text exceeded policy byte limit (${maxBytes} bytes)`
        );
      }
      return txt;
    };

    return this.buildSafeResponse(
      response.status,
      response.statusText,
      response.url || check.url,
      headerPairs,
      readBoundedText
    );
  }
}
