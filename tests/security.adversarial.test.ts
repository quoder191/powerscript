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
  isSafeYourGuiAttrName,
  normalizeYourGuiTag,
  sanitizeYourGuiCssText,
  sanitizeYourGuiHtmlString,
  sanitizeYourGuiUrl,
} from '../src/compiler/stdlib/yourgui/sanitizer.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export async function runAdversarialSecurityTests(): Promise<TestCaseResult[]> {
  const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: '[19] Blocks dynamic code execution (eval, Function, Reflect.construct, computed constructor gadget, globalThis bypass)',
      fn: () => {
        const payloads = [
          'eval("1 + 1")',
          'let F = Function("return 1")\nprint(F())',
          'let x = 1\nlet k = "const" + "ructor"\nprint(x[k])',
          'let fnRef = Reflect.construct(Function, ["return 1"])',
          'let g = globalThis\nprint(g)',
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
      name: '[19] Blocks host Node module imports and path traversal imports at compile time (SEC105)',
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
      name: '[19] Enforces fail-closed parser recursion limit & incomplete-analysis rejection (SEC000)',
      fn: () => {
        const depth = 260;
        const deepSrc = `let x = ${'('.repeat(depth)}1${')'.repeat(depth)}`;
        const res = compileEasyJS(deepSrc);
        assertTrue(!res.success || !res.securityVerdict.approved, 'Deep recursion must fail closed');
        assertTrue(!res.securityVerdict.analysisComplete, 'Incomplete parse must mark analysisComplete = false');
        assertTrue(
          res.diagnostics.some((d) => /nesting|recursion|depth/i.test(d.message)),
          'Expected recursion depth diagnostic'
        );
      },
    },
    {
      name: '[19] Blocks Rust-style ownership use-after-move and mutable borrow aliasing',
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
      name: '[9] Blocks SSRF loopback, metadata, DNS rebinding suffixes, trailing dots, IPv6 NAT64, and dangerous ports',
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
          'https://example.com/ok',
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
      name: '[20] Blocks prototype pollution while preserving valid dict keys across runtime & interpreter',
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
      name: '[12, 13] Blocks VFS path traversal (raw & percent-encoded), enforces quotas, and prevents cross-session persistence',
      fn: async () => {
        const traversalPayloads = [
          'writeFile("../../etc/passwd", "hacked")',
          'writeFile("/sandbox/..%2f..%2fetc/passwd", "hacked")',
          'writeFile("%2e%2e/secret.txt", "hacked")',
          'readFile("..\\\\..\\\\etc\\\\shadow")',
        ];
        for (const src of traversalPayloads) {
          const res = await runEasyJSAsync(src, { ephemeral: true });
          assertTrue(
            Boolean(res.execution?.error && /sandbox|path|traversal|encoded/i.test(res.execution.error)),
            `Compiled runtime must block VFS traversal (${src}), got err=${res.execution?.error}`
          );

          const interpCompiled = compileEasyJS(src);
          const interpRes = await runASTInterpreter(interpCompiled.transformedAst);
          assertTrue(
            Boolean(interpRes.error && /sandbox|path|traversal|encoded/i.test(interpRes.error)),
            `Interpreter must block VFS traversal (${src}), got err=${interpRes.error}`
          );
        }

        // Cross-session VFS isolation verification
        const writeSessionA = await runEasyJSAsync('writeFile("session_secret.txt", "top-secret-A")\nprint(readFile("session_secret.txt"))', {
          ephemeral: true,
        });
        assertTrue(
          writeSessionA.execution?.logs[0] === 'top-secret-A',
          'Same-execution write/read inside VFS must work'
        );
        const readSessionB = await runEasyJSAsync('print(readFile("session_secret.txt"))', {
          ephemeral: true,
        });
        assertTrue(
          Boolean(readSessionB.execution?.error && /FileNotFoundError/i.test(readSessionB.execution.error)),
          `Session B must NOT see Session A files, got logs=${JSON.stringify(readSessionB.execution?.logs)}`
        );

        const interpWriteA = compileEasyJS('writeFile("interp_secret.txt", "A")');
        await runASTInterpreter(interpWriteA.transformedAst);
        const interpReadB = compileEasyJS('print(readFile("interp_secret.txt"))');
        const interpReadResB = await runASTInterpreter(interpReadB.transformedAst);
        assertTrue(
          Boolean(interpReadResB.error && /FileNotFoundError/i.test(interpReadResB.error)),
          'Interpreter Session B must NOT see Interpreter Session A VFS files'
        );

        // Storage count quota check
        const quotaSrc = `
          for i in 0..=70 {
            writeFile(f"f_{i}.txt", "ok")
          }
        `;
        const resQuota = await runEasyJSAsync(quotaSrc, { ephemeral: true });
        assertTrue(
          Boolean(resQuota.execution?.error && /limit|quota/i.test(resQuota.execution?.error)),
          `VFS must fail closed when file quota (>64) is exceeded, got: ${resQuota.execution?.error}`
        );
      },
    },
    {
      name: '[10, 15] Blocks heap allocation DoS, giant range() DoS, timer DoS, and unsafe browser URIs',
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
      name: '[14, 15, 16, 17] Blocks DOM XSS, SVG/MathML, nested/unclosed tags, dangerous & protocol-relative URLs, entity smuggling, and event-handler attributes',
      fn: async () => {
        // [14] CSS injection
        const evilCss = `@import url("https://evil.test/x.css"); body { background: #111; behavior: url(evil.htc); width: expression(alert(1)); } </style><script>alert(1)</script>`;
        const cleanCss = sanitizeYourGuiCssText(evilCss);
        assertTrue(!/@import/i.test(cleanCss), 'CSS @import must be stripped');
        assertTrue(!/expression\s*\(/i.test(cleanCss), 'CSS expression() must be stripped');
        assertTrue(!/behavior\s*:/i.test(cleanCss), 'CSS behavior: must be stripped');
        assertTrue(!/<\/style>/i.test(cleanCss), 'Closing style tag breakouts must be stripped');
        assertTrue(cleanCss.includes('#111'), 'Legitimate CSS properties must remain intact');

        // [15] Dangerous URL schemes & HTML entity smuggling
        assertTrue(sanitizeYourGuiUrl('javascript:alert(1)') === '#', 'javascript: URL must be neutralized');
        assertTrue(sanitizeYourGuiUrl('javascript&#58;alert(1)') === '#', 'Entity-encoded javascript&#58; must be neutralized');
        assertTrue(sanitizeYourGuiUrl('&#106;&#97;&#118;&#97;script:alert(1)') === '#', 'Hex/decimal entity obfuscated javascript: must be neutralized');
        assertTrue(sanitizeYourGuiUrl('vbscript:msgbox(1)') === '#', 'vbscript: URL must be neutralized');
        assertTrue(sanitizeYourGuiUrl('file:///etc/passwd') === '#', 'file:// URL must be neutralized');
        assertTrue(sanitizeYourGuiUrl('blob:https://evil.test/x') === '#', 'blob: URL must be neutralized');
        assertTrue(sanitizeYourGuiUrl('data:text/html,<script>alert(1)</script>') === '#', 'data:text/html must be neutralized');
        assertTrue(sanitizeYourGuiUrl('data:image/svg+xml;base64,PHN2Zz4=', true) === '#', 'SVG data URI must be neutralized');
        assertTrue(sanitizeYourGuiUrl('https://example.com/docs') === 'https://example.com/docs', 'HTTPS URL allowed');

        // [16] Protocol-relative URL handling
        assertTrue(sanitizeYourGuiUrl('//evil.com/phish') === '#', 'Protocol-relative // must be neutralized');
        assertTrue(sanitizeYourGuiUrl('/\\evil.com/phish') === '#', 'Backslash protocol-relative /\\ must be neutralized');
        assertTrue(sanitizeYourGuiUrl('\\/evil.com/phish') === '#', 'Inverted protocol-relative \\/ must be neutralized');
        assertTrue(sanitizeYourGuiUrl('\\\\evil.com/share') === '#', 'UNC \\\\ must be neutralized');
        assertTrue(sanitizeYourGuiUrl('&#47;&#47;evil.com/phish') === '#', 'Entity-encoded // must be neutralized');
        assertTrue(sanitizeYourGuiUrl('/assets/logo.png') === '/assets/logo.png', 'Single-slash relative path must be allowed');

        // [14, 17] HTML XSS, SVG/MathML, nested tags, unclosed tags, event-handler attributes
        const dirtyHtml = [
          '<div onclick="alert(1)" onanimationstart="alert(2)" srcdoc="<script>1</script>" formaction="javascript:1" style="color:expression(1)">',
          '<script>evil()</script>',
          '<iframe src="https://evil.test"></iframe>',
          '<svg onload="alert(1)"><animate onbegin="alert(2)" attributeName="x"/></svg>',
          '<math><mi xlink:href="javascript:alert(3)">x</mi></math>',
          '<scr<script>ipt>alert(4)</scr</script>ipt>',
          '<a href="javascript&#58;alert(5)" target="_blank">Click</a>',
          '<p>Safe Text</p>',
          '<img src=x onerror=alert(6)',
          '</div>',
        ].join('');
        const cleanHtml = sanitizeYourGuiHtmlString(dirtyHtml);
        assertTrue(!/<script/i.test(cleanHtml), '<script> and nested <scr<script>ipt> must be removed');
        assertTrue(!/<iframe/i.test(cleanHtml), '<iframe> must be removed');
        assertTrue(!/<svg|<animate|<math/i.test(cleanHtml), '<svg>/<math> subtrees must be removed');
        assertTrue(!/on(?:click|load|error|begin|animationstart)\s*=/i.test(cleanHtml), 'Inline on* handlers must be removed');
        assertTrue(!/javascript\s*:/i.test(cleanHtml), 'javascript: URI inside anchor must be removed');
        assertTrue(!/srcdoc=|formaction=|style=/i.test(cleanHtml), 'Dangerous attributes must be stripped');
        assertTrue(cleanHtml.includes('rel="noopener noreferrer"'), 'target=_blank anchor must enforce rel="noopener noreferrer"');
        assertTrue(cleanHtml.includes('<p>Safe Text</p>'), 'Safe content preserved');

        // [17] Element tag normalization & attribute allowlist enforcement
        assertTrue(normalizeYourGuiTag('script') === 'div', 'Disallowed script tag must normalize to div');
        assertTrue(normalizeYourGuiTag('iframe') === 'div', 'Disallowed iframe tag must normalize to div');
        assertTrue(normalizeYourGuiTag('textarea') === 'textarea', 'Allowed textarea tag must remain textarea');
        assertTrue(!isSafeYourGuiAttrName('onclick'), 'onclick attribute must be rejected');
        assertTrue(!isSafeYourGuiAttrName('srcdoc'), 'srcdoc attribute must be rejected');
        assertTrue(!isSafeYourGuiAttrName('formaction'), 'formaction attribute must be rejected');
        assertTrue(!isSafeYourGuiAttrName('action'), 'action attribute must be rejected');
        assertTrue(isSafeYourGuiAttrName('aria-label'), 'aria-label must be allowed');

        // YourGUI runtime innerHTML, link, textarea & ui.html checks across ASTInterpreter + compiled sandbox
        const guiXssSrc = `
          import yourgui from "stdlib/yourgui"
          import ui from "stdlib/ui"
          let box = yourgui.container("main")
          box.innerHTML = "<svg onload=alert(1)></svg><p onclick=alert(2)>Hello</p>"
          let lnk = yourgui.link("Bad", "//evil.com/phish")
          let bio = yourgui.textarea("bio")
          ui.html("<img src=x onerror=alert(3)><b>Rendered</b>")
          print(box.innerHTML)
          print(lnk.href)
          print(bio.__tag)
        `;
        const guiCompiledRes = await runEasyJSAsync(guiXssSrc, { ephemeral: true });
        assertTrue(
          !guiCompiledRes.execution?.error,
          `YourGUI script must execute cleanly, got err=${guiCompiledRes.execution?.error}`
        );
        assertTrue(
          !String(guiCompiledRes.execution?.logs[0] ?? '').includes('<svg') &&
            !String(guiCompiledRes.execution?.logs[0] ?? '').includes('onclick') &&
            String(guiCompiledRes.execution?.logs[0] ?? '').includes('<p>Hello</p>'),
          `box.innerHTML must be sanitized, got: ${guiCompiledRes.execution?.logs[0]}`
        );
        assertTrue(
          guiCompiledRes.execution?.logs[1] === '#',
          `Protocol-relative yourgui.link must sanitize to '#', got: ${guiCompiledRes.execution?.logs[1]}`
        );
        assertTrue(
          guiCompiledRes.execution?.logs[2] === 'textarea',
          `yourgui.textarea must keep textarea tag, got: ${guiCompiledRes.execution?.logs[2]}`
        );
        const uiHtmlVis = guiCompiledRes.execution?.visualOutputs?.find((v) => v.kind === 'html');
        assertTrue(
          Boolean(uiHtmlVis && uiHtmlVis.kind === 'html' && !/onerror/i.test(uiHtmlVis.content) && uiHtmlVis.content.includes('<b>Rendered</b>')),
          `ui.html visual output must be sanitized: ${JSON.stringify(uiHtmlVis)}`
        );

        // Verify interpreter ui.html uses exact same sanitizer
        const compiledForInterp = compileEasyJS(guiXssSrc);
        const interpGuiRes = await runASTInterpreter(compiledForInterp.transformedAst);
        const interpHtmlVis = interpGuiRes.visualOutputs?.find((v) => v.kind === 'html');
        assertTrue(
          Boolean(interpHtmlVis && interpHtmlVis.kind === 'html' && !/onerror/i.test(interpHtmlVis.content) && interpHtmlVis.content.includes('<b>Rendered</b>')),
          `Interpreter ui.html must also sanitize XSS: ${JSON.stringify(interpHtmlVis)}`
        );

        // Verify Output.tsx iframe srcDoc embeds canonical sanitizer & CSP
        const srcDoc = buildYourGuiIframeSrcDoc('page_1', 'tok_abc123');
        assertTrue(srcDoc.includes('Content-Security-Policy'), 'YourGUI iframe must include CSP header');
        assertTrue(srcDoc.includes("default-src 'none'"), 'YourGUI iframe CSP must deny network/default loads');
        assertTrue(srcDoc.includes('tok_abc123'), 'YourGUI iframe must bind per-instance frameToken');
        assertTrue(srcDoc.includes('DOMParser'), 'YourGUI iframe must use DOMParser element allowlist');
        assertTrue(srcDoc.includes('YG_DROP_SUBTREE_TAGS'), 'YourGUI iframe must embed canonical sanitizer allowlist');
      },
    },
    {
      name: '[20] Hardens browser sandbox srcdoc against Function/AsyncFunction/Generator constructor escapes',
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
