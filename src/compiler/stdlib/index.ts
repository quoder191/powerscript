import { BROWSER_STDLIB_SOURCE } from './browser.ts';
import { CORE_STDLIB_SOURCE } from './core.ts';
import { STACK_LIBRARY_SOURCE } from './stack.ts';
import { SYSTEM_STDLIB_SOURCE } from './system.ts';

export function buildRuntimePrelude(): string {
  return `// EasyJS Modular Standard Library Prelude (Core · Browser · System · Stack)
const __ejs = (() => {
  const pointerEvents = [];
  const stdinQueue = Array.isArray(globalThis.__ejs_stdin) ? [...globalThis.__ejs_stdin] : [];
  const ioHandler = typeof globalThis.__ejs_io === "object" && globalThis.__ejs_io ? globalThis.__ejs_io : null;

  const formatVal = (v) => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "object" && v.__ptrKind) {
      if (!v.alive) return \`<\${v.__ptrKind} \${v.name}: dropped>\`;
      if (v.moved) return \`<\${v.__ptrKind} \${v.name}: moved>\`;
      return \`<\${v.__ptrKind} \${v.name}: \${formatVal(v.__ptrKind === 'ref' ? v.target.value : v.value)}>\`;
    }
    if (typeof v === "object" && v.__enumTag) {
      const vals = v.__payload ? Object.values(v.__payload).map(formatVal).join(", ") : "";
      return vals ? \`\${v.__enumName}.\${v.__enumTag}(\${vals})\` : \`\${v.__enumName}.\${v.__enumTag}\`;
    }
    if (v instanceof Stack) return \`Stack[\${v._items.map(formatVal).join(", ")}]\`;
    if (v instanceof Queue) return \`Queue[\${v._items.map(formatVal).join(", ")}]\`;
    if (v instanceof Set) return \`Set{\${Array.from(v).map(formatVal).join(", ")}}\`;
    if (Array.isArray(v)) return "[" + v.map(formatVal).join(", ") + "]";
    if (typeof v === "object" && typeof v.toString === "function" && v.toString !== Object.prototype.toString) {
      return v.toString();
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  class Stack {
    constructor(initial = []) {
      this._items = Array.isArray(initial) ? [...initial] : [];
    }
    push(val) { this._items.push(val); return this._items.length; }
    append(val) { return this.push(val); }
    pop() {
      if (this._items.length === 0) throw new Error("RuntimeError: Cannot pop from an empty Stack");
      return this._items.pop();
    }
    peek() { return this._items.length > 0 ? this._items[this._items.length - 1] : null; }
    top() { return this.peek(); }
    isEmpty() { return this._items.length === 0; }
    len() { return this._items.length; }
    size() { return this._items.length; }
    contains(val) { return this._items.includes(val); }
    clear() { this._items.length = 0; return this; }
    toArray() { return [...this._items]; }
    toString() { return \`Stack[\${this._items.map(formatVal).join(", ")}]\`; }
  }

  class Queue {
    constructor(initial = []) {
      this._items = Array.isArray(initial) ? [...initial] : [];
    }
    enqueue(val) { this._items.push(val); return this._items.length; }
    push(val) { return this.enqueue(val); }
    dequeue() {
      if (this._items.length === 0) throw new Error("RuntimeError: Cannot dequeue from an empty Queue");
      return this._items.shift();
    }
    pop() { return this.dequeue(); }
    peek() { return this._items.length > 0 ? this._items[0] : null; }
    isEmpty() { return this._items.length === 0; }
    len() { return this._items.length; }
    size() { return this._items.length; }
    contains(val) { return this._items.includes(val); }
    clear() { this._items.length = 0; return this; }
    toArray() { return [...this._items]; }
    toString() { return \`Queue[\${this._items.map(formatVal).join(", ")}]\`; }
  }

  const makeConstructible = (Cls) =>
    new Proxy(Cls, {
      apply(target, _thisArg, args) {
        return new target(...args);
      },
    });

  const StackCtor = makeConstructible(Stack);
  const QueueCtor = makeConstructible(Queue);
  const SetCtor = makeConstructible(Set);

${CORE_STDLIB_SOURCE}
${BROWSER_STDLIB_SOURCE}
${SYSTEM_STDLIB_SOURCE}
${STACK_LIBRARY_SOURCE}

  const callMethod = (obj, method, args = [], optional = false) => {
    if (obj === null || obj === undefined) {
      if (optional) return undefined;
      throw new Error(\`NullPointerError: Cannot call '.\${method}()' on null\`);
    }

    // Preserve \`this\` on class instances, structs, Stack, Queue, or namespace objects (like stackLib)
    if (
      typeof obj === "object" &&
      !Array.isArray(obj) &&
      !(obj instanceof Set) &&
      typeof obj[method] === "function"
    ) {
      return obj[method](...args);
    }

    if (Array.isArray(obj)) {
      switch (method) {
        case "append":
        case "push":
          obj.push(...args);
          return obj;
        case "prepend":
          obj.unshift(...args);
          return obj;
        case "pop":
          return obj.pop();
        case "insert":
          obj.splice(args[0], 0, args[1]);
          return obj;
        case "remove": {
          const idx = obj.indexOf(args[0]);
          if (idx !== -1) { obj.splice(idx, 1); return true; }
          return false;
        }
        case "removeAt":
          return obj.splice(args[0], 1)[0];
        case "removeAll": {
          for (let i = obj.length - 1; i >= 0; i--) {
            if (obj[i] === args[0]) obj.splice(i, 1);
          }
          return obj;
        }
        case "sort":
          return smartSort(obj, false, args[0]);
        case "sortDesc":
          return smartSort(obj, true, args[0]);
        case "shuffle":
          return shuffleArray(obj);
        case "find":
          return typeof args[0] === "function"
            ? obj.find(args[0])
            : obj.find((el) => el === args[0]);
        case "findIndex":
          return typeof args[0] === "function"
            ? obj.findIndex(args[0])
            : obj.indexOf(args[0]);
        case "contains":
        case "has":
          return obj.includes(args[0]);
        case "reverse":
          return obj.reverse();
        case "unique":
          return [...new Set(obj)];
        case "clear":
          obj.length = 0;
          return obj;
        case "first":
          return obj[0] ?? null;
        case "last":
          return obj[obj.length - 1] ?? null;
        case "len":
        case "length":
        case "size":
          return obj.length;
        case "isEmpty":
          return obj.length === 0;
        case "sum":
          return obj.reduce((a, b) => a + b, 0);
        case "avg":
          return obj.length ? obj.reduce((a, b) => a + b, 0) / obj.length : 0;
        case "min":
          return obj.length ? Math.min(...obj) : null;
        case "max":
          return obj.length ? Math.max(...obj) : null;
        case "clone":
          return [...obj];
        default:
          if (typeof obj[method] === "function") return obj[method](...args);
      }
    }

    if (typeof obj === "string") {
      switch (method) {
        case "upper":
        case "uppercase":
        case "toUpper":
          return obj.toUpperCase();
        case "lower":
        case "lowercase":
        case "toLower":
          return obj.toLowerCase();
        case "trim":
          return obj.trim();
        case "split":
          return obj.split(args[0] ?? " ");
        case "replace":
          return obj.split(args[0]).join(args[1] ?? "");
        case "contains":
        case "has":
          return obj.includes(args[0]);
        case "reverse":
          return obj.split("").reverse().join("");
        case "chars":
          return obj.split("");
        case "len":
        case "length":
        case "size":
          return obj.length;
        case "isEmpty":
          return obj.length === 0;
        case "toInt":
          return toInt(obj);
        case "toFloat":
          return toFloat(obj);
        default:
          if (typeof obj[method] === "function") return obj[method](...args);
      }
    }

    if (typeof obj === "number") {
      switch (method) {
        case "abs": return Math.abs(obj);
        case "round": return Math.round(obj);
        case "floor": return Math.floor(obj);
        case "ceil": return Math.ceil(obj);
        case "sqrt": return Math.sqrt(obj);
        case "pow": return Math.pow(obj, args[0] ?? 2);
        case "toInt": return Math.trunc(obj);
        case "toFloat": return Number(obj);
        case "toStr": return String(obj);
        case "clamp": return Math.min(Math.max(obj, args[0]), args[1]);
        case "isEven": return obj % 2 === 0;
        case "isOdd": return Math.abs(obj % 2) === 1;
        default:
          if (typeof obj[method] === "function") return obj[method](...args);
      }
    }

    if (obj instanceof Set) {
      switch (method) {
        case "append":
        case "add":
          obj.add(args[0]); return obj;
        case "remove":
          return obj.delete(args[0]);
        case "has":
        case "contains":
          return obj.has(args[0]);
        case "len":
        case "length":
        case "size":
          return obj.size;
        case "clear":
          obj.clear(); return obj;
        case "toArray":
          return Array.from(obj);
      }
    }

    if (typeof obj === "object") {
      switch (method) {
        case "set":
          obj[args[0]] = args[1];
          return obj;
        case "get":
          return Object.prototype.hasOwnProperty.call(obj, args[0]) ? obj[args[0]] : (args[1] ?? null);
        case "has":
        case "contains":
          return Object.prototype.hasOwnProperty.call(obj, args[0]);
        case "remove":
        case "delete": {
          const existed = Object.prototype.hasOwnProperty.call(obj, args[0]);
          delete obj[args[0]];
          return existed;
        }
        case "keys":
          return Object.keys(obj);
        case "values":
          return Object.values(obj);
        case "entries":
          return Object.entries(obj);
        case "len":
        case "length":
        case "size":
          return Object.keys(obj).length;
        case "isEmpty":
          return Object.keys(obj).length === 0;
        case "clear":
          for (const k of Object.keys(obj)) delete obj[k];
          return obj;
        case "merge":
          Object.assign(obj, args[0] || {});
          return obj;
        case "find": {
          const pred = args[0];
          for (const [k, v] of Object.entries(obj)) {
            if (typeof pred === "function" ? pred(v, k) : v === pred) return [k, v];
          }
          return null;
        }
        case "sortKeys": {
          const sorted = {};
          for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
          return sorted;
        }
        case "clone":
          return { ...obj };
      }
    }

    if (typeof obj[method] === "function") {
      return obj[method](...args);
    }
    throw new Error(\`MethodError: '\${typeof obj}' has no method '\${method}()'\`);
  };

  const iter = (x) => {
    if (x === null || x === undefined) return [];
    if (Array.isArray(x) || typeof x === "string" || x instanceof Set) return x;
    if (x instanceof Stack || x instanceof Queue) return x.toArray();
    if (typeof x[Symbol.iterator] === "function") return x;
    if (typeof x === "object") return Object.keys(x);
    return [];
  };

  return {
    pointerEvents,
    cleanupTimers,
    call: callMethod,
    iter,
    has: hasMember,
    stack: stackLib,
    Stack: StackCtor,
    Queue: QueueCtor,
    Dict: (init) => ({ ...(init || {}) }),
    List: (...items) => (items.length === 1 && Array.isArray(items[0]) ? [...items[0]] : items),
    Set: SetCtor,

    // Core I/O & Type Conversions
    print: (...args) => {
      const text = args.map(formatVal).join(" ");
      console.log(text);
      return text;
    },
    println: (...args) => {
      const text = args.map(formatVal).join(" ");
      console.log(text);
      return text;
    },
    write: (...args) => {
      const text = args.map(formatVal).join(" ");
      console.log(text);
      return text;
    },
    toInt,
    int: toInt,
    toFloat,
    float: toFloat,
    toStr: (x) => formatVal(x),
    str: (x) => formatVal(x),
    toText: (x) => formatVal(x),
    toBool: (x) => Boolean(x),
    len: getLength,
    length: getLength,
    typeOf: (x) => {
      if (x === null) return "null";
      if (Array.isArray(x)) return "array";
      if (x instanceof Stack) return "stack";
      if (x instanceof Queue) return "queue";
      if (x instanceof Set) return "set";
      if (typeof x === "object" && x.__ptrKind) return \`ptr<\${x.__ptrKind}>\`;
      if (typeof x === "object" && x.__enumTag) return x.__enumName;
      if (typeof x === "object" && x.__structName) return x.__structName;
      if (typeof x === "object") return "dict";
      if (typeof x === "number") return Number.isInteger(x) ? "int" : "float";
      if (typeof x === "string") return "text";
      return typeof x;
    },
    assert: (cond, msg = "Assertion failed") => {
      if (!cond) throw new Error("AssertionError: " + msg);
      return true;
    },
    range: (start, end, inclusive = false) => {
      const out = [];
      const limit = inclusive ? end + 1 : end;
      for (let i = start; i < limit; i++) out.push(i);
      return out;
    },

    // Core Strings (18-25) & Collections (26-34)
    uppercase: (s) => String(s).toUpperCase(),
    upper: (s) => String(s).toUpperCase(),
    lowercase: (s) => String(s).toLowerCase(),
    lower: (s) => String(s).toLowerCase(),
    trim: (s) => String(s).trim(),
    split: (s, sep = " ") => String(s).split(sep),
    join: (arr, sep = ", ") => arr.join(sep),
    replace: (s, a, b) => String(s).split(a).join(b),
    reverse: (x) => (typeof x === "string" ? x.split("").reverse().join("") : [...x].reverse()),
    contains: (col, val) => hasMember(col, val),
    append: (arr, val) => { arr.push(val); return arr; },
    push: (col, val) => callMethod(col, "push", [val]),
    pop: (col) => callMethod(col, "pop", []),
    remove: (col, keyOrVal) => callMethod(col, "remove", [keyOrVal]),
    sort: (arr, desc = false) => smartSort(arr, desc),
    shuffle: (arr) => shuffleArray(arr),
    find: (col, predOrVal) => callMethod(col, "find", [predOrVal]),
    filter: (arr, fn) => arr.filter(fn),
    unique: (arr) => [...new Set(arr)],
    first: (arr) => arr[0] ?? null,
    last: (arr) => arr[arr.length - 1] ?? null,
    keys: (obj) => Object.keys(obj || {}),
    values: (obj) => Object.values(obj || {}),
    entries: (obj) => Object.entries(obj || {}),
    map: (arr, fn) => arr.map(fn),
    reduce: (arr, fn, init) => arr.reduce(fn, init),
    sum: (arr) => arr.reduce((a, b) => a + b, 0),
    avg: (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0),
    take: (arr, n) => arr.slice(0, n),

    // Math
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    pow: Math.pow,
    min: (...xs) => (xs.length === 1 && Array.isArray(xs[0]) ? Math.min(...xs[0]) : Math.min(...xs)),
    max: (...xs) => (xs.length === 1 && Array.isArray(xs[0]) ? Math.max(...xs[0]) : Math.max(...xs)),
    clamp: (n, lo, hi) => Math.min(Math.max(n, lo), hi),
    random: randomNum,
    randInt: (lo, hi) => randomNum(lo, hi),

    // Browser & Interactive
    input: (promptText = "") => readInputRaw(promptText),
    ask: (promptText = "") => readInputRaw(promptText),
    prompt: (promptText = "") => readInputRaw(promptText),
    inputInt: (promptText = "") => {
      const raw = readInputRaw(promptText);
      if (raw && typeof raw.then === "function") return raw.then(toInt);
      return toInt(raw);
    },
    inputFloat: (promptText = "") => {
      const raw = readInputRaw(promptText);
      if (raw && typeof raw.then === "function") return raw.then(toFloat);
      return toFloat(raw);
    },
    confirm: (promptText = "") => {
      const parseBool = (v) => ["y", "yes", "true", "1"].includes(String(v).trim().toLowerCase());
      const raw = readInputRaw(promptText);
      if (raw && typeof raw.then === "function") return raw.then(parseBool);
      return parseBool(raw);
    },
    alert: browserAlert,
    browser: browserOpen,
    copy: copyText,
    speak: speakText,
    listen: listenSpeech,
    fetch: fetchData,

    // System & Filesystem
    sleep: (ms = 100) => new Promise((resolve) => {
      const id = setTimeout(() => { activeTimeouts.delete(id); resolve(true); }, ms);
      activeTimeouts.add(id);
    }),
    time: getCurrentTime,
    date: getCurrentDate,
    timer: startTimer,
    interval: startInterval,
    stop: () => stopProgram("Stopped by stop()"),
    exit: () => stopProgram("Exited by exit()"),
    download: downloadFile,
    readFile: readFileVfs,
    writeFile: writeFileVfs,
    deleteFile: deleteFileVfs,

    // Smart & Rule Pointers
    own: (value, name = "own") => {
      const cell = { __ptrKind: "own", name, value, alive: true, moved: false };
      pointerEvents.push({ op: "own", name, state: "active", detail: formatVal(value) });
      return cell;
    },
    move: (ptr, newName = "moved") => {
      if (!ptr || ptr.__ptrKind !== "own") return ptr;
      if (!ptr.alive) throw new Error(\`RuntimeRuleError: Cannot move dropped pointer '\${ptr.name}'\`);
      if (ptr.moved) throw new Error(\`RuntimeRuleError: Cannot move '\${ptr.name}' twice\`);
      const val = ptr.value;
      ptr.moved = true;
      ptr.value = undefined;
      pointerEvents.push({ op: "move", name: ptr.name, state: "moved", detail: \`-> \${newName}\` });
      return { __ptrKind: "own", name: newName, value: val, alive: true, moved: false };
    },
    borrow: (target, name = "ref") => {
      if (target && target.__ptrKind) {
        if (!target.alive) throw new Error(\`RuntimeRuleError: Cannot borrow dropped pointer '\${target.name}'\`);
        if (target.moved) throw new Error(\`RuntimeRuleError: Cannot borrow moved pointer '\${target.name}'\`);
        const cell = { __ptrKind: "ref", name, target, alive: true, moved: false };
        pointerEvents.push({ op: "borrow", name, state: "borrowed", detail: \`-> \${target.name}\` });
        return cell;
      }
      const box = { __ptrKind: "own", name: "target", value: target, alive: true, moved: false };
      return { __ptrKind: "ref", name, target: box, alive: true, moved: false };
    },
    share: (value, name = "shared") => {
      const cell = {
        __ptrKind: "shared",
        name,
        value,
        alive: true,
        moved: false,
        refCount: 1,
        clone() {
          if (!this.alive) throw new Error(\`RuntimeRuleError: Cannot clone dropped shared pointer '\${this.name}'\`);
          this.refCount += 1;
          pointerEvents.push({ op: "clone", name: this.name, state: "active", detail: \`refCount=\${this.refCount}\` });
          return this;
        },
        count() {
          return this.refCount;
        },
      };
      pointerEvents.push({ op: "shared", name, state: "active", detail: "refCount=1" });
      return cell;
    },
    deref: (ptr) => {
      if (!ptr || !ptr.__ptrKind) return ptr;
      if (ptr.__ptrKind === "ref") {
        if (!ptr.target.alive) throw new Error(\`RuntimeRuleError: Dangling borrow '\${ptr.name}' (owner dropped)\`);
        if (ptr.target.moved) throw new Error(\`RuntimeRuleError: Dangling borrow '\${ptr.name}' (owner moved)\`);
        return ptr.target.value;
      }
      if (!ptr.alive) throw new Error(\`RuntimeRuleError: Dereference of dropped pointer '\${ptr.name}'\`);
      if (ptr.moved) throw new Error(\`RuntimeRuleError: Dereference of moved pointer '\${ptr.name}'\`);
      return ptr.value;
    },
    setDeref: (ptr, val) => {
      if (!ptr || !ptr.__ptrKind) throw new Error("RuntimeRuleError: Cannot dereference-assign non-pointer");
      if (ptr.__ptrKind === "ref") throw new Error(\`RuntimeRuleError: Cannot mutate through immutable rule reference '\${ptr.name}'\`);
      if (!ptr.alive) throw new Error(\`RuntimeRuleError: Write to dropped pointer '\${ptr.name}'\`);
      if (ptr.moved) throw new Error(\`RuntimeRuleError: Write to moved pointer '\${ptr.name}'\`);
      ptr.value = val;
      return val;
    },
    drop: (ptr) => {
      if (!ptr || !ptr.__ptrKind) return null;
      if (ptr.__ptrKind === "shared") {
        ptr.refCount = Math.max(0, ptr.refCount - 1);
        if (ptr.refCount === 0) {
          ptr.alive = false;
          ptr.value = undefined;
        }
        pointerEvents.push({ op: "drop", name: ptr.name, state: ptr.alive ? "active" : "dropped", detail: \`refCount=\${ptr.refCount}\` });
        return null;
      }
      if (!ptr.alive) throw new Error(\`RuntimeRuleError: Double drop on '\${ptr.name}'\`);
      ptr.alive = false;
      ptr.value = undefined;
      pointerEvents.push({ op: "drop", name: ptr.name, state: "dropped", detail: "released" });
      return null;
    },
    refCount: (ptr) => (ptr && ptr.__ptrKind === "shared" ? ptr.refCount : ptr && ptr.alive ? 1 : 0),
    matchEnum: (subject, enumName, variant) =>
      Boolean(subject && subject.__enumTag === variant && (!enumName || subject.__enumName === enumName)),
  };
})();
const {
  stack, Stack, Queue, Dict, List, Set: EjsSet,
  print, println, write, input, ask, prompt, inputInt, inputFloat, confirm, alert,
  browser, copy, speak, listen, fetch,
  sleep, time, date, timer, interval, stop, exit, download, readFile, writeFile, deleteFile,
  toInt, int, toFloat, float, toStr, str, toText, toBool,
  len, length, typeOf, assert, range,
  uppercase, upper, lowercase, lower, trim, split, join, replace, reverse, contains,
  append, push, pop, remove, sort, shuffle, find, filter, unique, first, last,
  keys, values, entries, map, reduce, sum, avg, take,
  abs, round, floor, ceil, sqrt, pow, min, max, clamp, random, randInt,
  refCount
} = __ejs;
const share = (v) => __ejs.share(v);
const own = (v) => __ejs.own(v);
const drop = (p) => __ejs.drop(p);
// --- EasyJS Program ---`;
}
