import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { transform } from '../src/compiler/transformer/transformer.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function runTransformerTests(): TestCaseResult[] {
  const tests: Array<{ name: string; fn: () => void }> = [
    {
      name: 'Detects use-after-move static ownership violation',
      fn: () => {
        const src = `
          own box = 99
          own movedBox = move box
          print(*box)
        `;
        const res = transform(parse(tokenize(src).tokens).ast);
        assertTrue(
          res.diagnostics.some((d) => d.message.includes('moved pointer')),
          'Expected use-after-move diagnostic'
        );
      },
    },
    {
      name: 'Detects use-after-drop and double-drop violations',
      fn: () => {
        const src = `
          own ptr = "secret"
          drop ptr
          drop ptr
        `;
        const res = transform(parse(tokenize(src).tokens).ast);
        assertTrue(
          res.diagnostics.some((d) => d.message.includes('Double drop')),
          'Expected double-drop diagnostic'
        );
      },
    },
    {
      name: 'Validates trait implementation requirements on classes',
      fn: () => {
        const src = `
          trait Serializable {
            fn toJson() -> str
          }
          class User implements Serializable {
            pub name: str
          }
        `;
        const res = transform(parse(tokenize(src).tokens).ast);
        assertTrue(
          res.diagnostics.some((d) => d.message.includes("does not implement required method 'toJson()'")),
          'Expected missing trait method error'
        );
      },
    },
    {
      name: 'Desugars pipeline operator into nested call expression',
      fn: () => {
        const src = `
          let nums = [1, 2, 3] |> map(fn(x) => x + 1)
        `;
        const res = transform(parse(tokenize(src).tokens).ast);
        assertTrue(res.diagnostics.length === 0, 'Expected zero diagnostics');
        const varDecl = res.ast.body[0];
        assertTrue(varDecl.kind === 'VarDeclaration', 'Expected VarDeclaration');
        if (varDecl.kind === 'VarDeclaration') {
          assertTrue(varDecl.initializer?.kind === 'CallExpression', 'Expected desugared CallExpression');
        }
      },
    },
    {
      name: 'Auto-declares bare assignments within current scope and isolates scope blocks',
      fn: () => {
        const src = `
          items = [5, 2, 8]
          scope local {
            secret = 42
          }
        `;
        const res = transform(parse(tokenize(src).tokens).ast);
        assertTrue(res.diagnostics.length === 0, 'Expected zero diagnostics');
        assertTrue(res.ast.body[0].kind === 'VarDeclaration', 'Bare assignment should promote to VarDeclaration');
        assertTrue(res.symbols.some((s) => s.name === 'items' && s.scopeDepth === 0), 'items in scope 0');
        assertTrue(res.symbols.some((s) => s.name === 'secret' && s.scopeDepth === 1), 'secret isolated in scope 1');
      },
    },
  ];

  return tests.map((t) => {
    try {
      t.fn();
      return { suite: 'Transformer', name: t.name, passed: true };
    } catch (err) {
      return {
        suite: 'Transformer',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
