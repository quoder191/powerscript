export const MODULES_STDLIB_SOURCE = `
  const BLOCKED_MOD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const MAX_DB_TABLES = 32;
  const MAX_DB_ROWS = 1000;
  const MAX_ROUTES = 64;
  const MAX_VISUALS = 50;
  const memoryDb = new Map();

  const assertSafeModKey = (raw) => {
    const key = String(raw ?? "");
    if (!key || BLOCKED_MOD_KEYS.has(key) || key.length > 128) {
      throw new Error(\`SecurityError: Unsafe identifier '\${key}' is blocked in sandbox\`);
    }
    return key;
  };

  const cloneSafeRecord = (rec) => {
    if (typeof rec !== "object" || rec === null) return { value: rec };
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (BLOCKED_MOD_KEYS.has(k)) continue;
      out[k] = v;
    }
    return out;
  };

  const loadDbTable = (table) => {
    const key = assertSafeModKey(table);
    if (memoryDb.has(key)) return memoryDb.get(key);
    if (memoryDb.size >= MAX_DB_TABLES) {
      throw new Error(\`SecurityError: DB table limit (\${MAX_DB_TABLES}) exceeded\`);
    }
    const empty = [];
    memoryDb.set(key, empty);
    return empty;
  };

  const persistDbTable = (table, rows) => {
    const key = assertSafeModKey(table);
    memoryDb.set(key, rows);
  };

  const dbLib = Object.freeze({
    save: (table, record) => {
      const rows = loadDbTable(table);
      if (rows.length >= MAX_DB_ROWS) {
        throw new Error(\`SecurityError: DB table row limit (\${MAX_DB_ROWS}) exceeded\`);
      }
      const copy = cloneSafeRecord(record);
      if (copy.id === undefined) {
        copy.id = rows.length + 1;
      }
      rows.push(copy);
      persistDbTable(table, rows);
      return copy;
    },
    insert: (table, record) => dbLib.save(table, record),
    all: (table) => loadDbTable(table).map((r) => ({ ...r })),
    find: (table, queryOrFn = undefined) => {
      const rows = loadDbTable(table);
      if (queryOrFn === undefined) return rows.map((r) => ({ ...r }));
      if (typeof queryOrFn === "function") return rows.filter(queryOrFn).map((r) => ({ ...r }));
      if (typeof queryOrFn === "object" && queryOrFn !== null) {
        const entries = Object.entries(queryOrFn).filter(([k]) => !BLOCKED_MOD_KEYS.has(k));
        return rows.filter((r) => entries.every(([k, v]) => r[k] === v)).map((r) => ({ ...r }));
      }
      return rows.filter((r) => r.id === queryOrFn).map((r) => ({ ...r }));
    },
    findOne: (table, queryOrFn) => dbLib.find(table, queryOrFn)[0] ?? null,
    update: (table, id, patch) => {
      const rows = loadDbTable(table);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      rows[idx] = { ...rows[idx], ...cloneSafeRecord(patch) };
      persistDbTable(table, rows);
      return { ...rows[idx] };
    },
    delete: (table, id) => {
      const rows = loadDbTable(table);
      const next = rows.filter((r) => r.id !== id);
      persistDbTable(table, next);
      return rows.length !== next.length;
    },
    clear: (table) => {
      persistDbTable(table, []);
      return true;
    },
    count: (table) => loadDbTable(table).length,
  });

  const registeredRoutes = [];
  const registerRouteSafe = (method, path, handler) => {
    if (registeredRoutes.length >= MAX_ROUTES) {
      throw new Error(\`SecurityError: Maximum registered routes (\${MAX_ROUTES}) exceeded\`);
    }
    const cleanPath = String(path ?? "");
    if (!cleanPath.startsWith("/") || cleanPath.length > 256) {
      throw new Error("SecurityError: Server route path must start with '/' and be <= 256 chars");
    }
    registeredRoutes.push({ method: String(method).toUpperCase(), path: cleanPath, handler });
    return true;
  };

  const serverLib = Object.freeze({
    get: (path, handler) => registerRouteSafe("GET", path, handler),
    post: (path, handler) => registerRouteSafe("POST", path, handler),
    route: (method, path, handler) => registerRouteSafe(method, path, handler),
    request: (method, path, body = null) => {
      const m = String(method).toUpperCase();
      const p = String(path);
      const route = registeredRoutes.find((r) => r.method === m && r.path === p);
      if (!route) {
        return { status: 404, body: { error: \`Route \${m} \${p} not found\` } };
      }
      const req = { method: m, path: p, body };
      const result = route.handler(req);
      if (result && typeof result.then === "function") {
        return result.then((resolved) => ({ status: 200, body: resolved }));
      }
      return { status: 200, body: result };
    },
    routes: () => registeredRoutes.map((r) => \`\${r.method} \${r.path}\`),
    start: (port = 3000) => {
      const summary = registeredRoutes.map((r) => \`\${r.method} \${r.path}\`).join(", ") || "no routes";
      console.log(\`[server] EasyJS HTTP server listening on http://localhost:\${port} (\${summary})\`);
      if (ioHandler && typeof ioHandler.onServerStart === "function") {
        ioHandler.onServerStart(port, registeredRoutes.map((r) => ({ method: r.method, path: r.path })));
      }
      return { port, routes: serverLib.routes() };
    },
    clear: () => {
      registeredRoutes.length = 0;
      return true;
    },
  });

  const visualOutputs = [];
  const emitVisual = (item) => {
    if (visualOutputs.length >= MAX_VISUALS) {
      throw new Error(\`SecurityError: Visual output quota (\${MAX_VISUALS}) exceeded\`);
    }
    visualOutputs.push(item);
    if (ioHandler && typeof ioHandler.onVisual === "function") {
      ioHandler.onVisual(item);
    }
    return item;
  };

  const uiLib = Object.freeze({
    html: (markup) => emitVisual({ kind: "html", content: sanitizeYourGuiHtml(markup) }),
    card: (title, body, footer = "") =>
      emitVisual({ kind: "card", title: formatVal(title), body: formatVal(body), footer: footer ? formatVal(footer) : "" }),
    table: (rows = [], columns = undefined) => {
      const safeRows = Array.isArray(rows) ? rows.slice(0, 500) : [];
      const cols = Array.isArray(columns)
        ? columns.slice(0, 50)
        : safeRows.length > 0 && typeof safeRows[0] === "object" && safeRows[0] !== null
          ? Object.keys(safeRows[0]).slice(0, 50)
          : ["value"];
      return emitVisual({ kind: "table", columns: cols, rows: safeRows });
    },
    chart: (title, data = [], chartType = "bar") => {
      const items = Array.isArray(data)
        ? data.slice(0, 200).map((d, i) =>
            typeof d === "object" && d !== null
              ? { label: String(d.label ?? d.name ?? \`Item \${i + 1}\`), value: Number(d.value ?? d.y ?? 0) }
              : { label: \`#\${i + 1}\`, value: Number(d) }
          )
        : Object.entries(data || {}).slice(0, 200).map(([k, v]) => ({ label: String(k), value: Number(v) }));
      return emitVisual({ kind: "chart", title: formatVal(title), chartType: String(chartType), data: items });
    },
    clear: () => {
      visualOutputs.length = 0;
      return true;
    },
  });

  const httpLib = Object.freeze({
    get: async (url) => fetchData(url, { method: "GET" }),
    post: async (url, payload) =>
      fetchData(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      }),
  });

  const installedPackages = new Map();
  const PACKAGE_REGISTRY = {
    validator: {
      name: "validator",
      version: "1.2.0",
      description: "Email, URL, and numeric validation helpers",
      exports: {
        isEmail: (s) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(s)),
        isUrl: (s) => /^https?:\\/\\/.+/.test(String(s)),
        isNumeric: (s) => !Number.isNaN(Number(s)) && String(s).trim() !== "",
      },
    },
    stats: {
      name: "stats",
      version: "1.0.4",
      description: "Descriptive statistics: mean, median, variance",
      exports: {
        mean: (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0),
        median: (arr) => {
          if (!arr.length) return 0;
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        },
        variance: (arr) => {
          if (!arr.length) return 0;
          const m = arr.reduce((a, b) => a + b, 0) / arr.length;
          return arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / arr.length;
        },
      },
    },
    csv: {
      name: "csv",
      version: "1.1.0",
      description: "Parse and stringify CSV data",
      exports: {
        parse: (text) =>
          String(text)
            .trim()
            .split(/\\r?\\n/)
            .map((line) => line.split(",").map((c) => c.trim())),
        stringify: (rows) => rows.map((r) => r.join(",")).join("\\n"),
      },
    },
    colors: {
      name: "colors",
      version: "2.0.0",
      description: "Hex/RGB color utilities",
      exports: {
        hexToRgb: (hex) => {
          const clean = String(hex).replace("#", "");
          return {
            r: parseInt(clean.slice(0, 2), 16) || 0,
            g: parseInt(clean.slice(2, 4), 16) || 0,
            b: parseInt(clean.slice(4, 6), 16) || 0,
          };
        },
      },
    },
  };

  const pkgLib = Object.freeze({
    install: (name) => {
      const key = String(name);
      const entry = PACKAGE_REGISTRY[key];
      if (!entry) {
        throw new Error(\`PackageError: Package '\${key}' not found in EasyJS registry (available: \${Object.keys(PACKAGE_REGISTRY).join(", ")})\`);
      }
      installedPackages.set(key, entry);
      console.log(\`[pkg] Installed \${entry.name}@\${entry.version}\`);
      return entry.exports;
    },
    use: (name) => {
      const key = String(name);
      if (installedPackages.has(key)) return installedPackages.get(key).exports;
      return pkgLib.install(key);
    },
    list: () => Object.keys(PACKAGE_REGISTRY),
    installed: () => Array.from(installedPackages.keys()),
    info: (name) => PACKAGE_REGISTRY[String(name)] ?? null,
    uninstall: (name) => installedPackages.delete(String(name)),
  });

  const BUILTIN_MODULES = Object.freeze({
    "stdlib/math": Object.freeze({
      PI: Math.PI,
      E: Math.E,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log,
      exp: Math.exp,
      sqrt: Math.sqrt,
      pow: Math.pow,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      hypot: Math.hypot,
      clamp: (n, lo, hi) => Math.min(Math.max(n, lo), hi),
      lerp: (a, b, t) => a + (b - a) * t,
      factorial: (n) => {
        let res = 1;
        for (let i = 2; i <= n; i++) res *= i;
        return res;
      },
      isPrime: (n) => {
        if (n < 2) return false;
        for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
      },
      gcd: (a, b) => {
        let x = Math.abs(a), y = Math.abs(b);
        while (y !== 0) { const t = y; y = x % y; x = t; }
        return x;
      },
    }),
    "stdlib/json": Object.freeze({
      parse: (s) => JSON.parse(String(s)),
      stringify: (v) => JSON.stringify(v),
      pretty: (v) => JSON.stringify(v, null, 2),
    }),
    "stdlib/regex": Object.freeze({
      test: (pattern, text, flags = "") => new RegExp(pattern, flags).test(String(text)),
      match: (pattern, text, flags = "") => String(text).match(new RegExp(pattern, flags)),
      matchAll: (pattern, text) => [...String(text).matchAll(new RegExp(pattern, "g"))].map((m) => m[0]),
      replace: (pattern, text, replacement) => String(text).replace(new RegExp(pattern, "g"), replacement),
    }),
    "stdlib/crypto": Object.freeze({
      uuid: () =>
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
            }),
      hash: (text) => {
        let h = 2166136261;
        const s = String(text);
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, "0");
      },
      base64Encode: (s) => btoa(String(s)),
      base64Decode: (s) => atob(String(s)),
    }),
    "stdlib/datetime": Object.freeze({
      now: () => new Date().toISOString(),
      today: getCurrentDate,
      time: getCurrentTime,
      timestamp: () => Date.now(),
      addDays: (iso, days) => {
        const d = new Date(iso);
        d.setDate(d.getDate() + Number(days));
        return d.toISOString().slice(0, 10);
      },
      diffDays: (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000),
    }),
    "stdlib/db": dbLib,
    "stdlib/http": httpLib,
    "stdlib/server": serverLib,
    "stdlib/ui": uiLib,
    "stdlib/stack": stackLib,
    "stdlib/yourgui": yourguiLib,
    "yourgui": yourguiLib,
  });

  const loadModule = (path) => {
    const key = String(path).trim().replace(/^(\\.\\/|@)/, "");
    if (Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, key)) {
      return BUILTIN_MODULES[key];
    }
    const shortKey = key.startsWith("stdlib/") ? key : \`stdlib/\${key}\`;
    if (Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, shortKey)) {
      return BUILTIN_MODULES[shortKey];
    }
    if (Object.prototype.hasOwnProperty.call(PACKAGE_REGISTRY, key)) {
      return pkgLib.use(key);
    }
    throw new Error(\`ModuleNotFoundError: Cannot import module '\${path}'\`);
  };
`;
