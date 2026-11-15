import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { compileEasyJS, runEasyJSAsync, type RunResult } from './compiler/index.ts';
import { Console } from './components/Console.tsx';
import { Editor } from './components/Editor.tsx';
import { Output } from './components/Output.tsx';
import { Toolbar, type ExamplePreset, type WorkspaceTab } from './components/Toolbar.tsx';
import { runGeneratorTests } from '../tests/generator.test.ts';
import { runLexerTests, type TestCaseResult } from '../tests/lexer.test.ts';
import { runParserTests } from '../tests/parser.test.ts';
import { runTransformerTests } from '../tests/transformer.test.ts';

const PRESETS: ExamplePreset[] = [
  {
    id: 'stdlib-scope',
    label: 'Standard Library, Stack & Scope System',
    summary: 'Showcases bare assignments, scope blocks, Core/System/Browser stdlib (18-50), and the stack library.',
    code: `# EasyJS Standard Library (Core · Browser · System · Stack) + Scope
print("=== Core Strings, Math & Collections ===")
text = uppercase("hello world")
print(text, "| lower:", lowercase(text), "| len:", length(text))
print("Replace:", replace("Hi EasyJS", "Hi", "Hello"))
print("Split & Join:", join(split("a,b,c", ","), "-"))
print("Reverse:", reverse("hello"), "| Contains 'ell':", contains("hello", "ell"))
print("Random(1..100):", random(1, 100), "| sqrt(25):", sqrt(25))

# Bare assignment auto-declares in the current scope
items = [5, 2, 8, 1, 2]
push(items, 10)
print("Popped:", pop(items))
sort(items)
print("Sorted:", items, "| Unique:", unique(items))
print("First:", first(items), "| Last:", last(items), "| Find 8:", find(items, 8))
print("Filtered > 2:", filter(items, fn(x) => x > 2))

# Stack library for effortless arrays & dictionaries
print("\\n=== Stack Library ===")
arr = stack.array(10, 20, 30)
zeros = stack.list(4, 0)
userDict = stack.dict(["name", "tier"], ["Alex", "Pro"])
merged = stack.merge(userDict, { score: 98 })
print("stack.array:", arr, "| stack.list:", zeros)
print("stack.dict + merge:", merged)

# Scope isolation block
print("\\n=== Scope System ===")
outer = "visible everywhere"
scope localBlock {
  secret = "isolated inside scope"
  print("Inside scope:", secret, "|", outer)
}

# System & Virtual Filesystem
print("\\n=== System & Virtual Filesystem ===")
print("Date:", date(), "| Time:", time())
writeFile("notes.txt", "Saved from EasyJS!")
print("Read file:", readFile("notes.txt"))
deleteFile("notes.txt")
alert("EasyJS Standard Library Ready!")
`,
  },
  {
    id: 'basics-collections',
    label: 'Basics: Variables, Arrays, Dicts & Stack',
    summary: 'Shows let/var/const/typed variables, arrays, dictionaries, Stack, Queue, and text/math helpers.',
    code: `# EasyJS Fundamentals: Variables, Types, Arrays, Dicts & Stack
var greeting = "  Hello, EasyJS!  "
let cleanText = greeting.trim().upper()
print("Text:", cleanText)

# Explicit data types (both type-first and colon syntax work)
int count = 3
float multiplier = 2.5
const bonus: int = 10
print(f"Math result: {count * multiplier + bonus}")

# Arrays with append, remove, sort, find
array scores = [42, 7, 95, 18, 7]
scores.append(64)
scores.remove(7)
scores.sort()
print("Sorted scores:", scores)
print("Found > 50:", scores.find(fn(n) => n > 50))
print("Is 64 in scores?", 64 in scores)

# Dictionaries (key-value store)
dict user = { name: "Alex", role: "Builder" }
user.set("level", 4)
user["active"] = true
print("User keys:", user.keys())
print("Role:", user.get("role"))
user.remove("active")
print("Updated user:", user)

# Stack & Queue data structures
stack history = Stack(["init", "lex"])
history.push("parse")
history.push("codegen")
print("Stack peek:", history.peek(), "| Popped:", history.pop())
print("Remaining stack:", history)
`,
  },
  {
    id: 'interactive-input',
    label: 'Interactive Input & User Operations',
    summary: 'Prompts the user directly in the Console and computes results on their input.',
    code: `# Interactive Console Input in EasyJS
print("=== EasyJS Interactive Calculator & Profile ===")
text name = input("Enter your name: ")
int age = inputInt("Enter your age: ")
float score = inputFloat("Enter test score (0-100): ")

let grade = match score {
  90..=100 => "A",
  80..90 => "B",
  70..80 => "C",
  _ => "Keep practicing"
}

dict profile = {
  name: name.trim(),
  nextYearAge: age + 1,
  score: score.round(),
  grade: grade
}

print(f"Welcome {profile.name}!")
print(f"Next year you will be {profile.nextYearAge}.")
print("Profile summary:", profile)
`,
  },
  {
    id: 'showcase',
    label: 'Advanced OOP, Traits, Enums & Pointers',
    summary: 'Demonstrates traits, inheritance, smart pointers, algebraic enums, and pipelines.',
    code: `# EasyJS: Clean, Typed, Ownership-Aware Language
trait Describable {
  fn describe() -> str
}

enum Status {
  Active(priority),
  Completed(summary)
}

struct Metrics {
  runs: int = 1,
  score: float = 9.5
}

class Agent {
  pub name: str
  priv level: int = 1

  init(name: str, level: int = 1) {
    self.name = name
    self.level = level
  }
}

class CompilerAgent extends Agent implements Describable {
  pub status: any

  init(name: str, status) {
    super(name, 5)
    self.status = status
  }

  pub fn describe() -> str {
    let label = match self.status {
      Status.Active(p) => f"Active (priority {p})",
      Status.Completed(s) => f"Done: {s}",
      _ => "Idle"
    }
    return f"{self.name} -> {label}"
  }
}

fn main() {
  defer print("Cleanup: main scope exited cleanly")

  let bot = new CompilerAgent("EasyJS Core", Status.Active(1))
  print(bot.describe())

  # Smart & Rule Pointers
  own buffer = Metrics { runs: 3, score: 9.8 }
  ref view = &buffer
  print("Borrowed struct:", *view)

  shared cache = share([10, 20, 30, 40])
  let mirror = cache.clone()
  print(f"Shared refCount = {refCount(mirror)}")

  # Functional pipeline with inclusive range
  let total = 1..=6
    |> filter(fn(n) => n % 2 == 0)
    |> map(fn(n) => n * 10)
    |> sum()
  print(f"Even pipeline sum = {total}")

  drop cache
  print(f"After drop, mirror refCount = {refCount(mirror)}")
}

main()
`,
  },
  {
    id: 'pointers',
    label: 'Smart & Rule Pointers (Own / Borrow / Move)',
    summary: 'Shows unique ownership, immutable rule borrows, reference counting, and drop.',
    code: `# Smart & Rule Pointers in EasyJS
fn pointerDemo() {
  own vault = 500
  ref inspector = &vault
  print(f"Initial borrowed value: {*inspector}")

  # Mutate via owning pointer
  *vault = 750
  print(f"Updated via borrow: {*inspector}")

  # Transfer ownership with move
  own newOwner = move vault
  print(f"New owner holds: {*newOwner}")

  # Reference-counted shared pointer
  shared config = share({ mode: "fast", threads: 4 })
  let workerA = config.clone()
  let workerB = config.clone()
  print(f"Active shared refs: {refCount(config)}")

  drop workerA
  drop workerB
  print(f"Remaining shared refs: {refCount(config)}")
  drop newOwner
}

pointerDemo()
`,
  },
  {
    id: 'ownership-error',
    label: 'Static Ownership Error Detection',
    summary: 'Triggers compile-time pointer safety diagnostics for use-after-move.',
    code: `# Static Rule Checker catches use-after-move at compile time
own secretKey = "API-9942"
own transferred = move secretKey

# Accessing 'secretKey' after move triggers a compile error:
print(*secretKey)
`,
  },
];

