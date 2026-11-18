import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Save, X } from 'lucide-react';
import {
  ASTInterpreter,
  compileEasyJS,
  disposeActiveBrowserSandbox,
  formatEasyJS,
  runEasyJSAsync,
  runEasyJSInterpreted,
  type DebugSnapshot,
  type ExecuteAsyncOptions,
  type GuiEventDispatcher,
  type GuiVNodeSnapshot,
  type RunResult,
  type VisualOutputItem,
} from './compiler/index.ts';
import { runEasyJSServerSandbox } from './compiler/sandboxClient.ts';
import { Console, type TerminalEntry } from './components/Console.tsx';
import { Editor } from './components/Editor.tsx';
import { FileExplorer } from './components/FileExplorer.tsx';
import { Output } from './components/Output.tsx';
import { PopupDialog, type PopupRequest } from './components/PopupDialog.tsx';
import { SyntaxGuide } from './components/SyntaxGuide.tsx';
import {
  Toolbar,
  type ExamplePreset,
  type ExecutionEngine,
  type WorkspaceTab,
} from './components/Toolbar.tsx';
import {
  createSavedFileRecord,
  loadActiveFileId,
  loadSavedFiles,
  persistActiveFileId,
  persistSavedFiles,
  sanitizeFileName,
  type SavedWorkspaceFile,
} from './utils/fileStorage.ts';
import { runGeneratorTests } from '../tests/generator.test.ts';
import { runLexerTests, type TestCaseResult } from '../tests/lexer.test.ts';
import { runParserTests } from '../tests/parser.test.ts';
import { runTransformerTests } from '../tests/transformer.test.ts';

