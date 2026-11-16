import { useMemo, useState } from 'react';
import { Check, Copy, Play, Search } from 'lucide-react';

type GuideCategory =
  | 'all'
  | 'fundamentals'
  | 'arrows'
  | 'control-oop'
  | 'pointers'
  | 'stdlib'
  | 'yourgui';

interface GuideChapter {
  id: string;
  number: string;
  category: Exclude<GuideCategory, 'all'>;
  categoryLabel: string;
  title: string;
  summary: string;
  highlights: string[];
  code: string;
}

const CATEGORIES: Array<{ id: GuideCategory; label: string }> = [
  { id: 'all', label: 'All Chapters' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'arrows', label: 'Arrows & Pipelines' },
  { id: 'control-oop', label: 'Control Flow & OOP' },
  { id: 'pointers', label: 'Smart Pointers' },
  { id: 'stdlib', label: 'Standard Library' },
  { id: 'yourgui', label: 'YourGUI Websites' },
];

const CHAPTERS: GuideChapter[] = [
  {
    id: 'variables-types-scope',
    number: '01',
    category: 'fundamentals',
    categoryLabel: 'Fundamentals',
    title: 'Variables, Auto-Types, Unions, Optional & Scope',
    summary:
      'PowerScript (EasyJS) lets you declare variables with bare assignment (name = "Alex"), var/let, const, or type-first declarations (int x = 10). Supports union types (number or string), nullable optionals (string?), multi-declarations, and isolated scope { } blocks.',
    highlights: [
      'Bare assignment: score = 100 (auto-creates mutable binding in current scope)',
      'Multi-declaration: var a = 10, b = 20 or let x: int = 1, y: float = 2.5',
      'Union & Optional types: var id: int or string = "U1", var bio: string? = null',
      'Isolated execution blocks: scope localEnv { ... } prevent variable leakage outside',
    ],
    code: `# Variables, Type Annotations, Unions & Scope Isolation
name = "Alex"                     # auto-detected mutable string
var a = 10, b = 20                # multi-variable declaration
const PI: float = 3.14159         # immutable constant
int count = 5                     # type-first syntax
var userId: int or string = "A-7" # union type
var bio: string? = null           # optional nullable type

scope secretZone {
  token = "inner-991"
  print("Inside scope:", token)
}

token = "outer-safe"
print("Outer:", name, a + b, PI, userId, bio, token)`,
  },
  {
    id: 'strings-multiline',
    number: '02',
    category: 'fundamentals',
    categoryLabel: 'Fundamentals',
    title: 'Strings, Interpolation & Multiline Text Functions',
    summary:
      'Embed expressions directly inside double/single-quoted strings or explicit f-strings with {expr}. Triple quotes (""") handle multiline text cleanly without manual newline escaping.',
    highlights: [
      'Interpolation: "Hello {name}! Next = {age + 1}" or f"Sum = {2 + 3}"',
      'Multiline strings: """Line 1\\nLine 2""" or backtick templates',
      'Core string functions: uppercase(), lowercase(), length(), replace(), split(), join(), reverse(), contains()',
    ],
    code: `who = "PowerScript"
greeting = "Welcome to {who}! 2 + 3 = {2 + 3}"
poem = """Line one of {who}
Line two stays formatted cleanly."""

print(greeting)
print(poem)
print("Upper:", uppercase("hello"), "| Lower:", lowercase("WORLD"))
print("Length:", length(who), "| Replace:", replace("Hi JS", "JS", "PowerScript"))
parts = split("red,green,blue", ",")
print("Joined:", join(parts, " - "), "| Reversed:", reverse("abc"))
print("Contains 'Script':", contains(who, "Script"))`,
  },
  {
    id: 'arrow-functions-complete',
    number: '03',
    category: 'arrows',
    categoryLabel: 'Arrows & Pipelines',
    title: 'Arrow Functions (=>): Single-Line, Brace Blocks & Colon Blocks',
    summary:
      'PowerScript supports concise JavaScript-inspired arrow functions across expression bodies, multi-statement brace blocks () => { ... }, colon-indented blocks () =>:, and typed fn(...) => signatures. Closures capture enclosing variables automatically.',
    highlights: [
      'Implicit return expression: double = x => x * 2  |  add = (a, b) => a + b',
      'No-arg & multi-statement brace block: logSum = (a, b) => { res = a + b; return res }',
      'Colon-indented arrow block: run = () =>: (indented lines below colon)',
      'Typed fn expression & return arrow: fn sq(x: int) -> int => x * x',
      'Returning a dict from an expression arrow: wrap in parens x => ({ id: x })',
    ],
    code: `# 1. Single-parameter and parenthesized expression arrows (implicit return)
double = x => x * 2
add = (a: int, b: int) => a + b
makeUser = id => ({ id: id, role: "member" })

# 2. Multi-statement brace arrow block () => { ... }
computeStats = (nums) => {
  total = sum(nums)
  avg = total / length(nums)
  return { total: total, avg: avg }
}

# 3. Colon-indented arrow block () =>:
announce = (label) =>:
  upper = uppercase(label)
  print("Arrow colon block:", upper)
  return upper

# 4. Typed fn declaration with both return arrow (->) and fat arrow (=>)
fn square(n: int) -> int => n * n

# 5. Arrow helper with default parameter
greet = (who = "Builder") => "Hi, {who}!"

print("double(7):", double(7), "| add(4, 9):", add(4, 9))
print("makeUser(5):", makeUser(5))
print("stats:", computeStats([10, 20, 30]))
announce("powerscript")
print("square(8):", square(8), "| greet():", greet())`,
  },
  {
    id: 'arrow-pipeline-return-match',
    number: '04',
    category: 'arrows',
    categoryLabel: 'Arrows & Pipelines',
    title: 'Pipeline Arrow (|>), Return Type Arrow (->) & Match Arms (=>)',
    summary:
      'Beyond lambdas, PowerScript uses two more arrow operators: |> streams a value left-to-right into the next function or arrow callback (inserting it as the 1st argument), while -> annotates return types on functions and methods, and => maps match patterns.',
    highlights: [
      'Pipeline |gt;: val |> fn(arg2) desugars to fn(val, arg2); val |> arrowFn calls arrowFn(val)',
      'Multiline pipeline chaining works cleanly across lines: data |> filter(...) |> map(...) |> sort()',
      'Return type arrow ->: fn load(id: int) -> string? checks static return consistency',
      'Match arm arrow =>: pattern => expr or pattern => { block }',
    ],
    code: `# Functional Data Pipeline (|>) feeding arrow callbacks & stdlib functions
scores = 1..=8
  |> filter(n => n % 2 == 0)
  |> map(n => n * 10)
  |> reverse()
  |> join(" -> ")

print("Pipeline:", scores)

# Piping into single-value transforms or named functions
clean = "  PowerScript Rocks  " |> trim() |> uppercase()
print("Cleaned:", clean)

# Return-type arrow (->) on a typed function using match arm arrows (=>)
fn classifyScore(s: int) -> string {
  return match s {
    90..=100 => "Mastery",
    70..90 => "Proficient",
    _ => {
      return "Practicing"
    }
  }
}

print("Rank 94:", classifyScore(94), "| Rank 78:", classifyScore(78))`,
  },
  {
    id: 'conditionals-loops',
    number: '05',
    category: 'control-oop',
    categoryLabel: 'Control Flow & OOP',
    title: 'Conditionals, C++ Comma For-Loops, While & Do-While',
    summary:
      'Mix colon-indented (:), braced ({}), or inline single-line blocks at any nesting depth. Supports Pythonic for-in ranges, repeat N times:, C++-style comma/semicolon for loops (for (i = 0, i < n, i++): ...), while loops, and do...while loops.',
    highlights: [
      'C++-style comma or semicolon for loops: for (i = 0, i < 5, i++): print(i)',
      'while and do...while loops: while cond: ... and do { ... } while (cond)',
      'Membership tests: "key" in dict and "missing" not in list',
    ],
    code: `fn triage(level: int, active: bool, flag: string) -> string:
  if active:
    if level > 80:
      if flag == "vip": return "Priority-Alpha"
      else: return "Priority-Other"
    else: return "Standard"
  else:
    return "Inactive"

print(triage(95, true, "vip"), triage(60, true, "x"))

# C++-style comma-separated for loop
sumComma = 0
for (i = 1, i <= 4, i++):
  sumComma += i

# While & do...while loops
n = 3
while n > 0:
  n -= 1

steps = 0
do {
  steps += 1
} while (steps < 2)

print("sumComma:", sumComma, "| steps:", steps)`,
  },
  {
    id: 'oop-constructors-enums-structs',
    number: '06',
    category: 'control-oop',
    categoryLabel: 'Control Flow & OOP',
    title: 'Classes, Constructors (init / constructor / C++ ClassName / super)',
    summary:
      'Full OOP with single inheritance (extends), interfaces/traits (implements), visibility modifiers (pub, priv, prot), init or constructor or C++ ClassName(...) constructors, super(...) / super.method(), static members, and direct or new instantiation.',
    highlights: [
      'Define constructors via init(...), constructor(...), fn init(...), or ClassName(...)',
      'Instantiate with or without new: Dog("Rex") or new Dog("Rex")',
      'Algebraic enums with payloads (enum Result { Ok(v), Err(msg) }) and cloneable structs',
    ],
    code: `interface Printable {
  fn label() -> string
}

enum Tier {
  Free,
  Pro(seats)
}

class Account:
  pub owner: string
  constructor(owner: string = "Guest"):
    self.owner = owner
  pub fn badge() -> string => "Account({self.owner})"

class WorkspaceAccount extends Account implements Printable {
  pub tier: Tier
  init(owner: string, tier: Tier) {
    super(owner)
    self.tier = tier
  }
  override pub fn badge() -> string {
    return "{super.badge()} :: Workspace"
  }
  pub fn label() -> string {
    return match self.tier {
      Tier.Pro(n) => "{self.owner} [Pro x{n}]",
      _ => "{self.owner} [Free]"
    }
  }
}

acc = WorkspaceAccount("Maya", Tier.Pro(5))
print(acc.badge())
print(acc.label())`,
  },
  {
    id: 'smart-pointers',
    number: '07',
    category: 'pointers',
    categoryLabel: 'Smart Pointers',
    title: 'C++ Pointers, References (&), Heap new/delete & Ownership',
    summary:
      'PowerScript supports full C++ pointer & memory syntax (without semicolons) alongside rule pointers (own/ref/shared): int* p = &x, int** pp, int& ref aliases, swap(int& a, int& b), new T[n]/delete[], p->member, p[i], sizeof, p.addr / p.location, and unique_ptr / shared_ptr / weak_ptr.',
    highlights: [
      'Raw & multi-level pointers: int* p = &x, int** pp = &p, const int* cp, nullptr, *p = val',
      'Pass-by-reference & aliases: int& r = x, fn swap(int& a, int& b), p.addr, p.location',
      'Dynamic memory & C++ smart pointers: new int[3], delete[] arr, sizeof(int), make_unique, make_shared, weak_ptr, std::move',
    ],
    code: `x = 10
y = 25
int* ptr = &x
int** pptr = &ptr
*ptr = 42
print("x:", x, "| **pptr:", **pptr, "| addr:", ptr.addr, "| loc:", ptr.location)

fn swap(int& a, int& b):
  tmp = a
  a = b
  b = tmp

swap(x, y)
print("After swap -> x:", x, "| y:", y)

int* arr = new int[2]
arr[0] = 100
arr[1] = 200
print("Heap:", arr[0], *(arr + 1), "| sizeof(int):", sizeof(int))
delete[] arr

u = make_unique({ tag: "Core" })
print("Arrow ->:", u->tag)
u2 = std::move(u)
s = make_shared(99)
w = weak_ptr(s)
print("Moved:", u2->tag, "| shared:", *s, "| weak expired:", w.expired())`,
  },
  {
    id: 'collections-stack-lib',
    number: '08',
    category: 'stdlib',
    categoryLabel: 'Standard Library',
    title: 'Arrays, Dictionaries, Stack/Queue & stdlib/stack',
    summary:
      'Work with arrays and dictionaries using standalone functions or fluent methods alongside dedicated Stack, Queue, Set, and stack.* collection builders.',
    highlights: [
      'Array ops: push, append, pop, sort, shuffle, find, filter, map, unique, first, last',
      'Dictionary ops: keys, values, entries, get, set, has, remove, and "k" in dict',
      'Stack library: stack.array(...), stack.list(n, fill), stack.dict(keys, vals), Stack, Queue',
    ],
    code: `items = [5, 2, 8, 1, 2]
push(items, 9)
lastVal = pop(items)
sort(items)
print("Popped:", lastVal, "| Unique sorted:", join(unique(items), ","))
print("First:", first(items), "| Last:", last(items), "| Find >4:", items.find(x => x > 4))

profile = stack.dict(["name", "tier"], ["Sam", "Pro"])
profile.set("score", 98)
print("Keys:", join(profile.keys(), ", "), "| Has score:", "score" in profile)

st = Stack([10, 20])
st.push(30)
print("Stack pop:", st.pop(), "| peek:", st.peek())`,
  },
  {
    id: 'popups-vfs-server-db',
    number: '09',
    category: 'stdlib',
    categoryLabel: 'Standard Library',
    title: 'Popups, System VFS, Database, HTTP Server & Visual UI Charts',
    summary:
      'Use alert(), confirm(), and prompt() with exact JavaScript semantics (confirm -> bool, prompt -> string | null), virtual files (writeFile/readFile/deleteFile), date/time/sleep, persisted stdlib/db tables, in-memory stdlib/server routes, and stdlib/ui charts.',
    highlights: [
      'Browser popups: alert(msg), confirm(msg) -> bool, prompt(msg, def) -> string | null',
      'System & VFS: date(), time(), sleep(ms), writeFile/readFile/deleteFile, fetch, copy, speak',
      'Built-in db.save/find/all, server.get/post/request, and ui.table/card/chart',
    ],
    code: `writeFile("notes.txt", "Saved at {date()} {time()}")
print("File content:", readFile("notes.txt"))
deleteFile("notes.txt")

db.clear("runs")
db.save("runs", { task: "Lexer", ms: 2 })
db.save("runs", { task: "Parser", ms: 4 })

server.get("/metrics", req => ({ count: db.count("runs"), rows: db.all("runs") }))
res = server.request("GET", "/metrics")
print("Server status:", res.status, "| count:", res.body.count)

ui.chart("Compiler Stage Latency (ms)", { Lexer: 2, Parser: 4, Optimizer: 1 }, "bar")`,
  },
  {
    id: 'yourgui-basics-css',
    number: '10',
    category: 'yourgui',
    categoryLabel: 'YourGUI Websites',
    title: 'YourGUI Fundamentals & Native CSS style { ... } Blocks',
    summary:
      'Build real styled web pages in PowerScript without writing HTML. Write standard browser CSS inside a native style { ... } block (#hex colors, #ids, .classes, :hover, flexbox, grid) and mount elements with global helpers or import yourgui from "stdlib/yourgui".',
    highlights: [
      'Works globally OR explicitly via import yourgui from "stdlib/yourgui"',
      'style { ... } injects real CSS directly into document.head (no HTML files needed)',
      'Core components: heading(), text(), button(), input(), link(), image(), line()',
      'Note: inside yourgui files, bare input("Placeholder") builds an HTML <input>; use ask() for CLI input',
    ],
    code: `import yourgui from "stdlib/yourgui"

style {
  body {
    background: #0f172a;
    color: #f8fafc;
    font-family: system-ui, sans-serif;
    padding: 24px;
    max-width: 520px;
  }
  h1 { color: #38bdf8; margin-bottom: 6px; }
  input {
    width: 100%;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #1e293b;
    color: white;
    margin: 10px 0;
  }
  button {
    background: #2563eb;
    color: white;
    border: none;
    padding: 10px 16px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #1d4ed8; }
}

yourgui.title("PowerScript Greeting App")
heading("Hello YourGUI")
text("This website was built with zero HTML markup.")
nameBox = input("Type your name here...")
btn = button("Say Hello")
out = text("Waiting for click...")

onClick(btn, () => {
  who = nameBox.value != "" ? nameBox.value : "Friend"
  out.textContent = "Welcome aboard, {who}!"
})`,
  },
  {
    id: 'yourgui-containers-events-arrows',
    number: '11',
    category: 'yourgui',
    categoryLabel: 'YourGUI Websites',
    title: 'YourGUI Sections, ID DOM Manipulation & Button Methods',
    summary:
      'Declare HTML-like IDs directly on sections, containers, or widgets (section("hero", ...), button("#btn", "Go")) and target/update them anywhere via dom("hero"), byId("hero"), render("#hero", fn), mount("#hero", ...). Buttons include built-in .innerText/.innertext, .push(), .pop(), .disable(), .enable(), .setColor(), .setBg(), and .click().',
    highlights: [
      'Section DOM targeting: section("hero", () => { ... }), dom("hero"), byId("hero"), render("hero", fn), mount("hero", node)',
      'Button & widget helpers: btn.innertext = "Saved", btn.push("Item"), btn.pop(), btn.disable(), btn.enable(), btn.setColor("#fff"), btn.setBg("#2563eb")',
      'All interactive elements auto-style with crisp contrast even without custom style {} blocks',
    ],
    code: `import yourgui from "stdlib/yourgui"

style {
  body { background: #0f172a; color: #e2e8f0; font-family: system-ui; padding: 24px; }
  .panel { background: #1e293b; border: 1px solid #334155; padding: 16px; border-radius: 10px; }
}

heading("Section DOM + Button Stack", 2)

section("hero", { className: "panel" }, () => {
  status = text("Initial state")
  status.id = "status-line"

  queueBtn = button("#queue", "Queue")
  queueBtn.push("Alpha")
  queueBtn.push("Beta")

  row(() => {
    popBtn = button("Pop Item")
    popBtn.setBg("#059669")
    popBtn.onclick = () => {
      val = queueBtn.pop()
      dom("status-line").innertext = "Popped: {val} | Remaining: {queueBtn.count()}"
      if queueBtn.count() == 0:
        popBtn.innerText = "Empty"
        popBtn.disable()
    }
  })
})`,
  },
];

