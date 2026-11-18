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
  445, 465, 587, 636, 993, 995, 1433, 1521, 2049, 2375, 2376, 3306,
  3389, 5432, 5900, 6379, 8086, 9200, 11211, 27017,
]);

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host === 'ip6-localhost' ||
    host === 'ip6-loopback' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home')
  ) {
    return true;
  }

  // Block pure integer / hex / octal IP representations (e.g., 2130706433, 0x7f000001)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }

  // IPv4 check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Link-local / Cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  // IPv6 private/loopback/mapped checks
  if (host.includes(':')) {
    if (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.') ||
      host.startsWith('::ffff:169.254.') ||
      host.startsWith('::ffff:0.')
    ) {
      return true;
    }
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

    const host = parsed.hostname.toLowerCase();
    if (this.policy.blockPrivateNetworks && isPrivateOrLoopbackHost(host)) {
      return {
        ok: false,
        code: 'NET003',
        reason: `SecurityError: Access to local/private network host '${parsed.hostname}' is blocked by security policy.`,
      };
    }

    if (parsed.port) {
      const portNum = Number(parsed.port);
      if (!this.policy.allowDangerousPorts && DANGEROUS_PORTS.has(portNum)) {
        return {
          ok: false,
          code: 'NET003',
          reason: `SecurityError: Blocked restricted port '${parsed.port}' in fetch().`,
        };
      }
    }

    if (this.policy.blockedDomains && this.policy.blockedDomains.length > 0) {
      const blocked = this.policy.blockedDomains.some(
        (d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase())
      );
      if (blocked) {
        return {
          ok: false,
          code: 'NET003',
          reason: `SecurityError: Domain '${parsed.hostname}' is blocked by network policy.`,
        };
      }
    }

    if (this.policy.allowedDomains && this.policy.allowedDomains.length > 0) {
      const allowed = this.policy.allowedDomains.some(
        (d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase())
      );
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
        if (this.policy.blockedHeaders.includes(lower)) {
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

  async executeBoundedFetch(
    hostFetch: typeof fetch,
    rawUrl: string,
    rawOptions?: unknown
  ): Promise<Response> {
    const check = this.validateFetchCall(rawUrl, rawOptions, true);
    if (!check.ok) {
      throw new Error(check.reason);
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

    // Reject oversized Content-Length upfront
    const contentLengthHeader = response.headers?.get?.('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > this.policy.maxResponseBytes) {
      throw new Error(
        `SecurityError: Response size (${contentLengthHeader} bytes) exceeds policy limit (${this.policy.maxResponseBytes} bytes)`
      );
    }

    // Wrap response so cookies / sensitive response headers are stripped and body size is strictly bounded
    const maxBytes = this.policy.maxResponseBytes;
    const blockedHeaderSet = new Set(this.policy.blockedHeaders.map((h) => h.toLowerCase()));
    const rawHeaders = response.headers;

    const safeHeaders = new Headers();
    if (rawHeaders && typeof rawHeaders.forEach === 'function') {
      rawHeaders.forEach((val, key) => {
        const lower = key.toLowerCase();
        if (!blockedHeaderSet.has(lower) && !lower.includes('cookie')) {
          safeHeaders.set(key, val);
        }
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

    const safeResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || check.url,
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
}