const PRESETS: ExamplePreset[] = [
  {
    id: 'yourgui-site',
    label: 'YourGUI Frontend Website (No HTML)',
    summary: 'Builds a complete styled interactive web app with sections, DOM IDs, button helpers (.innertext, .push, .pop), and live events.',
    code: `# YourGUI: Build Interactive Websites Without Writing HTML
import yourgui from "stdlib/yourgui"

style {
    body {
        background: #0f172a;
        color: #f8fafc;
        font-family: system-ui, Arial, sans-serif;
        padding: 28px;
        max-width: 600px;
    }

    h1 {
        color: #34d399;
        margin: 0 0 8px 0;
    }

    .card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 18px;
        margin: 16px 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    input, select, textarea {
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #475569;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 14px;
    }

    button {
        background: #2563eb;
        color: #ffffff;
        padding: 10px 18px;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
    }

    button:hover {
        background: #1d4ed8;
    }
}

yourgui.title("My EasyJS Website")
heading("My First Website")
text("Built purely in EasyJS + yourgui using native browser CSS, sections, and button helpers.")

clicks = 0
section("greeting-card", { className: "card" }, () => {
    nameInput = input("Enter your name")
    roleSelect = select(["Developer", "Designer", "Founder"])
    agreeBox = checkbox("Subscribe to updates", true)
    status = text("Waiting for greeting...")

    row(() => {
        submitBtn = button("#greet-btn", "Greet Me")
        resetBtn = button("#reset-btn", "Reset")
        resetBtn.setBg("#475569")

        submitBtn.onclick = fn() {
            clicks = clicks + 1
            who = nameInput.value != "" ? nameInput.value : "Explorer"
            subText = agreeBox.checked ? "Subscribed" : "No emails"
            submitBtn.innerText = "Greeted ({clicks})"
            dom("greeting-output").innertext = "Hello {who} ({roleSelect.value})! [{subText}]"
            print("UI Event:", status.textContent)
        }

        resetBtn.onclick = fn() {
            clicks = 0
            submitBtn.innerText = "Greet Me"
            dom("greeting-output").innertext = "Waiting for greeting..."
        }
    })

    statusNode = text("Waiting for greeting...")
    statusNode.id = "greeting-output"
    status.hide()
})

line()
link("Visit EasyJS Docs Example", "#docs")
`,
  },
  {
    id: 'yourgui-dom-buttons',
    label: 'YourGUI Sections, IDs & Button Stack Helpers',
    summary: 'Demonstrates section("#id") DOM targeting, .push()/.pop()/.innertext button methods, and C++-style comma for/while loops.',
    code: `# YourGUI Section DOM Manipulation + Button Helpers
import yourgui from "stdlib/yourgui"

style {
    body { background: #0f172a; color: #f8fafc; font-family: system-ui; padding: 24px; max-width: 620px; }
    .panel { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
    button { background: #2563eb; color: #ffffff; border: none; padding: 9px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; }
}

yourgui.title("Task Queue & DOM Sections")
heading("Section DOM Controller")

section("controls", { className: "panel" }, () => {
    actionBtn = button("#queue-btn", "Tasks")
    actionBtn.push("Sync")
    actionBtn.push("Build")
    actionBtn.push("Deploy")

    summary = text("Queue size: {actionBtn.count()}")
    summary.id = "queue-summary"

    row(() => {
        pushBtn = button("Push Task")
        popBtn = button("Pop Task")
        popBtn.setBg("#dc2626")

        taskCount = 3
        pushBtn.onclick = () => {
            taskCount += 1
            actionBtn.push("Job-{taskCount}")
            byId("queue-summary").innertext = "Top: {actionBtn.peek()} | Count: {actionBtn.count()}"
        }

        popBtn.onclick = () => {
            removed = actionBtn.pop()
            byId("queue-summary").innertext = "Popped: {removed} | Remaining: {actionBtn.count()}"
        }
    })
})

section("loop-preview", { className: "panel" }, () => {
    heading("C++ Comma Loop Output", 3)
    for (i = 1, i <= 3, i++):
        text("Item #{i} rendered cleanly")
})
`,
  },
  {
    id: 'cpp-pointers-memory',
    label: 'C++ Pointers, References & Smart Memory',
    summary: 'Demonstrates int* pointers, & references, pass-by-reference swap, new/delete[], unique_ptr/shared_ptr/weak_ptr, and browser location.',
    code: `# Complete C++ Pointer, Reference & Memory Management Syntax
x = 10
y = 25

# Raw pointers & address-of (&)
int* ptr = &x
int** pptr = &ptr
print("x =", x, "| *ptr =", *ptr, "| **pptr =", **pptr)
print("Pointer address:", ptr.addr)
print("Browser location:", ptr.location)

*ptr = 99
print("After *ptr = 99 -> x =", x)

# Pass-by-reference function (&)
fn swap(int& a, int& b):
    temp = a
    a = b
    b = temp

swap(x, y)
print("After swap(x, y) -> x =", x, "| y =", y)

# Dynamic heap allocation: new / delete & new[] / delete[]
int* arr = new int[3]
arr[0] = 11
arr[1] = 22
arr[2] = 33
print("Heap array:", arr[0], *(arr + 1), arr[2], "| sizeof(int):", sizeof(int))
delete[] arr

# C++ Smart Pointers: unique_ptr, shared_ptr, weak_ptr, std::move
u1 = make_unique({ name: "Engine", version: 2 })
print("Arrow deref u1->name:", u1->name)
u2 = std::move(u1)
print("Moved u2->version:", u2->version)

s1 = make_shared(500)
w1 = weak_ptr(s1)
print("shared_ptr deref:", *s1, "| refCount:", s1.use_count(), "| weak expired:", w1.expired())
`,
  },
  {
    id: 'stdlib-scope',
    label: 'Standard Library, Stack & Scope System',
    summary: 'Showcases bare assignments, scope blocks, Core/System/Browser stdlib, and the stack library.',
    code: `# EasyJS Standard Library (Core · Browser · System · Stack) + Scope
print("=== Core Strings, Math & Collections ===")
text = uppercase("hello world")
print(text, "| lower:", lowercase(text), "| len:", length(text))
print("Replace:", replace("Hi EasyJS", "Hi", "Hello"))
print("Split & Join:", join(split("a,b,c", ","), "-"))
print("Reverse:", reverse("hello"), "| Contains 'ell':", contains("hello", "ell"))
print("Random(1..100):", random(1, 100), "| sqrt(25):", sqrt(25))

items = [5, 2, 8, 1, 2]
push(items, 10)
print("Popped:", pop(items))
sort(items)
print("Sorted:", items, "| Unique:", unique(items))
print("First:", first(items), "| Last:", last(items), "| Find 8:", find(items, 8))
print("Filtered > 2:", filter(items, (x) => x > 2))

print("\\n=== Stack Library ===")
arr = stack.array(10, 20, 30)
zeros = stack.list(4, 0)
userDict = stack.dict(["name", "tier"], ["Alex", "Pro"])
merged = stack.merge(userDict, { score: 98 })
print("stack.array:", arr, "| stack.list:", zeros)
print("stack.dict + merge:", merged)

print("\\n=== Scope System ===")
outer = "visible everywhere"
scope localBlock {
  secret = "isolated inside scope"
  print("Inside scope:", secret, "|", outer)
}

print("\\n=== System & Virtual Filesystem ===")
print("Date:", date(), "| Time:", time())
writeFile("notes.txt", "Saved from EasyJS!")
print("Read file:", readFile("notes.txt"))
deleteFile("notes.txt")
`,
  },
  {
    id: 'popups-js',
    label: 'Browser Popups: alert, confirm & prompt',
    summary: 'Displays native-style pop-up dialogs matching exact JavaScript return values (Yes -> true, Cancel -> false/null).',
    code: `# Interactive Popups (Exact JavaScript Behavior)
alert("Welcome to EasyJS! Click OK to continue.")

accepted = confirm("Do you want to enable Pro Mode? (Yes = true, Cancel = false)")
print("confirm() returned:", accepted)

if accepted:
  username = prompt("Enter your developer name:", "Alex")
  if username != null:
    alert("Hello {username}! Pro Mode is now active.")
    print("Registered user:", username)
  else:
    print("prompt() was cancelled -> returned:", username)
else:
  print("User declined Pro Mode.")
`,
  },
  {
    id: 'constructors-conditionals',
    label: 'Constructors & Deep Nested Conditionals',
    summary: 'Multi-level class inheritance constructors (init/constructor/super) combined with deeply nested if/elif/else chains.',
    code: `# Constructors (init/super) + Deeply Nested if/elif/else
class Entity:
  pub kind: str
  init(kind: str):
    self.kind = kind

class AccessPolicy extends Entity {
  pub tier: int
  pub region: str

  init(kind: str, tier: int = 1, region: str = "us") {
    super(kind)
    self.tier = tier
    self.region = region
  }

  pub fn evaluate(score: int, active: bool, overrideFlag: bool) -> str {
    var verdict = "denied"
    if overrideFlag:
      if active:
        verdict = "override-granted"
      else:
        verdict = "override-inactive"
    elif active:
      if self.tier >= 3:
        if score >= 90:
          if self.region == "us":
            verdict = "tier3-us-gold"
          elif self.region == "eu":
            verdict = "tier3-eu-gold"
          else:
            verdict = "tier3-global-gold"
        elif score >= 70:
          verdict = "tier3-silver"
        else:
          verdict = "tier3-low-score"
      elif self.tier == 2:
        verdict = "tier2-standard"
      else:
        verdict = "tier1-basic"
    else:
      verdict = "inactive-user"
    return f"{self.kind}: {verdict}"
  }
}

p1 = new AccessPolicy("Admin", 3, "eu")
p2 = AccessPolicy("Guest", 2, "us")
print(p1.evaluate(95, true, false))
print(p2.evaluate(60, true, false))
print(p1.evaluate(10, false, true))
`,
  },
  {
    id: 'db-server-visual',
    label: 'Built-in DB, HTTP Server & Visual UI',
    summary: 'Imports stdlib modules, persists records to db, defines server routes, and renders cards, tables, and charts.',
    code: `# Modules, Built-in DB, HTTP Server & Visual UI
import math from "stdlib/math"

db.clear("metrics")
db.save("metrics", { module: "Lexer", ms: 2 })
db.save("metrics", { module: "Parser", ms: 4 })
db.save("metrics", { module: "Optimizer", ms: 1 })
rows = db.all("metrics")

server.get("/api/health", (req) => {
  return { ok: true, isPrime17: math.isPrime(17), count: length(rows) }
})
server.start(3000)
resp = server.request("GET", "/api/health")
print("GET /api/health ->", resp)

ui.card("EasyJS Pipeline Report", "isPrime(17) = {math.isPrime(17)} | Factorial(5) = {math.factorial(5)}", "Zero-eval AST Interpreter")
ui.table(rows)
ui.chart("Phase Timing (ms)", [
  { label: "Lexer", value: 2 },
  { label: "Parser", value: 4 },
  { label: "Optimizer", value: 1 },
  { label: "Codegen", value: 3 }
])
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

  own buffer = Metrics { runs: 3, score: 9.8 }
  ref view = &buffer
  print("Borrowed struct:", *view)

  shared cache = share([10, 20, 30, 40])
  let mirror = cache.clone()
  print(f"Shared refCount = {refCount(mirror)}")

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
    id: 'ownership-error',
    label: 'Static Ownership & Type Errors',
    summary: 'Triggers compile-time pointer safety and type diagnostics with caret highlights.',
    code: `# Static Rule & Type Checker catches errors before execution
var age: number = 15
age = "not-a-number"

own secretKey = "API-9942"
own transferred = move secretKey
print(*secretKey)
`,
  },
];

async function executeAllTests(): Promise<TestCaseResult[]> {
  const genResults = await runGeneratorTests();
  return [
    ...runLexerTests(),
    ...runParserTests(),
    ...runTransformerTests(),
    ...genResults,
  ];
}

function findGuiNodeByIdOrLabel(nodes: GuiVNodeSnapshot[], query: string): GuiVNodeSnapshot | null {
  const clean = query.replace(/^#/, '');
  for (const node of nodes) {
    const attrId = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
    if (
      node.id === clean ||
      attrId === clean ||
      (node.textContent && node.textContent.toLowerCase() === clean.toLowerCase())
    ) {
      return node;
    }
    if (Array.isArray(node.children)) {
      const found = findGuiNodeByIdOrLabel(node.children, clean);
      if (found) return found;
    }
  }
  return null;
}

function formatGuiDomTree(nodes: GuiVNodeSnapshot[], depth = 0): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  for (const n of nodes) {
    const attrId = n.attrs?.id ? `#${n.attrs.id}` : `#${n.id}`;
    const cls = n.attrs?.class ? `.${String(n.attrs.class).split(/\s+/).join('.')}` : '';
    const txt = n.textContent ? ` "${n.textContent}"` : '';
    lines.push(`${indent}<${n.tag}${attrId}${cls}>${txt}`);
    if (Array.isArray(n.children) && n.children.length > 0) {
      lines.push(...formatGuiDomTree(n.children, depth + 1));
    }
  }
  return lines;
}