function executeAllTests(): TestCaseResult[] {
  return [
    ...runLexerTests(),
    ...runParserTests(),
    ...runTransformerTests(),
    ...runGeneratorTests(),
  ];
}

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeView, setActiveView] = useState<WorkspaceTab>('workspace');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESETS[0].id);
  const [source, setSource] = useState<string>(PRESETS[0].code);
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<TestCaseResult[]>(() => executeAllTests());
  const [runResult, setRunResult] = useState<RunResult>(() => compileEasyJS(PRESETS[0].code));
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<{ prompt: string } | null>(null);

  const inputResolverRef = useRef<{
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const runSeqRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Run initial preset on mount
  useEffect(() => {
    void executeProgram(PRESETS[0].code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live compile on edit for instant tokens, AST, JS, and diagnostics
  const liveCompile = useMemo(() => compileEasyJS(source), [source]);

  const cancelActiveRun = () => {
    runSeqRef.current += 1;
    if (inputResolverRef.current) {
      inputResolverRef.current.reject(new Error('Execution stopped by user.'));
      inputResolverRef.current = null;
    }
    setPendingPrompt(null);
    setIsRunning(false);
  };

  const executeProgram = async (codeToRun: string) => {
    cancelActiveRun();
    const seq = ++runSeqRef.current;
    setLiveLogs([]);
    setIsRunning(true);

    const result = await runEasyJSAsync(codeToRun, {
      onLog: (line) => {
        if (runSeqRef.current !== seq) return;
        setLiveLogs((prev) => [...prev, line]);
      },
      onAlert: (message) => {
        if (runSeqRef.current !== seq) return;
        setLiveLogs((prev) => [...prev, `[alert] ${message}`]);
      },
      onBrowser: (url) => {
        if (runSeqRef.current !== seq) return;
        setLiveLogs((prev) => [...prev, `[browser] Ready to open URL: ${url}`]);
      },
      onInput: (promptText) =>
        new Promise<string>((resolve, reject) => {
          if (runSeqRef.current !== seq) {
            reject(new Error('Execution cancelled'));
            return;
          }
          setPendingPrompt({ prompt: promptText });
          inputResolverRef.current = {
            resolve: (val: string) => {
              setLiveLogs((prev) => [...prev, `${promptText || '> '}${val}`]);
              setPendingPrompt(null);
              inputResolverRef.current = null;
              resolve(val);
            },
            reject,
          };
        }),
    });

    if (runSeqRef.current === seq) {
      setRunResult(result);
      setIsRunning(false);
      setPendingPrompt(null);
    }
  };

  const handleRun = () => {
    void executeProgram(source);
  };

  const handleSubmitInput = (val: string) => {
    inputResolverRef.current?.resolve(val);
  };

  const handleSelectPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSelectedPresetId(id);
    setSource(preset.code);
    setFocusedLine(null);
    void executeProgram(preset.code);
  };

  const handleReset = () => {
    const preset = PRESETS.find((p) => p.id === selectedPresetId) ?? PRESETS[0];
    setSource(preset.code);
    setFocusedLine(null);
    void executeProgram(preset.code);
  };

  const handleRunTests = () => {
    setTestResults(executeAllTests());
    setActiveView('tests');
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Toolbar
        activeView={activeView}
        onSelectView={setActiveView}
        presets={PRESETS}
        selectedPresetId={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        onRun={handleRun}
        onReset={handleReset}
        onRunTests={handleRunTests}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />

      {activeView === 'workspace' && (
        <main className="flex flex-col flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0">
            <Editor
              value={source}
              onChange={setSource}
              onRun={handleRun}
              diagnostics={liveCompile.diagnostics}
              focusedLine={focusedLine}
            />
            <Output
              compileResult={liveCompile}
              pointerEvents={runResult.execution?.pointerEvents ?? []}
            />
          </div>
          <Console
            execution={runResult.execution}
            liveLogs={liveLogs}
            isRunning={isRunning}
            pendingPrompt={pendingPrompt}
            onSubmitInput={handleSubmitInput}
            onStopExecution={cancelActiveRun}
            diagnostics={liveCompile.diagnostics}
            testResults={testResults}
            onSelectLine={(line) => setFocusedLine(line)}
            onRunTests={() => setTestResults(executeAllTests())}
          />
        </main>
      )}

      {activeView === 'guide' && (
        <main className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-5xl mx-auto space-y-8">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-6">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                EasyJS Language Specification
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Designed for high readability, lightweight execution, built-in data structures (arrays, dictionaries, stacks, queues), interactive input, advanced OOP, and smart pointer ownership rules.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <GuideBlock
                title="01. Scope System & Variables"
                description="Use explicit scope { ... } blocks to isolate variables, or declare with bare assignment, let, var, const, or type-first syntax."
                code={`name = "Alex"         // auto-declared in current scope
var x = 10
const PI: float = 3.14

scope auth {
  token = "abc-123"   // isolated inside 'auth' scope
  print(token)
}`}
              />
              <GuideBlock
                title="02. Stack Library (Arrays & Dicts)"
                description="Use the built-in stack namespace to construct arrays, filled lists, dictionaries, zipped pairs, ranges, and LIFO/FIFO structures."
                code={`arr = stack.array(1, 2, 3)
grid = stack.list(4, 0)
user = stack.dict(["name", "role"], ["Sam", "Admin"])
merged = stack.merge(user, { active: true })
lifo = stack.lifo(["a", "b"])`}
              />
              <GuideBlock
                title="03. Core Strings, Arrays & Math (18–34)"
                description="uppercase, lowercase, length, replace, split, join, reverse, contains, push, pop, sort, shuffle, find, filter, unique, first, last, random, sqrt."
                code={`msg = uppercase("hello world")
parts = split(msg, " ")
items = [5, 2, 8, 1, 2]
sort(items)
print(unique(items), first(items), last(items))
print(random(1, 100), sqrt(25))`}
              />
              <GuideBlock
                title="04. Browser & System Functions (35–50)"
                description="Interactive input, alert, confirm, prompt, browser, copy, speak, listen, fetch, sleep, time, date, timer, interval, stop, exit, readFile, writeFile, deleteFile, download."
                code={`print(date(), time())
writeFile("log.txt", "Hello EasyJS")
print(readFile("log.txt"))
sleep(250)
alert("Done!")`}
              />
              <GuideBlock
                title="05. Classes, Visibility & Traits"
                description="Clean OOP with pub/priv/prot visibility modifiers, init constructors, self/super references, override checks, and compile-time trait verification."
                code={`trait Serializable {
  fn toJson() -> str
}
class User implements Serializable {
  pub name: str
  priv id: int
  init(name: str, id: int) {
    self.name = name
    self.id = id
  }
  pub fn toJson() -> str => f"{self.name}"
}`}
              />
              <GuideBlock
                title="06. Algebraic Enums, Match & Pipelines"
                description="Enums carry payloads, match supports ranges (90..=100) and destructuring, and pipelines (|>) chain transformations cleanly."
                code={`enum Result {
  Ok(value),
  Err(message)
}
let text = match outcome {
  Result.Ok(v) => f"Success: {v}",
  Result.Err(e) => f"Failed: {e}",
  _ => "Unknown"
}
let total = 1..=10 |> filter(fn(x) => x % 2 == 0) |> sum()`}
              />
            </div>
          </div>
        </main>
      )}

      {activeView === 'tests' && (
        <main className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Compiler Test Suite
                </h1>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  {testResults.filter((t) => t.passed).length} passed ·{' '}
                  {testResults.filter((t) => !t.passed).length} failed ·{' '}
                  {testResults.length} total assertions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTestResults(executeAllTests())}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
              >
                Run All Tests
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
              {testResults.map((t, idx) => (
                <div key={idx} className="flex items-start justify-between gap-4 px-4 py-3 text-xs">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {t.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="text-slate-500 dark:text-slate-400">{t.suite}</div>
                      <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                        {t.name}
                      </div>
                      {t.error && (
                        <div className="mt-1 font-mono text-red-600 dark:text-red-400">
                          {t.error}
                        </div>
                      )}
                    </div>
                  </div>
                  <span
                    className={`font-mono font-semibold shrink-0 ${
                      t.passed
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {t.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

function GuideBlock({
  title,
  description,
  code,
}: {
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        {description}
      </p>
      <pre className="p-3 rounded bg-slate-950 text-slate-100 font-mono text-xs leading-5 overflow-x-auto border border-slate-800">
        {code}
      </pre>
    </div>
  );
}
