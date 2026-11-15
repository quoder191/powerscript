import { runEasyJS } from '../src/compiler/index.ts';
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