export default function App() {
  const initialFiles = useMemo(() => loadSavedFiles(), []);
  const initialActiveId = useMemo(() => {
    const candidate = loadActiveFileId();
    return candidate && initialFiles.some((f) => f.id === candidate) ? candidate : null;
  }, [initialFiles]);
  const initialActiveFile = useMemo(
    () => (initialActiveId ? initialFiles.find((f) => f.id === initialActiveId) ?? null : null),
    [initialActiveId, initialFiles]
  );

  const [darkMode, setDarkMode] = useState(true);
  const [activeView, setActiveView] = useState<WorkspaceTab>('workspace');
  const [showCode, setShowCode] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [consoleHidden, setConsoleHidden] = useState(false);
  const [savedFiles, setSavedFiles] = useState<SavedWorkspaceFile[]>(initialFiles);
  const [activeFileId, setActiveFileId] = useState<string | null>(initialActiveId);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('my-app.ejs');

  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESETS[0].id);
  const [engine, setEngine] = useState<ExecutionEngine>('server-sandbox');
  const [source, setSource] = useState<string>(
    initialActiveFile ? initialActiveFile.content : PRESETS[0].code
  );
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [runResult, setRunResult] = useState<RunResult>(() => compileEasyJS(''));
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [liveVisuals, setLiveVisuals] = useState<VisualOutputItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<{ prompt: string } | null>(null);
  const [popupRequest, setPopupRequest] = useState<PopupRequest | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([
    {
      id: 1,
      kind: 'out',
      text: 'EasyJS Task Terminal ready. Type "help" for commands (run, save, open, ls, dom, vars, code, hide).',
    },
  ]);

  const inputResolverRef = useRef<{
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const activePopupDismissRef = useRef<(() => void) | null>(null);
  const activeDebuggerRef = useRef<ASTInterpreter | null>(null);
  const activeRunAbortRef = useRef<AbortController | null>(null);
  const guiDispatcherRef = useRef<GuiEventDispatcher | null>(null);
  const runSeqRef = useRef(0);
  const termSeqRef = useRef(2);

  const appendTerminal = useCallback((kind: TerminalEntry['kind'], text: string) => {
    setTerminalEntries((prev) => [...prev, { id: termSeqRef.current++, kind, text }]);
  }, []);

  const activeSavedFile = useMemo(
    () => (activeFileId ? savedFiles.find((f) => f.id === activeFileId) ?? null : null),
    [activeFileId, savedFiles]
  );

  const hasUnsavedChanges = useMemo(() => {
    if (activeSavedFile) return source !== activeSavedFile.content;
    const preset = PRESETS.find((p) => p.id === selectedPresetId);
    return preset ? source !== preset.code : source.trim().length > 0;
  }, [activeSavedFile, selectedPresetId, source]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    persistActiveFileId(activeFileId);
  }, [activeFileId]);

  // Run initial program and defer unit test suite so UI mounts cleanly
  useEffect(() => {
    const initialCode = initialActiveFile ? initialActiveFile.content : PRESETS[0].code;
    void executeProgram(initialCode, 'server-sandbox');
    const timer = window.setTimeout(() => {
      void executeAllTests().then((results) => setTestResults(results));
    }, 80);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live compile on edit for diagnostics and preview status
  const liveCompile = useMemo(() => compileEasyJS(source), [source]);

  useEffect(() => {
    return () => {
      activeRunAbortRef.current?.abort();
      disposeActiveBrowserSandbox();
    };
  }, []);

  const cancelActiveRun = () => {
    runSeqRef.current += 1;
    guiDispatcherRef.current = null;
    if (activeRunAbortRef.current) {
      activeRunAbortRef.current.abort();
      activeRunAbortRef.current = null;
    }
    disposeActiveBrowserSandbox();
    if (activeDebuggerRef.current) {
      activeDebuggerRef.current.stop();
      activeDebuggerRef.current = null;
    }
    if (inputResolverRef.current) {
      inputResolverRef.current.reject(new Error('Execution stopped by user.'));
      inputResolverRef.current = null;
    }
    if (activePopupDismissRef.current) {
      activePopupDismissRef.current();
      activePopupDismissRef.current = null;
    }
    setPopupRequest(null);
    setPendingPrompt(null);
    setDebugSnapshot(null);
    setIsRunning(false);
  };

  const buildIoOptions = (seq: number, signal?: AbortSignal): ExecuteAsyncOptions => ({
    signal,
    onLog: (line) => {
      if (runSeqRef.current !== seq) return;
      setLiveLogs((prev) => [...prev, line]);
    },
    onVisual: (item) => {
      if (runSeqRef.current !== seq) return;
      setLiveVisuals((prev) => {
        if (item.kind === 'yourgui') {
          const idx = prev.findIndex((v) => v.kind === 'yourgui' && v.pageId === item.pageId);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = item;
            return next;
          }
        }
        return [...prev, item];
      });
    },
    registerGuiDispatcher: (dispatcher) => {
      if (runSeqRef.current === seq) {
        guiDispatcherRef.current = dispatcher;
      }
    },
    onEcho: (promptText, val) => {
      if (runSeqRef.current !== seq) return;
      setLiveLogs((prev) => [...prev, `${promptText || '> '}${val}`]);
    },
    onAlert: (message) =>
      new Promise<void>((resolve) => {
        if (runSeqRef.current !== seq) {
          resolve();
          return;
        }
        const finish = () => {
          activePopupDismissRef.current = null;
          setPopupRequest(null);
          if (runSeqRef.current === seq) {
            setLiveLogs((prev) => [...prev, `[alert] ${message}`]);
          }
          resolve();
        };
        activePopupDismissRef.current = finish;
        setPopupRequest({
          kind: 'alert',
          message,
          resolve: finish,
        });
      }),
    onConfirm: (message) =>
      new Promise<boolean>((resolve) => {
        if (runSeqRef.current !== seq) {
          resolve(false);
          return;
        }
        const finish = (accepted: boolean) => {
          activePopupDismissRef.current = null;
          setPopupRequest(null);
          if (runSeqRef.current === seq) {
            setLiveLogs((prev) => [...prev, `[confirm] ${message} -> ${accepted}`]);
          }
          resolve(accepted);
        };
        activePopupDismissRef.current = () => finish(false);
        setPopupRequest({
          kind: 'confirm',
          message,
          resolve: finish,
        });
      }),
    onPrompt: (message, defaultValue = '') =>
      new Promise<string | null>((resolve) => {
        if (runSeqRef.current !== seq) {
          resolve(null);
          return;
        }
        const finish = (value: string | null) => {
          activePopupDismissRef.current = null;
          setPopupRequest(null);
          if (runSeqRef.current === seq) {
            setLiveLogs((prev) => [
              ...prev,
              `[prompt] ${message} -> ${value === null ? 'null' : JSON.stringify(value)}`,
            ]);
          }
          resolve(value);
        };
        activePopupDismissRef.current = () => finish(null);
        setPopupRequest({
          kind: 'prompt',
          message,
          defaultValue,
          resolve: finish,
        });
      }),
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

  const executeProgram = async (
    codeToRun: string,
    selectedEngine: ExecutionEngine = engine
  ) => {
    cancelActiveRun();
    const seq = ++runSeqRef.current;
    const controller = new AbortController();
    activeRunAbortRef.current = controller;
    setLiveLogs([]);
    setLiveVisuals([]);
    setIsRunning(true);

    const ioOpts = buildIoOptions(seq, controller.signal);
    const result =
      selectedEngine === 'server-sandbox'
        ? await runEasyJSServerSandbox(codeToRun, ioOpts)
        : selectedEngine === 'interpreter'
          ? await runEasyJSInterpreted(codeToRun, ioOpts)
          : await runEasyJSAsync(codeToRun, ioOpts);

    if (runSeqRef.current === seq) {
      if (activeRunAbortRef.current === controller) {
        activeRunAbortRef.current = null;
      }
      setRunResult(result);
      setIsRunning(false);
      setPendingPrompt(null);
    }
  };

  const handleDebug = async () => {
    cancelActiveRun();
    const seq = ++runSeqRef.current;
    setLiveLogs([]);
    setLiveVisuals([]);

    const compiled = compileEasyJS(source, { optimize: false });
    if (!compiled.success) {
      setRunResult(compiled);
      return;
    }

    setIsRunning(true);
    const ioOpts = buildIoOptions(seq);
    const interp = new ASTInterpreter({
      ...ioOpts,
      breakpoints,
      startPaused: true,
      onPause: (snapshot) => {
        if (runSeqRef.current !== seq) return;
        setDebugSnapshot(snapshot);
        setLiveLogs(snapshot.logs);
        setLiveVisuals(snapshot.visualOutputs);
      },
    });
    activeDebuggerRef.current = interp;

    const execution = await interp.execute(compiled.transformedAst);
    if (runSeqRef.current === seq) {
      activeDebuggerRef.current = null;
      setRunResult({ ...compiled, execution });
      setDebugSnapshot(null);
      setIsRunning(false);
      setPendingPrompt(null);
    }
  };

  // --- File Saving & Local Storage Management ---
  const saveAsNamedFile = useCallback(
    (rawName: string, contentToSave: string = source): SavedWorkspaceFile => {
      const cleanName = sanitizeFileName(rawName);
      const existing = savedFiles.find(
        (f) => f.name.toLowerCase() === cleanName.toLowerCase()
      );
      let target: SavedWorkspaceFile;
      let nextFiles: SavedWorkspaceFile[];
      if (existing) {
        target = { ...existing, name: cleanName, content: contentToSave, updatedAt: Date.now() };
        nextFiles = savedFiles.map((f) => (f.id === existing.id ? target : f));
      } else {
        target = createSavedFileRecord(cleanName, contentToSave);
        nextFiles = [...savedFiles, target];
      }
      setSavedFiles(nextFiles);
      persistSavedFiles(nextFiles);
      setActiveFileId(target.id);
      appendTerminal('out', `Saved "${target.name}" to localStorage (${target.content.length} chars).`);
      return target;
    },
    [savedFiles, source, appendTerminal]
  );

  const handleSaveCurrentFile = useCallback(() => {
    if (activeSavedFile) {
      const updated: SavedWorkspaceFile = {
        ...activeSavedFile,
        content: source,
        updatedAt: Date.now(),
      };
      const nextFiles = savedFiles.map((f) => (f.id === updated.id ? updated : f));
      setSavedFiles(nextFiles);
      persistSavedFiles(nextFiles);
      appendTerminal('out', `Saved changes to "${updated.name}".`);
    } else {
      setSaveDialogName(`${selectedPresetId || 'my-app'}.ejs`);
      setSaveDialogOpen(true);
    }
  }, [activeSavedFile, savedFiles, source, selectedPresetId, appendTerminal]);

  const handleCreateNewFile = (rawName: string) => {
    const cleanName = sanitizeFileName(rawName);
    const starter = `# ${cleanName}\nimport yourgui from "stdlib/yourgui"\n\nheading("${cleanName}")\ntext("Edit this file and click Run Code to preview.")\n`;
    const created = saveAsNamedFile(cleanName, starter);
    setSource(created.content);
    setFocusedLine(null);
    void executeProgram(created.content, engine);
  };

  const handleOpenSavedFile = (id: string) => {
    const found = savedFiles.find((f) => f.id === id);
    if (!found) return;
    setActiveFileId(found.id);
    setSource(found.content);
    setFocusedLine(null);
    void executeProgram(found.content, engine);
    appendTerminal('out', `Opened "${found.name}" from File Explorer.`);
  };

  const handleRenameSavedFile = (id: string, nextRawName: string) => {
    const clean = sanitizeFileName(nextRawName);
    const nextFiles = savedFiles.map((f) =>
      f.id === id ? { ...f, name: clean, updatedAt: Date.now() } : f
    );
    setSavedFiles(nextFiles);
    persistSavedFiles(nextFiles);
    appendTerminal('out', `Renamed file to "${clean}".`);
  };

  const handleDeleteSavedFile = (id: string) => {
    const target = savedFiles.find((f) => f.id === id);
    const nextFiles = savedFiles.filter((f) => f.id !== id);
    setSavedFiles(nextFiles);
    persistSavedFiles(nextFiles);
    if (activeFileId === id) {
      setActiveFileId(null);
    }
    if (target) {
      appendTerminal('out', `Deleted "${target.name}" from localStorage.`);
    }
  };

  // Global Ctrl/Cmd+S shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveCurrentFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveCurrentFile]);

  const handleRun = () => {
    void executeProgram(source, engine);
  };

  const handleFormat = () => {
    setSource(formatEasyJS(source));
  };

  const handleToggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => {
      const next = prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line];
      activeDebuggerRef.current?.setBreakpoints(next);
      return next;
    });
  };

  const handleSubmitInput = (val: string) => {
    inputResolverRef.current?.resolve(val);
  };

  const handleSelectPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActiveFileId(null);
    setSelectedPresetId(id);
    setSource(preset.code);
    setFocusedLine(null);
    void executeProgram(preset.code, engine);
  };

  const handleReset = () => {
    if (activeSavedFile) {
      setSource(activeSavedFile.content);
      setFocusedLine(null);
      void executeProgram(activeSavedFile.content, engine);
      return;
    }
    const preset = PRESETS.find((p) => p.id === selectedPresetId) ?? PRESETS[0];
    setSource(preset.code);
    setFocusedLine(null);
    void executeProgram(preset.code, engine);
  };

  const handleRunTests = () => {
    setActiveView('tests');
    void executeAllTests().then((results) => setTestResults(results));
  };

  const handleGuiEvent = (
    elementId: string,
    eventType: string,
    payload?: { value?: string; checked?: boolean }
  ) => {
    if (guiDispatcherRef.current) {
      void guiDispatcherRef.current(elementId, eventType, payload);
    }
  };

  const visualOutputs =
    liveVisuals.length > 0 ? liveVisuals : (runResult.execution?.visualOutputs ?? []);

  // --- Terminal Command Dispatcher ---
  const handleRunTerminalCommand = async (rawCmd: string) => {
    appendTerminal('cmd', `$ ${rawCmd}`);
    const parts = rawCmd.trim().split(/\s+/);
    const cmd = (parts[0] ?? '').toLowerCase();
    const argRest = rawCmd.trim().slice(parts[0]?.length ?? 0).trim();

    if (cmd === 'help') {
      appendTerminal(
        'out',
        [
          'Commands:',
          '  run                 Run the active program',
          '  debug               Start step debugger',
          '  format              Format EasyJS source code',
          '  test | tests        Execute all compiler unit tests',
          '  save <name>         Save current code to localStorage & File Explorer',
          '  open <name>         Open saved file from localStorage & preview it',
          '  rm <name>           Delete saved file from localStorage',
          '  ls | files          List saved files in localStorage (or toggle explorer)',
          '  code                Show or hide the code editor',
          '  hide | show         Hide or show the console panel',
          '  vars                List runtime variables',
          '  ptrs                List static & dynamic pointers',
          '  dom [id]            Inspect YourGUI DOM tree or specific element',
          '  click <id|text>     Trigger click on a YourGUI button/element',
          '  location | pwd      Print current browser location URL',
          '  clear | cls         Clear terminal history',
          '  <EasyJS expr>       Evaluate any EasyJS expression or print statement',
        ].join('\n')
      );
      return;
    }

    if (cmd === 'clear' || cmd === 'cls') {
      setTerminalEntries([]);
      return;
    }
    if (cmd === 'run') {
      void executeProgram(source, engine);
      appendTerminal('out', 'Executed active program.');
      return;
    }
    if (cmd === 'debug') {
      void handleDebug();
      appendTerminal('out', 'Started debugger.');
      return;
    }
    if (cmd === 'format') {
      handleFormat();
      appendTerminal('out', 'Formatted source code.');
      return;
    }
    if (cmd === 'test' || cmd === 'tests') {
      const results = await executeAllTests();
      setTestResults(results);
      const passed = results.filter((r) => r.passed).length;
      appendTerminal('out', `Tests: ${passed}/${results.length} passed.`);
      return;
    }
    if (cmd === 'hide') {
      setConsoleHidden(true);
      return;
    }
    if (cmd === 'show') {
      setConsoleHidden(false);
      return;
    }
    if (cmd === 'code') {
      setShowCode((prev) => !prev);
      appendTerminal('out', !showCode ? 'Code editor visible.' : 'Code editor hidden.');
      return;
    }
    if (cmd === 'files') {
      setShowFiles((prev) => !prev);
      return;
    }
    if (cmd === 'ls') {
      if (savedFiles.length === 0) {
        appendTerminal('out', 'No saved files in localStorage yet. Use "save <name>" to store one.');
      } else {
        appendTerminal(
          'out',
          savedFiles
            .map((f) => `${f.id === activeFileId ? '* ' : '  '}${f.name} (${f.content.split('\n').length} lines)`)
            .join('\n')
        );
      }
      return;
    }
    if (cmd === 'save') {
      if (!argRest) {
        handleSaveCurrentFile();
      } else {
        const saved = saveAsNamedFile(argRest, source);
        appendTerminal('out', `File explorer updated with "${saved.name}".`);
      }
      return;
    }
    if (cmd === 'open') {
      if (!argRest) {
        appendTerminal('err', 'Usage: open <filename>');
        return;
      }
      const match = savedFiles.find(
        (f) => f.name.toLowerCase() === argRest.toLowerCase() || f.name.toLowerCase() === sanitizeFileName(argRest).toLowerCase()
      );
      if (!match) {
        appendTerminal('err', `Saved file "${argRest}" not found in localStorage.`);
        return;
      }
      handleOpenSavedFile(match.id);
      return;
    }
    if (cmd === 'rm') {
      const match = savedFiles.find(
        (f) => f.name.toLowerCase() === argRest.toLowerCase() || f.name.toLowerCase() === sanitizeFileName(argRest).toLowerCase()
      );
      if (!match) {
        appendTerminal('err', `Saved file "${argRest}" not found.`);
        return;
      }
      handleDeleteSavedFile(match.id);
      return;
    }
    if (cmd === 'vars') {
      const vars = debugSnapshot?.variables ?? runResult.execution?.finalVariables ?? [];
      if (vars.length === 0) {
        appendTerminal('out', 'No variables captured (run with AST Interpreter to inspect).');
      } else {
        appendTerminal('out', vars.map((v) => `${v.name}: ${v.type} = ${v.value}`).join('\n'));
      }
      return;
    }
    if (cmd === 'ptrs') {
      const ptrs = liveCompile.pointers;
      if (ptrs.length === 0) {
        appendTerminal('out', 'No static pointer declarations detected.');
      } else {
        appendTerminal(
          'out',
          ptrs.map((p) => `${p.name} (${p.mode}) state=${p.state} borrows=${p.borrowCount}`).join('\n')
        );
      }
      return;
    }
    if (cmd === 'dom') {
      const gui = visualOutputs.find(
        (v): v is Extract<VisualOutputItem, { kind: 'yourgui' }> => v.kind === 'yourgui'
      );
      if (!gui) {
        appendTerminal('out', 'No active YourGUI DOM tree rendered.');
        return;
      }
      if (argRest) {
        const node = findGuiNodeByIdOrLabel(gui.nodes, argRest);
        if (!node) {
          appendTerminal('err', `No element found matching "${argRest}".`);
        } else {
          appendTerminal('out', formatGuiDomTree([node]).join('\n'));
        }
      } else {
        appendTerminal('out', formatGuiDomTree(gui.nodes).join('\n') || '(empty DOM)');
      }
      return;
    }
    if (cmd === 'click') {
      const gui = visualOutputs.find(
        (v): v is Extract<VisualOutputItem, { kind: 'yourgui' }> => v.kind === 'yourgui'
      );
      if (!gui || !guiDispatcherRef.current) {
        appendTerminal('err', 'No active interactive YourGUI page.');
        return;
      }
      const node = findGuiNodeByIdOrLabel(gui.nodes, argRest);
      if (!node) {
        appendTerminal('err', `Element "${argRest}" not found in YourGUI DOM.`);
        return;
      }
      void guiDispatcherRef.current(node.id, 'click', {});
      appendTerminal('out', `Dispatched click to <${node.tag} #${node.attrs?.id ?? node.id}>.`);
      return;
    }
    if (cmd === 'location' || cmd === 'pwd') {
      appendTerminal(
        'out',
        `Browser location: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}\nActive file: ${activeSavedFile ? activeSavedFile.name : '(preset)'}`
      );
      return;
    }

    // Evaluate arbitrary EasyJS snippet
    const res = await runEasyJSInterpreted(rawCmd);
    if (!res.success) {
      appendTerminal('err', res.diagnostics.map((d) => d.message).join('\n'));
      return;
    }
    if (res.execution?.error) {
      appendTerminal('err', res.execution.error);
      return;
    }
    if (res.execution?.logs.length) {
      appendTerminal('out', res.execution.logs.join('\n'));
    } else if (res.execution?.returnValue !== undefined) {
      appendTerminal('out', String(res.execution.returnValue));
    } else {
      appendTerminal('out', '(ok)');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Toolbar
        activeView={activeView}
        onSelectView={setActiveView}
        presets={PRESETS}
        selectedPresetId={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        engine={engine}
        onSelectEngine={setEngine}
        onRun={handleRun}
        onDebug={handleDebug}
        onFormat={handleFormat}
        onReset={handleReset}
        onRunTests={handleRunTests}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        showCode={showCode}
        onToggleCode={() => setShowCode((s) => !s)}
        showFiles={showFiles}
        onToggleFiles={() => setShowFiles((s) => !s)}
        onSaveFile={handleSaveCurrentFile}
        activeFileName={activeSavedFile?.name ?? null}
        hasUnsavedChanges={hasUnsavedChanges}
        savedFilesCount={savedFiles.length}
      />

      {activeView === 'workspace' && (
        <main className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-1 min-h-0">
            {showFiles && (
              <FileExplorer
                files={savedFiles}
                activeFileId={activeFileId}
                hasUnsavedChanges={hasUnsavedChanges}
                showCode={showCode}
                onOpenFile={handleOpenSavedFile}
                onSaveCurrent={handleSaveCurrentFile}
                onSaveAs={(name) => {
                  saveAsNamedFile(name, source);
                }}
                onCreateNew={handleCreateNewFile}
                onRenameFile={handleRenameSavedFile}
                onDeleteFile={handleDeleteSavedFile}
                onToggleCode={() => setShowCode((s) => !s)}
                onClose={() => setShowFiles(false)}
              />
            )}

            {/* Preview-only by default (showCode === false), or split Editor + Preview when Show Code is toggled */}
            <div
              className={`grid flex-1 min-w-0 min-h-0 ${
                showCode ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {showCode && (
                <Editor
                  value={source}
                  onChange={setSource}
                  onRun={handleRun}
                  diagnostics={liveCompile.diagnostics}
                  symbols={liveCompile.symbols}
                  focusedLine={focusedLine}
                  debugLine={debugSnapshot?.status === 'paused' ? debugSnapshot.currentLine : null}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={handleToggleBreakpoint}
                />
              )}
              <Output
                compileResult={liveCompile}
                execution={runResult.execution}
                liveLogs={liveLogs}
                isRunning={isRunning}
                visualOutputs={visualOutputs}
                registeredRoutes={
                  debugSnapshot?.registeredRoutes ?? runResult.execution?.registeredRoutes ?? []
                }
                finalVariables={runResult.execution?.finalVariables ?? []}
                debugSnapshot={debugSnapshot}
                activeFileName={activeSavedFile?.name ?? null}
                onGuiEvent={handleGuiEvent}
              />
            </div>
          </div>

          <Console
            source={source}
            execution={runResult.execution}
            liveLogs={liveLogs}
            isRunning={isRunning}
            pendingPrompt={pendingPrompt}
            debugSnapshot={debugSnapshot}
            onDebugStep={() => activeDebuggerRef.current?.step()}
            onDebugContinue={() => activeDebuggerRef.current?.continue()}
            onDebugStop={cancelActiveRun}
            onSubmitInput={handleSubmitInput}
            onStopExecution={cancelActiveRun}
            diagnostics={liveCompile.diagnostics}
            testResults={testResults}
            onSelectLine={(line) => {
              setFocusedLine(line);
              setShowCode(true);
            }}
            onRunTests={() => void executeAllTests().then((results) => setTestResults(results))}
            isHidden={consoleHidden}
            onToggleHidden={() => setConsoleHidden((h) => !h)}
            terminalEntries={terminalEntries}
            onRunTerminalCommand={handleRunTerminalCommand}
          />
        </main>
      )}

      {activeView === 'guide' && (
        <SyntaxGuide
          onTryCode={(code) => {
            setActiveFileId(null);
            setSource(code);
            setFocusedLine(null);
            setActiveView('workspace');
            void executeProgram(code, engine);
          }}
        />
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
                onClick={() => void executeAllTests().then((results) => setTestResults(results))}
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

      {/* Save File Dialog (when saving an untitled preset to localStorage) */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px] p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-file-dialog-title"
            className="w-full max-w-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2
                id="save-file-dialog-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Save File to Local Storage
              </h2>
              <button
                type="button"
                onClick={() => setSaveDialogOpen(false)}
                aria-label="Close save dialog"
                className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!saveDialogName.trim()) return;
                saveAsNamedFile(saveDialogName, source);
                setSaveDialogOpen(false);
                setShowFiles(true);
              }}
              className="p-4 space-y-4"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="save-filename-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  File name (accessible in File Explorer)
                </label>
                <input
                  id="save-filename-input"
                  type="text"
                  value={saveDialogName}
                  onChange={(e) => setSaveDialogName(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PopupDialog request={popupRequest} />
    </div>
  );
}
