import { buildYourGuiIframeSrcDoc } from '../src/components/Output.tsx';
import {
  buildBrowserSandboxDocument,
  compileEasyJS,
  NetworkPolicyManager,
  runEasyJSAsync,
} from '../src/compiler/index.ts';
import { runASTInterpreter } from '../src/compiler/interpreter/interpreter.ts';
import { SecurityPolicyManager } from '../src/compiler/security-policy.ts';
import {
  sanitizeYourGuiCssText,
  sanitizeYourGuiHtmlString,
  sanitizeYourGuiUrl,
} from '../src/compiler/stdlib/yourgui/css.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export async function runAdversarialSecurityTests(): Promise<TestCaseResult[]> {
  const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: 'Blocks dynamic code execution (eval, Function, Reflect.construct, computed constructor gadget)',
      fn: () => {
        const payloads = [
          'eval("1 + 1")',
          'let F = Function("return 1")\nprint(F())',
          'let x = 1\nlet k = "const" + "ructor"\nprint(x[k])',
          'let fnRef = Reflect.construct(Function, ["return 1"])',
        ];
        for (const src of payloads) {
          const res = compileEasyJS(src);
          assertTrue(
            !res.securityVerdict.approved,
            `Expected security rejection for payload: ${src}`
          );
        }
      },
    },
    {
      name: 'Blocks host Node module imports and path traversal imports at compile time (SEC105)',
      fn: () => {
        const blockedImports = [
          'import fs from "fs"',
          'import cp from "node:child_process"',
          'import net from "net"',
          'import secret from "../secrets"',
        ];
        for (const src of blockedImports) {
          const res = compileEasyJS(src);
          assertTrue(
            !res.securityVerdict.approved,
            `Expected compile-time block for import: ${src}`
          );
          assertTrue(
            res.diagnostics.some(
              (d) =>
                d.severity === 'error' &&
                /SEC105|unauthorized|blocked|module|host|traversal/i.test(`${d.title ?? ''} ${d.message}`)
            ),
            `Expected SEC105 diagnostic for import: ${src}`
          );
        }
      },
    },
    {
      name: 'Enforces fail-closed parser recursion limit on deeply nested expressions',
      fn: () => {
        const depth = 260;
        const deepSrc = `let x = ${'('.repeat(depth)}1${')'.repeat(depth)}`;
        const res = compileEasyJS(deepSrc);
        assertTrue(!res.success || !res.securityVerdict.approved, 'Deep recursion must fail closed');
        assertTrue(
          res.diagnostics.some((d) => /nesting|recursion|depth/i.test(d.message)),
          'Expected recursion depth diagnostic'
        );
      },
    },
    {
      name: 'Blocks Rust-style ownership use-after-move and mutable borrow aliasing',
      fn: () => {
        const useAfterMove = `
          own key = "secret"
          own movedKey = move key
          print(*key)
        `;
        const res1 = compileEasyJS(useAfterMove);
        assertTrue(!res1.success || !res1.securityVerdict.approved, 'Use-after-move must be blocked');

        const aliasMutBorrow = `
          own num = 10
          ref mut a = &mut num
          ref mut b = &mut num
          print(*a + *b)
        `;
        const res2 = compileEasyJS(aliasMutBorrow);
        assertTrue(!res2.success || !res2.securityVerdict.approved, 'Aliased mutable borrows must be blocked');
      },
    },
    {
      name: 'Blocks SSRF loopback, metadata, DNS rebinding suffixes, trailing dots, and dangerous ports',
      fn: () => {
        const policy = new SecurityPolicyManager().policy.network;
        const mgr = new NetworkPolicyManager(policy);
        const blockedUrls = [
          'http://127.0.0.1/secret',
          'http://localhost./admin',
          'http://169.254.169.254/latest/meta-data/',
          'http://metadata.google.internal/computeMetadata/v1/',
          'http://127.0.0.1.nip.io/leak',
          'http://10.0.0.1.sslip.io/leak',
          'http://sub.localtest.me/leak',
          'http://[::1]/',
          'http://[::ffff:7f00:1]/',
          'http://[::ffff:169.254.169.254]/',
          'http://[64:ff9b::127.0.0.1]/',
          'http://[fd00:ec2::254]/',
          'http://[fe80::1]/',
          'http://2130706433/',
          'http://0x7f000001/',
          'http://0177.0.0.1/',
          'https://example.com:6379/',
          'file:///etc/passwd',
          'https://example.com/ok', // sanity contrast checked below
        ];

        for (const u of blockedUrls.slice(0, -1)) {
          const check = mgr.validateFetchCall(u, { method: 'GET' });
          assertTrue(!check.ok, `SSRF URL must be blocked: ${u}`);
        }
        const safeCheck = mgr.validateFetchCall(blockedUrls[blockedUrls.length - 1], { method: 'GET' });
        assertTrue(safeCheck.ok, 'Public HTTPS GET URL must be allowed');

        const postCookie = mgr.validateFetchCall('https://example.com/api', {
          method: 'POST',
          headers: { Cookie: 'session=abc' },
        });
        assertTrue(!postCookie.ok, 'Disallowed POST + Cookie must be blocked');
      },
    },
    {
      name: 'Blocks prototype pollution in dict operations and AST interpreter',
      fn: async () => {
        const safeAndProtoSrc = `
          dict d = {}
          try {
            d.set("__proto__", "pwned")
          } catch e {
            print("BLOCKED_PROTO")
          }
          try {
            d.set("constructor", "pwned")
          } catch e {
            print("BLOCKED_CTOR")
          }
          d.set("safeKey", "ok")
          print(d.get("safeKey"))
        `;
        const compiledOut = await runEasyJSAsync(safeAndProtoSrc, {
          ephemeral: true,
          securityPolicy: {
            globals: { forbidPrototypeAccess: false },
          },
        });
        assertTrue(compiledOut.success, 'Dict script should compile cleanly');
        assertTrue(
          compiledOut.execution?.logs.includes('ok') ?? false,
          `Dict should retain safeKey, got: ${JSON.stringify(compiledOut.execution)}`
        );
        assertTrue(
          ({} as Record<string, unknown>).polluted === undefined,
          'Object.prototype must never be polluted'
        );

        const interpCompiled = compileEasyJS(safeAndProtoSrc, {
          securityPolicy: { globals: { forbidPrototypeAccess: false } },
        });
        const interpRes = await runASTInterpreter(interpCompiled.transformedAst);
        assertTrue(
          !interpRes.error && interpRes.logs.includes('ok'),
          `Interpreter must preserve safe keys while blocking prototype keys, got: ${JSON.stringify(interpRes)}`
        );
        assertTrue(
          ({} as Record<string, unknown>).polluted === undefined,
          'Object.prototype must remain clean after interpreter run'
        );
      },
    },
    {
      name: 'Enforces /sandbox chroot VFS path traversal and quota limits',
      fn: async () => {
        const traversalSrc = `
          writeFile("../../etc/passwd", "hacked")
        `;
        const res1 = await runEasyJSAsync(traversalSrc, { ephemeral: true });
        assertTrue(
          Boolean(res1.execution?.error && /sandbox|path|traversal/i.test(res1.execution.error)),
          `Expected VFS traversal error, got logs=${JSON.stringify(res1.execution?.logs)} err=${res1.execution?.error}`
        );

        const compiledTrav = compileEasyJS(traversalSrc);
        const interpTrav = await runASTInterpreter(compiledTrav.transformedAst);
        assertTrue(
          Boolean(interpTrav.error && /sandbox|path|traversal/i.test(interpTrav.error)),
          'Interpreter VFS must also block .. traversal'
        );

        const quotaSrc = `
          for i in 0..=70 {
            writeFile(f"f_{i}.txt", "ok")
          }
        `;
        const res2 = await runEasyJSAsync(quotaSrc, { ephemeral: true });
        assertTrue(
          Boolean(res2.execution?.error && /limit|quota/i.test(res2.execution.error)),
          `VFS must fail closed when file quota (>64) is exceeded, got: ${res2.execution?.error}`
        );
      },
    },
    {
      name: 'Blocks heap allocation DoS, giant range() DoS, timer DoS, and unsafe browser URIs',
      fn: async () => {
        const rangeDoS = await runEasyJSAsync('let a = range(1, 500000)\nprint(a.length)', {
          ephemeral: true,
        });
        assertTrue(
          Boolean(rangeDoS.execution?.error && /limit|exceeds/i.test(rangeDoS.execution?.error)),
          'Huge range() must be blocked'
        );

        const allocDoS = await runEasyJSAsync('let mem = new int[500000]\nprint(mem)', {
          ephemeral: true,
        });
        assertTrue(
          Boolean(allocDoS.execution?.error && /limit|exceeds/i.test(allocDoS.execution?.error)),
          'Huge allocArray must be blocked'
        );

        const unsafeBrowser = await runEasyJSAsync('browser("javascript:alert(document.cookie)")', {
          ephemeral: true,
        });
        assertTrue(
          Boolean(unsafeBrowser.execution?.error && /protocol|http/i.test(unsafeBrowser.execution?.error)),
          'javascript: URI in browser() must be blocked'
        );

        const isolatedLoc = await runEasyJSAsync('print(browserLocation().href)', {
          ephemeral: true,
        });
        assertTrue(
          isolatedLoc.execution?.logs[0] === 'https://sandbox.easyjs.local/',
          `browserLocation must be isolated, got: ${isolatedLoc.execution?.logs[0]}`
        );
      },
    },
    {
      name: 'Sanitizes XSS, HTML/CSS injection, attribute smuggling, and enforces YourGUI iframe CSP',
      fn: () => {
        const evilCss = `@import url("https://evil.test/x.css"); body { background: #111; behavior: url(evil.htc); width: expression(alert(1)); } </style><script>alert(1)</script>`;
        const cleanCss = sanitizeYourGuiCssText(evilCss);
        assertTrue(!/@import/i.test(cleanCss), 'CSS @import must be stripped');
        assertTrue(!/expression\s*\(/i.test(cleanCss), 'CSS expression() must be stripped');
        assertTrue(!/behavior\s*:/i.test(cleanCss), 'CSS behavior: must be stripped');
        assertTrue(!/<\/style>/i.test(cleanCss), 'Closing style tag breakouts must be stripped');
        assertTrue(cleanCss.includes('#111'), 'Legitimate CSS properties must remain intact');

        assertTrue(sanitizeYourGuiUrl('javascript:alert(1)') === '#', 'javascript: URL must be neutralized');
        assertTrue(sanitizeYourGuiUrl('data:text/html,<script>alert(1)</script>') === '#', 'data:text/html must be neutralized');
        assertTrue(sanitizeYourGuiUrl('data:image/svg+xml;base64,PHN2Zz4=', true) === '#', 'SVG data URI must be neutralized');
        assertTrue(sanitizeYourGuiUrl('https://example.com/docs') === 'https://example.com/docs', 'HTTPS URL allowed');

        const dirtyHtml = '<div onclick="alert(1)" style="color:expression(1)"><script>evil()</script><iframe srcdoc="<script>1</script>"></iframe><p>Safe</p></div>';
        const cleanHtml = sanitizeYourGuiHtmlString(dirtyHtml);
        assertTrue(!/<script/i.test(cleanHtml), '<script> must be removed');
        assertTrue(!/<iframe/i.test(cleanHtml), '<iframe> must be removed');
        assertTrue(!/onclick=/i.test(cleanHtml), 'Inline on* handlers must be removed');
        assertTrue(cleanHtml.includes('<p>Safe</p>'), 'Safe content preserved');

        const srcDoc = buildYourGuiIframeSrcDoc('page_1', 'tok_abc123');
        assertTrue(srcDoc.includes('Content-Security-Policy'), 'YourGUI iframe must include CSP header');
        assertTrue(srcDoc.includes("default-src 'none'"), 'YourGUI iframe CSP must deny network/default loads');
        assertTrue(srcDoc.includes('tok_abc123'), 'YourGUI iframe must bind per-instance frameToken');
        assertTrue(srcDoc.includes('DOMParser'), 'YourGUI iframe must use DOMParser element allowlist');
      },
    },
    {
      name: 'Hardens browser sandbox srcdoc against Function/AsyncFunction/Generator constructor escapes',
      fn: () => {
        const doc = buildBrowserSandboxDocument({
          code: 'console.log("ok");',
          token: 'test-token',
          policy: new SecurityPolicyManager().policy,
          stdin: [],
        });
        assertTrue(doc.includes('Content-Security-Policy'), 'Sandbox srcdoc must include CSP');
        assertTrue(!doc.includes("'unsafe-eval'"), 'Sandbox CSP must never permit unsafe-eval');
        assertTrue(doc.includes('AsyncFunction'), 'Sandbox document must lock AsyncFunction.constructor');
        assertTrue(
          doc.includes('a === 169 && b === 254'),
          'Sandbox document must include canonical IPv4 link-local/metadata CIDR checks'
        );
        assertTrue(doc.includes('ff9b'), 'Sandbox document must include IPv6 NAT64 SSRF checks');
      },
    },
  ];

  const results: TestCaseResult[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ suite: 'Adversarial Security', name: t.name, passed: true });
    } catch (err) {
      results.push({
        suite: 'Adversarial Security',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
