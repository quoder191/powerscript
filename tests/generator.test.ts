import { compileEasyJS, formatEasyJS, runEasyJS } from '../src/compiler/index.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function runGeneratorTests(): TestCaseResult[] {
  const tests: Array<{ name: string; fn: () => void }> = [
    {
      name: 'Compiles and executes OOP class hierarchy with f-strings',
      fn: () => {
        const src = `
          trait Describable {
            fn describe() -> str
          }
          class Entity {
            pub id: int
            init(id: int) {
              self.id = id
            }
          }
          class Task extends Entity implements Describable {
            pub title: str
            init(id: int, title: str) {
              super(id)
              self.title = title
            }
            pub fn describe() -> str {
              return f"Task #{self.id}: {self.title}"
            }
          }
          let t = new Task(7, "Ship Lexer")
          print(t.describe())
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, 'Expected successful compilation');
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'Task #7: Ship Lexer', 'Expected matching log output');
      },
    },
    {
      name: 'Compiles and executes algebraic enums with pattern matching',
      fn: () => {
        const src = `
          enum Shape {
            Circle(radius),
            Rect(w, h)
          }
          fn area(s) -> float {
            return match s {
              Shape.Circle(r) => 3 * r * r,
              Shape.Rect(w, h) => w * h,
              _ => 0
            }
          }
          print(area(Shape.Rect(4, 5)))
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(out.execution?.logs[0] === '20', `Expected '20', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes smart pointers, borrow, shared refCount, and defer',
      fn: () => {
        const src = `
          fn demo() {
            defer print("deferred cleanup")
            own data = 100
            ref view = &data
            *data = 250
            print(*view)
            shared s1 = share("buffer")
            let s2 = s1.clone()
            print(refCount(s2))
            drop s1
            print(refCount(s2))
          }
          demo()
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === '250', 'Expected deref 250');
        assertTrue(out.execution?.logs[1] === '2', 'Expected refCount 2');
        assertTrue(out.execution?.logs[2] === '1', 'Expected refCount 1 after drop');
        assertTrue(out.execution?.logs[3] === 'deferred cleanup', 'Expected LIFO defer execution');
      },
    },
    {
      name: 'Executes range loops and functional pipelines',
      fn: () => {
        const src = `
          let total = 1..=5 |> filter(fn(n) => n % 2 == 1) |> map(fn(n) => n * 10) |> sum()
          print(total)
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(out.execution?.logs[0] === '90', `Expected '90', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes array, dictionary, Stack, Queue, text, and math operations',
      fn: () => {
        const src = `
          var nums = [20, 3, 10, 3]
          nums.append(5)
          nums.remove(3)
          nums.sort()
          print(join(nums, ","))
          print(nums.find(fn(n) => n > 10))

          dict user = { name: "Alex" }
          user.set("score", 42)
          print(user.get("score"), "name" in user, "zip" not in user)
          user.remove("score")
          print(len(user.keys()))

          stack st = Stack([1, 2])
          st.push(3)
          print(st.pop(), st.peek())

          text raw = "  easyjs  "
          print(raw.trim().upper())
          print((-15).abs(), toInt("7") + 3)
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === '3,5,10,20', `Sorted array mismatch: ${out.execution?.logs[0]}`);
        assertTrue(out.execution?.logs[1] === '20', `Find mismatch: ${out.execution?.logs[1]}`);
        assertTrue(out.execution?.logs[2] === '42 true true', `Dict mismatch: ${out.execution?.logs[2]}`);
        assertTrue(out.execution?.logs[3] === '1', `Dict keys len mismatch: ${out.execution?.logs[3]}`);
        assertTrue(out.execution?.logs[4] === '3 2', `Stack mismatch: ${out.execution?.logs[4]}`);
        assertTrue(out.execution?.logs[5] === 'EASYJS', `String mismatch: ${out.execution?.logs[5]}`);
        assertTrue(out.execution?.logs[6] === '15 10', `Math/toInt mismatch: ${out.execution?.logs[6]}`);
      },
    },
    {
      name: 'Executes interactive input(), inputInt(), and C-style for loops with stdin',
      fn: () => {
        const src = `
          text name = input("Name: ")
          int n = inputInt("Count: ")
          var sum = 0
          for (let i = 1; i <= n; i++) {
            sum += i
          }
          let band = match sum {
            10..=20 => "mid",
            _ => "other"
          }
          print(f"{name}:{sum}:{band}")
        `;
        const out = runEasyJS(src, { stdin: ['Sam', '5'] });
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'Sam:15:mid', `Expected 'Sam:15:mid', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes standard library (Core, System, Stack) and scope isolation',
      fn: () => {
        const src = `
          textVal = uppercase("hello")
          print(textVal, lowercase(textVal), length(textVal))
          print(replace("Hi!", "Hi", "Hello"), join(split("a,b", ","), "-"))
          print(reverse("abc"), contains("hello", "ell"))

          items = [5, 2, 8, 1, 2]
          push(items, 9)
          popped = pop(items)
          sort(items)
          print(popped, join(unique(items), ","), first(items), last(items), find(items, 8))
          print(join(filter(items, fn(n) => n >= 5), ","))
          print(sqrt(25), random(1, 1) == 1)

          arr = stack.array(1, 2, 3)
          d = stack.dict(["a", "b"], [10, 20])
          print(length(arr), d.get("b"))

          writeFile("demo.txt", "EasyJS VFS")
          print(readFile("demo.txt"), deleteFile("demo.txt"))

          scope isolated {
            x = 99
            print(x)
          }
          x = 12
          print(x)
          exit()
          print("should not print")
        `;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compilation success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.haltedByExit === true, 'Expected clean exit() halt');
        assertTrue(out.execution?.logs[0] === 'HELLO hello 5', `String ops mismatch: ${out.execution?.logs[0]}`);
        assertTrue(out.execution?.logs[1] === 'Hello! a-b', `Replace/join mismatch: ${out.execution?.logs[1]}`);
        assertTrue(out.execution?.logs[2] === 'cba true', `Reverse/contains mismatch: ${out.execution?.logs[2]}`);
        assertTrue(out.execution?.logs[3] === '9 1,2,5,8 1 8 8', `Collection ops mismatch: ${out.execution?.logs[3]}`);
        assertTrue(out.execution?.logs[4] === '5,8', `Filter mismatch: ${out.execution?.logs[4]}`);
        assertTrue(out.execution?.logs[5] === '5 true', `Math ops mismatch: ${out.execution?.logs[5]}`);
        assertTrue(out.execution?.logs[6] === '3 20', `Stack lib mismatch: ${out.execution?.logs[6]}`);
        assertTrue(out.execution?.logs[7] === 'EasyJS VFS true', `VFS mismatch: ${out.execution?.logs[7]}`);
        assertTrue(out.execution?.logs[8] === '99', `Scope inner mismatch: ${out.execution?.logs[8]}`);
        assertTrue(out.execution?.logs[9] === '12', `Scope outer mismatch: ${out.execution?.logs[9]}`);
        assertTrue(out.execution?.logs.length === 10, 'Expected exit() to stop before final print');
      },
    },
    {
      name: 'Executes extreme nested if/elif/else chains (12+ levels, mixed colon/braces, inline colons, and constant-if scoping)',
      fn: () => {
        const src = `
fn classify(a, b, c, d, e, f, g, h):
  result = "start"
  if a > 0:
    if b > 0:
      if c > 0:
        if d > 0:
          if e > 0:
            if f > 0:
              if g > 0:
                if h == 1:
                  result = "depth8-h1"
                elif h == 2:
                  result = "depth8-h2"
                elif h == 3: print("inline")
                else:
                  result = "depth8-other"
              elif g == 0 {
                if h > 10:
                  result = "mixed-brace-colon-gt10"
                else:
                  result = "mixed-brace-colon-le10"
              }
              else:
                result = "g-neg"
            elif f == -1:
              result = "f-minus1"
            else:
              result = "f-neg"
          else:
            result = "e-nonpos"
        elif d == 0:
          result = "d-zero"
        else:
          result = "d-neg"
      else:
        result = "c-nonpos"
    elif b == 0:
      result = "b-zero"
    else:
      result = "b-neg"
  elif a == 0:
    result = "a-zero"
  else:
    result = "a-neg"
  return result

# Verify constant-if block scoping with lexical collision safety
if true {
  let x = 100
  print(x)
}
let x = 200
print(x)

print(classify(1, 1, 1, 1, 1, 1, 1, 2))
print(classify(1, 1, 1, 1, 1, 1, 0, 15))
print(classify(1, 1, 1, 1, 1, -1, 1, 1))
print(classify(1, 0, 1, 1, 1, 1, 1, 1))
print(classify(0, 1, 1, 1, 1, 1, 1, 1))
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === '100', `Expected 100, got ${out.execution?.logs[0]}`);
        assertTrue(out.execution?.logs[1] === '200', `Expected 200, got ${out.execution?.logs[1]}`);
        assertTrue(out.execution?.logs[2] === 'depth8-h2', `Expected depth8-h2, got ${out.execution?.logs[2]}`);
        assertTrue(out.execution?.logs[3] === 'mixed-brace-colon-gt10', `Expected mixed-brace-colon-gt10, got ${out.execution?.logs[3]}`);
        assertTrue(out.execution?.logs[4] === 'f-minus1', `Expected f-minus1, got ${out.execution?.logs[4]}`);
        assertTrue(out.execution?.logs[5] === 'b-zero', `Expected b-zero, got ${out.execution?.logs[5]}`);
        assertTrue(out.execution?.logs[6] === 'a-zero', `Expected a-zero, got ${out.execution?.logs[6]}`);
      },
    },
    {
      name: 'Executes multi-level constructors (init/constructor/super), default params, direct calls without new, and colon classes',
      fn: () => {
        const src = `
class Base:
  pub baseVal: int
  constructor(v: int = 10):
    if v < 0:
      self.baseVal = 0
    else:
      self.baseVal = v

class Mid extends Base {
  pub tag: str = "mid"
}

class Leaf extends Mid {
  pub childVal: int
  init(baseV: int, mult: int = 2) {
    super(baseV)
    if mult > 5:
      self.childVal = self.baseVal * mult
    elif mult > 0:
      self.childVal = self.baseVal + mult
    else:
      return
      self.childVal = -1
  }
  pub fn summary() -> str => f"{self.tag}:{self.baseVal}:{self.childVal}"
}

a = new Leaf(15, 6)
b = Leaf(-5, 3)
c = Base()
print(a.summary())
print(b.summary())
print(c.baseVal)
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'mid:15:90', `Expected mid:15:90, got ${out.execution?.logs[0]}`);
        assertTrue(out.execution?.logs[1] === 'mid:0:3', `Expected mid:0:3, got ${out.execution?.logs[1]}`);
        assertTrue(out.execution?.logs[2] === '10', `Expected 10, got ${out.execution?.logs[2]}`);
      },
    },
    {
      name: 'Performs AST optimization, minification, source maps, and formatting',
      fn: () => {
        const src = `
fn unusedHelper() {
  return 999
}
let folded = 2 + 3 * 4
if false {
  print("dead branch")
}
print(folded)
`;
        const compiled = compileEasyJS(src, { minify: true });
        assertTrue(compiled.success, 'Expected success');
        assertTrue(compiled.optimization.foldedConstants >= 1, 'Expected constant folding');
        assertTrue(compiled.optimization.eliminatedBranches >= 1, 'Expected dead branch elimination');
        assertTrue(compiled.optimization.shakenFunctions.includes('unusedHelper'), 'Expected tree shaking');
        assertTrue(compiled.sourceMap.length > 0, 'Expected source map entries');
        assertTrue(!compiled.code.includes('unusedHelper'), 'Unused function should be shaken');

        const formatted = formatEasyJS('if x>0:\n    print("ok")\nelse:\n    print("no")');
        assertTrue(formatted.includes('  print("ok")'), `Expected formatted indent, got:\n${formatted}`);
      },
    },
    {
      name: 'Executes all arrow functions, colon/brace arrow blocks, -> return annotations, match =>, and |> pipelines',
      fn: () => {
        const src = `
double = x => x * 2
addBlock = (a: int, b: int) => {
  total = a + b
  return total * 10
}
blockFn = fn(n) => {
  return n + 5
}
colonArrow = (label) =>:
  up = uppercase(label)
  return "tag:{up}"
fn sq(x: int) -> int => x * x

piped = 1..=6
  |> filter(n => n % 2 == 0)
  |> map(n => n * 3)
  |> sum()

ranked = match 88 {
  90..=100 => "A",
  75..90 => "B",
  _ => "C"
}

print(double(6), addBlock(2, 3), blockFn(4), colonArrow("ok"), sq(7), piped, ranked)
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(
          out.execution?.logs[0] === '12 50 9 tag:OK 49 36 B',
          `Arrow output mismatch: ${out.execution?.logs[0]}`
        );
      },
    },
    {
      name: 'Compiles and runs stdlib/yourgui with style {} block, elements, input() disambiguation, and arrow events',
      fn: () => {
        const src = `
import yourgui from "stdlib/yourgui"
style {
  body { background: #111; color: white; }
  button { background: #2563eb; padding: 12px; }
}
heading("Welcome")
nameInput = input("Enter your name")
agree = checkbox("Subscribe", true)
role = select(["Dev", "Design"])
btn = button("Click Me")
onClick(btn, () => {
  text("Hello {nameInput.value}")
})
print(agree.checked, role.value)
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'true Dev', `Expected checkbox/select state, got ${out.execution?.logs[0]}`);
        const gui = out.execution?.visualOutputs?.find((v) => v.kind === 'yourgui');
        assertTrue(Boolean(gui), 'Expected yourgui visual snapshot');
        if (gui && gui.kind === 'yourgui') {
          assertTrue(gui.styles[0].includes('#111'), 'Expected CSS style preserved');
          assertTrue(gui.nodes.length >= 5, `Expected mounted GUI nodes, got ${gui.nodes.length}`);
        }
      },
    },
    {
      name: 'Executes stdlib/server routes returning object literals from arrow functions',
      fn: () => {
        const src = `
server.get("/ping", req => ({ ok: true, method: req.method }))
server.post("/echo", req => ({ got: req.body }))
server.start(3000)
r1 = server.request("GET", "/ping")
r2 = server.request("POST", "/echo", { name: "Ada" })
r404 = server.request("GET", "/missing")
print(r1.status, r1.body.ok, r2.body.got.name, r404.status)
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(
          Boolean(out.execution?.logs.some((l) => l === '200 true Ada 404')),
          `Expected '200 true Ada 404', got ${JSON.stringify(out.execution?.logs)}`
        );
      },
    },
    {
      name: 'Executes C++ comma for-loops, while, do...while, and OOP constructors (fn init, ClassName, implicit super)',
      fn: () => {
        const src = `
class Base {
  pub x: int
  Base(v: int = 5) {
    self.x = v
  }
}
class Derived extends Base {
  pub y: int = 2
  fn init(y: int) {
    self.y = y
  }
  pub fn sum() => self.x + self.y
}
d = Derived(7)
total = 0
for (i = 1, i <= 4, i++):
  total += i
k = 0
do {
  k += 1
} while (k < 3)
print(d.sum(), total, k)
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === '12 10 3', `Expected '12 10 3', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes YourGUI section DOM manipulation and button built-in methods (.innertext, .push, .pop, .disable, .click)',
      fn: () => {
        const src = `
import yourgui from "stdlib/yourgui"
section("main", () => {
  lbl = text("Init")
  lbl.id = "status"
  btn = button("#action", "Go")
  btn.push("A")
  btn.push("B")
  popped = btn.pop()
  btn.onclick = () => {
    dom("status").innertext = "Clicked:{btn.peek()}:{btn.count()}"
    btn.disable()
    btn.setColor("#ffffff")
  }
  btn.click()
  print(popped, dom("status").innertext, btn.disabled)
})
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(
          out.execution?.logs[0] === 'B Clicked:A:1 true',
          `Expected 'B Clicked:A:1 true', got ${out.execution?.logs[0]}`
        );
      },
    },
    {
      name: 'Executes C++ pointers (int*, int**, &), swap(int&, int&), new[]/delete[], unique_ptr/shared_ptr/weak_ptr, sizeof, and const pointee safety',
      fn: () => {
        const src = `
x = 10
y = 20
int* p = &x
int** pp = &p
*p = 55
fn swap(int& a, int& b):
  t = a
  a = b
  b = t
swap(x, y)
int* arr = new int[3]
arr[0] = 7
arr[1] = 8
arr[2] = 9
s = *(arr + 1)
delete[] arr
u1 = make_unique({ val: 42 })
u2 = std::move(u1)
sh = make_shared(100)
wk = weak_ptr(sh)
locked = wk.lock()
print(x, y, **pp, s, sizeof(int), u2->val, *locked, wk.expired())
`;
        const out = runEasyJS(src);
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(
          out.execution?.logs[0] === '20 55 20 8 4 42 100 false',
          `Pointer output mismatch: ${out.execution?.logs[0]}`
        );

        const constErr = compileEasyJS(`x = 5\nconst int* cp = &x\n*cp = 9`);
        assertTrue(!constErr.success, 'Expected compile error writing through const int*');
      },
    },
  ];

  return tests.map((t) => {
    try {
      t.fn();
      return { suite: 'Generator & Runtime', name: t.name, passed: true };
    } catch (err) {
      return {
        suite: 'Generator & Runtime',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
