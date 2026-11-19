export const SYSTEM_STDLIB_SOURCE = `
  class EasyJSExitSignal extends Error {
    constructor(reason = "Program exited") {
      super(reason);
      this.name = "EasyJSExitSignal";
      this.isExitSignal = true;
    }
  }

  const MAX_ACTIVE_TIMERS = 32;
  const MIN_TIMER_INTERVAL_MS = 10;
  const MAX_TIMER_DELAY_MS = 60000;
  const activeTimeouts = new Set();
  const activeIntervals = new Set();

  const cleanupTimers = () => {
    for (const id of activeTimeouts) clearTimeout(id);
    for (const id of activeIntervals) clearInterval(id);
    activeTimeouts.clear();
    activeIntervals.clear();
  };

  const totalActiveTimers = () => activeTimeouts.size + activeIntervals.size;

  const sanitizeDelayMs = (rawMs, minMs = 0) => {
    const n = Number(rawMs);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("SecurityError: Timer/sleep delay must be a non-negative finite number");
    }
    return Math.min(MAX_TIMER_DELAY_MS, Math.max(minMs, Math.trunc(n)));
  };

  const MAX_VFS_FILES = 64;
  const MAX_VFS_FILE_BYTES = 131072;
  const MAX_VFS_TOTAL_BYTES = 524288;
  const BLOCKED_VFS_NAMES = new Set(["__proto__", "constructor", "prototype"]);
  const memoryVfs = new Map();

  const normalizeVfsPath = (rawPath) => {
    const input = String(rawPath ?? "");
    if (!input || input.length > 256 || /[\\u0000-\\u001f\\u007f]/.test(input)) {
      throw new Error("SecurityError: Invalid VFS file path");
    }
    const normalized = input.replace(/\\\\/g, "/").trim();
    if (!normalized) {
      throw new Error("SecurityError: Invalid empty VFS path");
    }
    // Strip optional leading /sandbox prefix so paths resolve strictly inside /sandbox chroot
    const trimmedLeading = normalized.replace(/^\\/+/, "");
    const rel = trimmedLeading === "sandbox"
      ? ""
      : trimmedLeading.startsWith("sandbox/")
        ? trimmedLeading.slice("sandbox/".length)
        : trimmedLeading;

    const parts = rel.split("/").filter(Boolean);
    const resolved = [];
    for (const seg of parts) {
      if (seg === ".") continue;
      if (seg === "..") {
        if (resolved.length === 0) {
          throw new Error("SecurityError: VFS path traversal outside '/sandbox' is blocked");
        }
        resolved.pop();
        continue;
      }
      if (BLOCKED_VFS_NAMES.has(seg)) {
        throw new Error(\`SecurityError: Reserved VFS segment '\${seg}' is blocked\`);
      }
      resolved.push(seg);
    }
    if (resolved.length === 0) {
      throw new Error("SecurityError: VFS path must reference a file inside '/sandbox'");
    }
    return "/sandbox/" + resolved.join("/");
  };

  const getVfsTotalBytes = () => {
    let total = 0;
    for (const val of memoryVfs.values()) total += String(val).length;
    return total;
  };

  const readFileVfs = (path) => {
    const key = normalizeVfsPath(path);
    if (memoryVfs.has(key)) return memoryVfs.get(key);
    throw new Error(\`FileNotFoundError: '\${key}' does not exist\`);
  };

  const writeFileVfs = (path, content = "") => {
    const key = normalizeVfsPath(path);
    const data = formatVal(content);
    if (data.length > MAX_VFS_FILE_BYTES) {
      throw new Error(\`SecurityError: VFS file size exceeds limit (\${MAX_VFS_FILE_BYTES} chars)\`);
    }
    if (!memoryVfs.has(key) && memoryVfs.size >= MAX_VFS_FILES) {
      throw new Error(\`SecurityError: VFS file count limit (\${MAX_VFS_FILES}) exceeded\`);
    }
    const prevSize = memoryVfs.has(key) ? String(memoryVfs.get(key)).length : 0;
    if (getVfsTotalBytes() - prevSize + data.length > MAX_VFS_TOTAL_BYTES) {
      throw new Error(\`SecurityError: VFS total storage quota (\${MAX_VFS_TOTAL_BYTES} chars) exceeded\`);
    }
    memoryVfs.set(key, data);
    return true;
  };

  const deleteFileVfs = (path) => {
    const key = normalizeVfsPath(path);
    return memoryVfs.delete(key);
  };

  const sanitizeDownloadFilename = (rawName) => {
    const base = String(rawName ?? "download.txt")
      .replace(/\\\\/g, "/")
      .split("/")
      .pop() || "download.txt";
    const clean = base.replace(/^\\.+/, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
    return clean || "download.txt";
  };

  const downloadFile = (filename, content = undefined) => {
    const safeName = sanitizeDownloadFilename(filename);
    let data = content !== undefined ? formatVal(content) : "";
    if (content === undefined) {
      try {
        data = readFileVfs(safeName);
      } catch {
        data = "";
      }
    }
    if (data.length > MAX_VFS_FILE_BYTES) {
      throw new Error(\`SecurityError: Download payload exceeds limit (\${MAX_VFS_FILE_BYTES} chars)\`);
    }
    if (typeof document !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
      try {
        const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
        console.log(\`[download] Triggered download for '\${safeName}'\`);
        return true;
      } catch {
        // Fallback log
      }
    }
    console.log(\`[download] \${safeName} (\${data.length} bytes)\`);
    return true;
  };

  const getCurrentTime = () => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return \`\${pad2(d.getHours())}:\${pad2(d.getMinutes())}:\${pad2(d.getSeconds())}\`;
  };

  const getCurrentDate = () => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return \`\${d.getFullYear()}-\${pad2(d.getMonth() + 1)}-\${pad2(d.getDate())}\`;
  };

  const startTimer = (secondsOrMs, cb = undefined) => {
    const rawMs = Number(secondsOrMs) > 60 ? Number(secondsOrMs) : Number(secondsOrMs) * 1000;
    const ms = sanitizeDelayMs(rawMs, 0);
    if (totalActiveTimers() >= MAX_ACTIVE_TIMERS) {
      throw new Error(\`SecurityError: Maximum active timers (\${MAX_ACTIVE_TIMERS}) exceeded\`);
    }
    if (typeof cb === "function") {
      const id = setTimeout(() => {
        activeTimeouts.delete(id);
        cb();
      }, ms);
      activeTimeouts.add(id);
      return { cancel: () => { clearTimeout(id); activeTimeouts.delete(id); } };
    }
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        activeTimeouts.delete(id);
        resolve(true);
      }, ms);
      activeTimeouts.add(id);
    });
  };

  const startInterval = (ms, cb) => {
    const safeMs = sanitizeDelayMs(ms, MIN_TIMER_INTERVAL_MS);
    if (typeof cb !== "function") {
      console.log(\`[interval] Registered interval (\${safeMs}ms)\`);
      return { stop: () => {} };
    }
    if (totalActiveTimers() >= MAX_ACTIVE_TIMERS) {
      throw new Error(\`SecurityError: Maximum active timers (\${MAX_ACTIVE_TIMERS}) exceeded\`);
    }
    const id = setInterval(cb, safeMs);
    activeIntervals.add(id);
    return {
      stop: () => {
        clearInterval(id);
        activeIntervals.delete(id);
      },
    };
  };

  const stopProgram = (reason = "Stopped") => {
    cleanupTimers();
    throw new EasyJSExitSignal(reason);
  };
`;