interface SyntaxGuideProps {
  onTryCode: (code: string, presetLabel: string) => void;
}

export function SyntaxGuide({ onTryCode }: SyntaxGuideProps) {
  const [category, setCategory] = useState<GuideCategory>('all');
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHAPTERS.filter((ch) => {
      if (category !== 'all' && ch.category !== category) return false;
      if (!q) return true;
      return (
        ch.title.toLowerCase().includes(q) ||
        ch.summary.toLowerCase().includes(q) ||
        ch.code.toLowerCase().includes(q) ||
        ch.highlights.some((h) => h.toLowerCase().includes(q))
      );
    });
  }, [category, query]);

  const handleCopy = (id: string, code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1500);
  };

  return (
    <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950">
      {/* Left Navigation Sidebar */}
      <aside className="lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            PowerScript &amp; YourGUI Manual
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Complete syntax guide from scratch covering PowerScript (EasyJS), arrow systems, stdlib modules, and no-HTML YourGUI web apps.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter syntax, arrows, yourgui..."
            className="w-full pl-8 pr-3 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>

        {/* Category Segmented Controls */}
        <nav className="flex flex-wrap lg:flex-col gap-1" aria-label="Documentation categories">
          {CATEGORIES.map((cat) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`text-left px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </nav>

        {/* Arrow Quick Cheat Table */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Arrow Operators Quick Map
          </div>
          <div className="space-y-2 text-xs font-mono tabular-nums">
            <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">=&gt;</span>
              <span className="font-sans">Lambda / Block / Match</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">-&gt;</span>
              <span className="font-sans">Function Return Type</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">|&gt;</span>
              <span className="font-sans">Pipeline Data Stream</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Documentation Content */}
      <section className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              Showing {filteredChapters.length} of {CHAPTERS.length} chapters
              <span aria-hidden="true"> · </span>
              Compiled JS &amp; AST Interpreter compatible
            </div>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                Clear filters
              </button>
            )}
          </div>

          {filteredChapters.length === 0 ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-center space-y-3">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                No syntax chapters matched &ldquo;{query}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
              >
                Show All Chapters
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredChapters.map((ch) => (
                <article
                  key={ch.id}
                  className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        Chapter {ch.number}
                        <span aria-hidden="true"> · </span>
                        {ch.categoryLabel}
                      </div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {ch.title}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(ch.id, ch.code)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedId === ch.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTryCode(ch.code, ch.title)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Try in Editor
                      </button>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {ch.summary}
                  </p>

                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-disc pl-5">
                    {ch.highlights.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>

                  <pre className="p-4 rounded-md bg-slate-950 text-slate-100 font-mono text-xs leading-5 overflow-x-auto border border-slate-800">
                    {ch.code}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
