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
    {
      name: 'Parses multi-var, union/optional types, arrow functions, repeat loops, and colon blocks',
      fn: () => {
        const src = `
import math from "stdlib/math"
var a = 10, b = 20
var mixed: number or string = 42
var maybe: string? = null
if a + b > 20:
  repeat 2 times:
    print("Hello {a}")
elif a == 10:
  print("ten")
else:
  print("other")
add = (x, y) => x + y
double = x => x * 2
res = a > 5 ? "yes" : "no"
`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero errors, got: ${JSON.stringify(parsed.diagnostics)}`);
      },
    },
    {
      name: 'Parses extreme nested if/elif/else, mixed brace/colon blocks, empty blocks, and colon-indented class constructors',
      fn: () => {
        const src = `
class NestedTest:
  pub label: str
  constructor(label: str):
    if label == "a":
      if true {
        if false: print("nope")
        elif 1 == 1: print("deep")
        else: print("else")
      }
    elif label == "b":
      print("b")
    else:
      print("c")
    self.label = label
if ok {} elif alt {} else {}
`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero errors, got: ${JSON.stringify(parsed.diagnostics)}`);
      },
    },
    {
      name: 'Reports friendly missing-colon error message with caret location',
      fn: () => {
        const src = `if age > 18\n  print("Adult")`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length > 0, 'Expected parser diagnostic');
        assertTrue(
          parsed.diagnostics[0].message.includes("You forgot ':'"),
          `Expected friendly colon message, got: ${parsed.diagnostics[0].message}`
        );
      },
    },
    {
      name: 'Parses style {} blocks and all arrow forms (expr, brace block, colon block, fn => block, ->, |>)',
      fn: () => {
        const src = `
import yourgui from "stdlib/yourgui"
style {
  body { background: #111; color: white; }
}
double = x => x * 2
add = (a, b) => {
  s = a + b
  return s
}
fn blockFn(x) => {
  y = x + 1
  return y
}
fn sq(x: int) -> int => x * x
colonArrow = (n) =>:
  k = n * 3
  return k
out = [1, 2, 3] |> filter(x => x > 1) |> sum()
`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero parser errors, got: ${JSON.stringify(parsed.diagnostics)}`);
        assertTrue(parsed.ast.body.some((s) => s.kind === 'StyleStatement'), 'Expected StyleStatement AST');
      },
    },
    {
      name: 'Parses colon-indented blocks nested inside braced callbacks in call arguments',
      fn: () => {
        const src = `
container({ className: "card" }, () => {
    nameInput = input("Enter name")
    onInput(nameInput, fn() {
        if nameInput.value != "":
            print("Typing:", nameInput.value)
    })
})
wrapper(fn() {
    if true:
        print("single-arg-callback")
})
`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero parser errors, got: ${JSON.stringify(parsed.diagnostics)}`);
      },
    },
    {
      name: 'Terminates immediately with diagnostics on stray delimiters and broken indented blocks',
      fn: () => {
        const brokenInputs = [
          '}}',
          'if x:\n',
          'fn f() {\n    if x:\n',
          'container(() => {\n  if x:\n',
          ')))}}}',
        ];
        for (const bad of brokenInputs) {
          const parsed = parse(tokenize(bad).tokens);
          assertTrue(
            parsed.diagnostics.length > 0,
            `Expected diagnostics for malformed input: ${JSON.stringify(bad)}`
          );
        }
      },
    },
    {
      name: 'Parses comma C++ for-loops, while, do...while, and OOP constructor variants (fn init, ClassName)',
      fn: () => {
        const src = `
class Counter {
  int val = 0
  Counter(v: int = 1) {
    self.val = v
  }
}
class SubCounter extends Counter {
  fn init(v: int) {
    super(v)
  }
}
for (i = 0, i < 5, i++):
  print(i)
while n > 0:
  n -= 1
do {
  n += 1
} while (n < 3)
`;
        const parsed = parse(tokenize(src).tokens);
        assertTrue(parsed.diagnostics.length === 0, `Expected zero parser errors, got: ${JSON.stringify(parsed.diagnostics)}`);
      },
    },
    {
      name: 'Parses complete C++ pointer, reference (&), new[]/delete[], arrow ->, sizeof, and smart pointer syntax',
      fn: () => {
        const src = `
x = 10
int* p = &x
int** pp = &p
const int* cp = &x
int& refX = x
int* nullP = nullptr
fn swap(int& a, int& b):
  t = a
  a = b
  b = t
int* arr = new int[4]
arr[0] = 10
val = *(arr + 1)
sz = sizeof(int)
delete[] arr
u = make_unique({ k: 1 })
v = u->k
u2 = std::move(u)
unique_ptr<int> up = make_unique(5)
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
