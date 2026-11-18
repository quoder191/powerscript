import { BROWSER_STDLIB_SOURCE } from './browser.ts';
import { CORE_STDLIB_SOURCE } from './core.ts';
import { MODULES_STDLIB_SOURCE } from './modules.ts';
import { STACK_LIBRARY_SOURCE } from './stack.ts';
import { SYSTEM_STDLIB_SOURCE } from './system.ts';
import { YOURGUI_STDLIB_SOURCE } from './yourgui/index.ts';

export function buildRuntimePrelude(): string {
  return `// EasyJS Modular Standard Library Prelude (Core · Browser · System · Stack)
const __ejs_host_fetch = typeof __ejs_fetch === "function" ? __ejs_fetch : null;
const __ejs_host_Proxy = typeof __ejs_Proxy === "function" ? __ejs_Proxy : (typeof Proxy === "function" ? Proxy : null);
const __ejs = (() => {
  const pointerEvents = [];
  const stdinQueue = typeof __ejs_stdin !== "undefined" && Array.isArray(__ejs_stdin) ? [...__ejs_stdin] : [];
  const ioHandler = typeof __ejs_io !== "undefined" && typeof __ejs_io === "object" && __ejs_io ? __ejs_io : null;

  const formatVal = (v) => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "object" && v.__ptrKind) {
      if (!v.alive) return \`<\${v.__ptrKind} \${v.name}: dropped>\`;
      if (v.moved) return \`<\${v.__ptrKind} \${v.name}: moved>\`;
      if (v.__ptrKind === "ptr") {
        const cur = typeof v.get === "function" ? v.get() : v.value;
        return \`<ptr \${v.name} @ \${v.addr}: \${formatVal(cur)}>\`;
      }
      if (v.__ptrKind === "weak") {
        return v.expired() ? \`<weak_ptr \${v.name}: expired>\` : \`<weak_ptr \${v.name}: \${formatVal(v.target.value)}>\`;
      }
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

  const makeConstructible = (Cls) => {
    function Constructible(...args) {
      return new Cls(...args);
    }
    Constructible.prototype = Cls.prototype;
    return Constructible;
  };

  const StackCtor = makeConstructible(Stack);
  const QueueCtor = makeConstructible(Queue);
  const SetCtor = makeConstructible(Set);

${CORE_STDLIB_SOURCE}
${BROWSER_STDLIB_SOURCE}
${SYSTEM_STDLIB_SOURCE}
${STACK_LIBRARY_SOURCE}
${YOURGUI_STDLIB_SOURCE}
${MODULES_STDLIB_SOURCE}

  const callMethod = (obj, method, args = [], optional = false) => {
    if (obj === null || obj === undefined) {
      if (optional) return undefined;
      throw new Error(\`NullPointerError: Cannot call '.\${method}()' on null\`);
    }

    // Pointer deref method delegation for ptr->method()
    if (typeof obj === "object" && obj.__ptrKind) {
      if (typeof obj[method] === "function") {
        return obj[method](...args);
      }
      return callMethod(deref(obj), method, args, optional);
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
    visualOutputs,
    registeredRoutes,
    cleanupTimers,
    call: callMethod,
    iter,
    has: hasMember,
    loadModule,
    stack: stackLib,
    db: dbLib,
    server: serverLib,
    ui: uiLib,
    http: httpLib,
    pkg: pkgLib,
    yourgui: yourguiLib,
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

    // Extra utility helpers
    slugify: (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    capitalize: (s) => {
      const str = String(s);
      return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
    },
    truncate: (s, maxLen = 40) => {
      const str = String(s);
      return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
    },
    chunk: (arr, size = 2) => {
      const out = [];
      for (let i = 0; i < arr.length; i += Math.max(1, size)) out.push(arr.slice(i, i + Math.max(1, size)));
      return out;
    },
    zip: (a, b) => a.map((v, i) => [v, b[i] ?? null]),
    deepClone: (v) => JSON.parse(JSON.stringify(v)),
    formatCurrency: (n, symbol = "$") => \`\${symbol}\${Number(n).toFixed(2)}\`,
    percent: (part, total) => (total === 0 ? "0%" : \`\${((part / total) * 100).toFixed(1)}%\`),

    // Browser & Interactive (exact JS popup semantics for alert/confirm/prompt)
    input: (promptText = "") => readInputRaw(promptText),
    ask: (promptText = "") => readInputRaw(promptText),
    prompt: (promptText = "", defaultValue = "") => browserPrompt(promptText, defaultValue),
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
    confirm: (promptText = "") => browserConfirm(promptText),
    alert: (msg = "") => browserAlert(msg),
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

    // Smart, C++ & Rule Pointers + Memory Management
    ...(() => {
      let nextAddr = 0x1000;
      const nextHexAddr = () => {
        nextAddr += 8;
        return "0x7ff" + nextAddr.toString(16).padStart(8, "0");
      };

      const browserLocation = () => {
        const loc = typeof location !== "undefined" && location ? location : null;
        return {
          href: loc ? String(loc.href || "about:blank") : "about:blank",
          pathname: loc ? String(loc.pathname || "/") : "/",
          hostname: loc ? String(loc.hostname || "localhost") : "localhost",
          origin: loc ? String(loc.origin || "null") : "null",
          protocol: loc ? String(loc.protocol || "http:") : "http:",
          search: loc ? String(loc.search || "") : "",
          hash: loc ? String(loc.hash || "") : "",
        };
      };

      const wrapPtrProxy = (cell) => {
        if (!__ejs_host_Proxy) return cell;
        const proxy = new __ejs_host_Proxy(cell, {
          get(target, prop) {
            if (prop === Symbol.toPrimitive) return () => target.addr || formatVal(proxy);
            if (prop === "__rawCell") return target;
            if (prop === "addr" || prop === "address") return target.addr;
            if (prop === "location") return browserLocation();
            if (prop === "value") return target.get();
            if (prop in target) {
              const val = target[prop];
              return typeof val === "function" ? val.bind(target) : val;
            }
            if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
              const idx = Number(prop);
              if (!target.alive) throw new Error(\`NullPointerError: Dereference of freed/null pointer '\${target.name}'\`);
              if (target.__heapArray) {
                const pos = (target.offset || 0) + idx;
                if (pos < 0 || pos >= target.__heapArray.length) {
                  throw new Error(\`BoundsError: Heap index \${pos} out of bounds (length \${target.__heapArray.length})\`);
                }
                return target.__heapArray[pos];
              }
              const cur = target.get();
              if (Array.isArray(cur) || typeof cur === "string") return cur[idx];
              if (idx === 0) return cur;
              return undefined;
            }
            const cur = target.get();
            if (cur !== null && cur !== undefined && (typeof cur === "object" || typeof cur === "string")) {
              const member = cur[prop];
              return typeof member === "function" ? member.bind(cur) : member;
            }
            return undefined;
          },
          set(target, prop, val) {
            if (prop === "value") {
              target.set(val);
              return true;
            }
            if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
              const idx = Number(prop);
              if (!target.alive) throw new Error(\`NullPointerError: Write to freed/null pointer '\${target.name}'\`);
              if (target.isConst) throw new Error(\`RuntimeRuleError: Cannot modify value through const pointer '\${target.name}'\`);
              if (target.__heapArray) {
                const pos = (target.offset || 0) + idx;
                if (pos < 0 || pos >= target.__heapArray.length) {
                  throw new Error(\`BoundsError: Heap index \${pos} out of bounds (length \${target.__heapArray.length})\`);
                }
                target.__heapArray[pos] = val;
                return true;
              }
              const cur = target.get();
              if (Array.isArray(cur)) {
                cur[idx] = val;
                return true;
              }
              if (idx === 0) {
                target.set(val);
                return true;
              }
              return false;
            }
            if (prop in target) {
              target[prop] = val;
              return true;
            }
            if (!target.alive) throw new Error(\`NullPointerError: Member write on freed pointer '\${target.name}'\`);
            if (target.isConst) throw new Error(\`RuntimeRuleError: Cannot modify field through const pointer '\${target.name}'\`);
            const cur = target.get();
            if (cur && typeof cur === "object") {
              cur[prop] = val;
              return true;
            }
            return false;
          },
        });
        return proxy;
      };

      const addrOf = (getter, setter, name = "ptr", isConst = false) => {
        const addr = nextHexAddr();
        const cell = {
          __ptrKind: "ptr",
          name,
          addr,
          alive: true,
          moved: false,
          isConst,
          offset: 0,
          get() {
            if (!this.alive) throw new Error(\`NullPointerError: Dereference of freed/null pointer '\${this.name}'\`);
            if (this.moved) throw new Error(\`RuntimeRuleError: Dereference of moved pointer '\${this.name}'\`);
            return getter();
          },
          set(v) {
            if (!this.alive) throw new Error(\`NullPointerError: Write to freed/null pointer '\${this.name}'\`);
            if (this.isConst) throw new Error(\`RuntimeRuleError: Cannot modify value through const pointer '\${this.name}'\`);
            if (!setter) throw new Error(\`RuntimeRuleError: Pointer '\${this.name}' has no mutable backing target\`);
            setter(v);
            return v;
          },
          toString() { return \`<ptr \${this.name} @ \${this.addr}: \${formatVal(this.get())}>\`; },
        };
        pointerEvents.push({ op: "addr", name, state: "active", detail: addr });
        return wrapPtrProxy(cell);
      };

      const addressOf = (target, name = "addr") => {
        if (target && typeof target === "object" && target.__ptrKind) return target;
        let box = target;
        return addrOf(() => box, (v) => { box = v; }, name, false);
      };

      const allocSingle = (val = null, typeName = "T") => {
        const addr = nextHexAddr();
        const cell = {
          __ptrKind: "ptr",
          __heapAllocated: true,
          __typeName: typeName,
          name: \`heap<\${typeName}>\`,
          addr,
          alive: true,
          moved: false,
          isConst: false,
          value: val,
          get() {
            if (!this.alive) throw new Error(\`NullPointerError: Use after delete on '\${this.name}'\`);
            return this.value;
          },
          set(v) {
            if (!this.alive) throw new Error(\`NullPointerError: Write after delete on '\${this.name}'\`);
            this.value = v;
            return v;
          },
          free() {
            if (!this.alive) throw new Error(\`RuntimeRuleError: Double delete on '\${this.name}'\`);
            this.alive = false;
            this.value = undefined;
          },
          toString() { return \`<heap \${this.name} @ \${this.addr}: \${this.alive ? formatVal(this.value) : "deleted"}>\`; },
        };
        pointerEvents.push({ op: "new", name: cell.name, state: "active", detail: addr });
        return wrapPtrProxy(cell);
      };

      const allocArray = (count, typeName = "T") => {
        const n = Math.max(0, Math.trunc(Number(count) || 0));
        const fill = ["int", "float", "number", "double", "long", "short"].includes(typeName)
          ? 0
          : ["str", "string", "text"].includes(typeName)
            ? ""
            : typeName === "bool" || typeName === "boolean"
              ? false
              : null;
        const buf = Array.from({ length: n }, () => fill);
        const addr = nextHexAddr();
        const makeSlice = (offset) => {
          const cell = {
            __ptrKind: "ptr",
            __heapAllocated: true,
            __isArray: true,
            __heapArray: buf,
            __typeName: typeName,
            offset,
            name: \`heap<\${typeName}[\${n}]>\`,
            addr,
            alive: true,
            moved: false,
            isConst: false,
            get() {
              if (!this.alive) throw new Error(\`NullPointerError: Use after delete[] on '\${this.name}'\`);
              return this.__heapArray[this.offset];
            },
            set(v) {
              if (!this.alive) throw new Error(\`NullPointerError: Write after delete[] on '\${this.name}'\`);
              this.__heapArray[this.offset] = v;
              return v;
            },
            offsetPtr(delta) {
              return makeSlice(this.offset + Math.trunc(Number(delta) || 0));
            },
            free() {
              if (!this.alive) throw new Error(\`RuntimeRuleError: Double delete[] on '\${this.name}'\`);
              this.alive = false;
              this.__heapArray.length = 0;
            },
            toString() { return \`<array_ptr \${this.name}[\${this.offset}] @ \${this.addr}>\`; },
          };
          return wrapPtrProxy(cell);
        };
        pointerEvents.push({ op: "new[]", name: \`heap<\${typeName}[\${n}]>\`, state: "active", detail: addr });
        return makeSlice(0);
      };

      const ptrAdd = (p, delta) => {
        if (p && typeof p === "object" && p.__ptrKind === "ptr" && typeof p.offsetPtr === "function") {
          return p.offsetPtr(delta);
        }
        return p + delta;
      };

      const sizeof = (vOrType) => {
        if (typeof vOrType === "string") {
          if (vOrType.includes("*") || vOrType.includes("&")) return 8;
          switch (vOrType) {
            case "bool": case "boolean": case "char": return 1;
            case "short": return 2;
            case "int": case "float": return 4;
            case "double": case "long": case "number": case "ptr": return 8;
            case "str": case "string": case "text": return 24;
            default: return 8;
          }
        }
        if (vOrType === null || vOrType === undefined) return 8;
        if (typeof vOrType === "boolean") return 1;
        if (typeof vOrType === "number") return Number.isInteger(vOrType) ? 4 : 8;
        if (typeof vOrType === "string") return vOrType.length;
        if (Array.isArray(vOrType)) return vOrType.length * 8;
        if (typeof vOrType === "object") {
          if (vOrType.__heapArray) return vOrType.__heapArray.length * 8;
          if (vOrType.__ptrKind) return 8;
          return Object.keys(vOrType).length * 8;
        }
        return 8;
      };

      const makeUnique = (val, name = "unique_ptr") => {
        const addr = nextHexAddr();
        const cell = {
          __ptrKind: "unique",
          name,
          addr,
          value: val,
          alive: true,
          moved: false,
          get() {
            if (!this.alive) throw new Error(\`NullPointerError: Dereference of reset/deleted unique_ptr '\${this.name}'\`);
            if (this.moved) throw new Error(\`RuntimeRuleError: Use of moved unique_ptr '\${this.name}'\`);
            return this.value;
          },
          set(v) {
            if (!this.alive || this.moved) throw new Error(\`RuntimeRuleError: Invalid write on unique_ptr '\${this.name}'\`);
            this.value = v;
            return v;
          },
          release() {
            const out = this.value;
            this.value = null;
            this.alive = false;
            return out;
          },
          reset(nextVal) {
            if (nextVal === undefined) {
              this.alive = false;
              this.value = undefined;
            } else {
              this.alive = true;
              this.moved = false;
              this.value = nextVal;
            }
          },
        };
        pointerEvents.push({ op: "unique_ptr", name, state: "active", detail: addr });
        return wrapPtrProxy(cell);
      };

      const own = (value, name = "own") => {
        const cell = { __ptrKind: "own", name, value, alive: true, moved: false };
        pointerEvents.push({ op: "own", name, state: "active", detail: formatVal(value) });
        return cell;
      };

      const move = (ptr, newName = "moved") => {
        if (!ptr || !ptr.__ptrKind) return ptr;
        if (ptr.__ptrKind !== "own" && ptr.__ptrKind !== "unique") return ptr;
        const raw = ptr.__rawCell || ptr;
        if (!raw.alive) throw new Error(\`RuntimeRuleError: Cannot move dropped pointer '\${raw.name}'\`);
        if (raw.moved) throw new Error(\`RuntimeRuleError: Cannot move '\${raw.name}' twice\`);
        const val = raw.value;
        raw.moved = true;
        raw.value = undefined;
        pointerEvents.push({ op: "move", name: raw.name, state: "moved", detail: \`-> \${newName}\` });
        return ptr.__ptrKind === "unique" ? makeUnique(val, newName) : { __ptrKind: "own", name: newName, value: val, alive: true, moved: false };
      };

      const borrow = (target, name = "ref") => {
        if (target && target.__ptrKind) {
          if (!target.alive) throw new Error(\`RuntimeRuleError: Cannot borrow dropped pointer '\${target.name}'\`);
          if (target.moved) throw new Error(\`RuntimeRuleError: Cannot borrow moved pointer '\${target.name}'\`);
          const cell = { __ptrKind: "ref", name, target, alive: true, moved: false };
          pointerEvents.push({ op: "borrow", name, state: "borrowed", detail: \`-> \${target.name}\` });
          return cell;
        }
        const box = { __ptrKind: "own", name: "target", value: target, alive: true, moved: false };
        return { __ptrKind: "ref", name, target: box, alive: true, moved: false };
      };

      const share = (value, name = "shared") => {
        const addr = nextHexAddr();
        const cell = {
          __ptrKind: "shared",
          name,
          addr,
          value,
          alive: true,
          moved: false,
          refCount: 1,
          get() {
            if (!this.alive) throw new Error(\`NullPointerError: Dereference of released shared_ptr '\${this.name}'\`);
            return this.value;
          },
          set(v) {
            if (!this.alive) throw new Error(\`NullPointerError: Write to released shared_ptr '\${this.name}'\`);
            this.value = v;
            return v;
          },
          clone() {
            if (!this.alive) throw new Error(\`RuntimeRuleError: Cannot clone dropped shared pointer '\${this.name}'\`);
            this.refCount += 1;
            pointerEvents.push({ op: "clone", name: this.name, state: "active", detail: \`refCount=\${this.refCount}\` });
            return proxy;
          },
          count() {
            return this.refCount;
          },
          use_count() {
            return this.refCount;
          },
          reset() {
            drop(proxy);
          },
        };
        const proxy = wrapPtrProxy(cell);
        pointerEvents.push({ op: "shared", name, state: "active", detail: "refCount=1" });
        return proxy;
      };

      const makeWeak = (sharedPtr, name = "weak_ptr") => {
        const target = sharedPtr && sharedPtr.__rawCell ? sharedPtr.__rawCell : sharedPtr;
        const cell = {
          __ptrKind: "weak",
          name,
          target,
          alive: true,
          moved: false,
          expired() {
            return !this.alive || !this.target || !this.target.alive || this.target.refCount <= 0;
          },
          use_count() {
            return this.expired() ? 0 : this.target.refCount;
          },
          lock() {
            if (this.expired()) return null;
            return this.target.clone ? this.target.clone() : sharedPtr;
          },
          reset() {
            this.alive = false;
            this.target = null;
          },
        };
        pointerEvents.push({ op: "weak_ptr", name, state: "active", detail: target ? \`-> \${target.name}\` : "empty" });
        return cell;
      };

      const deref = (ptr) => {
        if (!ptr || !ptr.__ptrKind) return ptr;
        if (ptr.__ptrKind === "ref") {
          if (!ptr.target.alive) throw new Error(\`RuntimeRuleError: Dangling borrow '\${ptr.name}' (owner dropped)\`);
          if (ptr.target.moved) throw new Error(\`RuntimeRuleError: Dangling borrow '\${ptr.name}' (owner moved)\`);
          return ptr.target.value;
        }
        if (ptr.__ptrKind === "ptr" || ptr.__ptrKind === "unique") {
          return ptr.get();
        }
        if (!ptr.alive) throw new Error(\`RuntimeRuleError: Dereference of dropped pointer '\${ptr.name}'\`);
        if (ptr.moved) throw new Error(\`RuntimeRuleError: Dereference of moved pointer '\${ptr.name}'\`);
        return ptr.value;
      };

      const setDeref = (ptr, val) => {
        if (!ptr || !ptr.__ptrKind) throw new Error("RuntimeRuleError: Cannot dereference-assign non-pointer");
        if (ptr.__ptrKind === "ref") throw new Error(\`RuntimeRuleError: Cannot mutate through immutable rule reference '\${ptr.name}'\`);
        if (ptr.__ptrKind === "ptr" || ptr.__ptrKind === "unique") {
          ptr.set(val);
          return val;
        }
        const raw = ptr.__rawCell || ptr;
        if (!raw.alive) throw new Error(\`RuntimeRuleError: Write to dropped pointer '\${raw.name}'\`);
        if (raw.moved) throw new Error(\`RuntimeRuleError: Write to moved pointer '\${raw.name}'\`);
        raw.value = val;
        return val;
      };

      const drop = (ptr, isArrayDelete = false) => {
        if (!ptr || !ptr.__ptrKind) return null;
        const raw = ptr.__rawCell || ptr;
        if (raw.__ptrKind === "shared") {
          raw.refCount = Math.max(0, raw.refCount - 1);
          if (raw.refCount === 0) {
            raw.alive = false;
            raw.value = undefined;
          }
          pointerEvents.push({ op: "drop", name: raw.name, state: raw.alive ? "active" : "dropped", detail: \`refCount=\${raw.refCount}\` });
          return null;
        }
        if (raw.__ptrKind === "ptr") {
          if (!raw.alive) throw new Error(\`RuntimeRuleError: Double delete on '\${raw.name}'\`);
          if (typeof raw.free === "function") {
            raw.free();
          } else {
            raw.alive = false;
          }
          pointerEvents.push({ op: isArrayDelete ? "delete[]" : "delete", name: raw.name, state: "dropped", detail: raw.addr || "freed" });
          return null;
        }
        if (!raw.alive) throw new Error(\`RuntimeRuleError: Double drop on '\${raw.name}'\`);
        raw.alive = false;
        raw.value = undefined;
        pointerEvents.push({ op: "drop", name: raw.name, state: "dropped", detail: "released" });
        return null;
      };

      return {
        own,
        move,
        borrow,
        share,
        deref,
        setDeref,
        drop,
        addrOf,
        addressOf,
        addr: addressOf,
        allocSingle,
        allocArray,
        ptrAdd,
        sizeof,
        browserLocation,
        location: browserLocation(),
        NULL: null,
        make_unique: makeUnique,
        unique_ptr: makeUnique,
        make_shared: share,
        shared_ptr: share,
        weak_ptr: makeWeak,
        refCount: (ptr) => {
          if (!ptr) return 0;
          const raw = ptr.__rawCell || ptr;
          if (raw.__ptrKind === "shared") return raw.refCount;
          if (raw.__ptrKind === "weak") return raw.use_count();
          return raw.alive ? 1 : 0;
        },
        matchEnum: (subject, enumName, variant) =>
          Boolean(subject && subject.__enumTag === variant && (!enumName || subject.__enumName === enumName)),
      };
    })(),
  };
})();
const {
  stack, db, server, ui, http, pkg, yourgui,
  Stack, Queue, Dict, List, Set: EjsSet,
  print, println, write, input, ask, prompt, inputInt, inputFloat, confirm, alert,
  browser, copy, speak, listen, fetch,
  sleep, time, date, timer, interval, stop, exit, download, readFile, writeFile, deleteFile,
  toInt, int, toFloat, float, toStr, str, toText, toBool,
  len, length, typeOf, assert, range,
  uppercase, upper, lowercase, lower, trim, split, join, replace, reverse, contains,
  append, push, pop, remove, sort, shuffle, find, filter, unique, first, last,
  keys, values, entries, map, reduce, sum, avg, take,
  slugify, capitalize, truncate, chunk, zip, deepClone, formatCurrency, percent,
  abs, round, floor, ceil, sqrt, pow, min, max, clamp, random, randInt,
  refCount, make_unique, make_shared, unique_ptr, shared_ptr, weak_ptr,
  sizeof, addressOf, addr, browserLocation, NULL
} = __ejs;
const {
  button, text, heading, image, link, textarea, checkbox, radio,
  video, audio, select, option, section, container, line, row, column, grid, form,
  dom, byId, getById, selectId, render, mount,
  onClick, onInput, onChange, onSubmit, click
} = yourgui;
const share = (v) => __ejs.share(v);
const own = (v) => __ejs.own(v);
const drop = (p) => __ejs.drop(p);
// --- EasyJS Program ---`;
}
