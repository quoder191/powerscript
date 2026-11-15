import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function runParserTests(): TestCaseResult[] {
  const tests: Array<{ name: string; fn: () => void }> = [
    {
      name: 'Parses class with visibility modifiers, init, override, and trait implementation',
      fn: () => {
        const src = `
          trait Speakable {
            fn speak() -> str
          }
          class Dog extends Animal implements Speakable {
            pub name: str
            priv energy: int = 100
            init(name: str) {
              super(name)
              self.name = name
            }
            override pub fn speak() -> str {
              return f"{self.name} barks"
            }
          }
        `;
        const lex = tokenize(src);
        const parsed = parse(lex.tokens);
        assertTrue(parsed.diagnostics.length === 0, 'Expected zero parser errors');
        assertTrue(parsed.ast.body.length === 2, 'Expected 2 top-level declarations');
        assertTrue(parsed.ast.body[1].kind === 'ClassDeclaration', 'Expected ClassDeclaration');
      },
    },
    {
      name: 'Parses algebraic enum and match expression',
      fn: () => {
        const src = `
          enum Outcome {
            Ok(value),
            Err(message)
          }
          let res = Outcome.Ok(42)
          let text = match res {
            Ok(v) => f"Got {v}",
            Err(m) => f"Error: {m}",
            _ => "Unknown"
          }
        `;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, 'Expected zero parser errors');
        assertTrue(parsed.ast.body[0].kind === 'EnumDeclaration', 'Expected EnumDeclaration');
      },
    },
    {
      name: 'Parses struct declaration and struct initialization',
      fn: () => {
        const src = `
          struct Vector2 {
            x: float = 0.0,
            y: float = 0.0
          }
          let v = Vector2 { x: 3.0, y: 4.0 }
        `;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, 'Expected zero parser errors');
        assertTrue(parsed.ast.body[0].kind === 'StructDeclaration', 'Expected StructDeclaration');
      },
    },
    {
      name: 'Parses defer, drop, and pipeline expressions',
      fn: () => {
        const src = `
          fn process() {
            own buf = "mem"
            defer print("done")
            let out = [1, 2, 3] |> map(fn(x) => x * 2)
            drop buf
          }
        `;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, 'Expected zero parser errors');
      },
    },
    {
      name: 'Parses var, type-first declarations, C-for loops, and range match patterns',
      fn: () => {
        const src = `
          var total = 0
          int count = 5
          text label = "ok"
          dict cfg = { default: 1, in: true }
          for (let i = 0; i < count; i++) {
            total += i
          }
          let grade = match total {
            90..=100 => "A",
            _ => "B"
          }
          let check = "default" in cfg and "missing" not in cfg
        `;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero parser errors, got: ${JSON.stringify(parsed.diagnostics)}`);
      },
    },
  ];

  return tests.map((t) => {
    try {
      t.fn();
      return { suite: 'Parser', name: t.name, passed: true };
    } catch (err) {
      return {
        suite: 'Parser',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
