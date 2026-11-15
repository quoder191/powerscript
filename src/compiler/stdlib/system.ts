export const SYSTEM_STDLIB_SOURCE = `
  class EasyJSExitSignal extends Error {
    constructor(reason = "Program exited") {
      super(reason);
      this.name = "EasyJSExitSignal";
      this.isExitSignal = true;
    }
  }

  const activeTimeouts = new Set();
  const activeIntervals = new Set();

  const cleanupTimers = () => {
    for (const id of activeTimeouts) clearTimeout(id);
    for (const id of activeIntervals) clearInterval(id);
    activeTimeouts.clear();
    activeIntervals.clear();
  };

  const VFS_PREFIX = "easyjs_vfs:";
  const memoryVfs = new Map();

  const readFileVfs = (path) => {
    const key = String(path);
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(VFS_PREFIX + key);
      if (stored !== null) return stored;
    }
    if (memoryVfs.has(key)) return memoryVfs.get(key);
    throw new Error(\`FileNotFoundError: '\${key}' does not exist\`);
  };

  const writeFileVfs = (path, content = "") => {
    const key = String(path);
    const data = formatVal(content);
    memoryVfs.set(key, data);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(VFS_PREFIX + key, data);
      } catch {
        // Ignore storage quota errors in restricted sandboxes
      }
    }
    return true;
  };

  const deleteFileVfs = (path) => {
    const key = String(path);
    let removed = memoryVfs.delete(key);
    if (typeof localStorage !== "undefined") {
      const exists = localStorage.getItem(VFS_PREFIX + key) !== null;
      if (exists) {
        localStorage.removeItem(VFS_PREFIX + key);
        removed = true;
      }
    }
    return removed;
  };

  const downloadFile = (filename, content = undefined) => {
    const name = String(filename);
    let data = content !== undefined ? formatVal(content) : "";
    if (content === undefined) {
      try {
        data = readFileVfs(name);
      } catch {
        data = "";
      }
    }
    if (typeof document !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
      try {
        const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
        console.log(\`[download] Triggered download for '\${name}'\`);
        return true;
      } catch {
        // Fallback log
      }
    }
    console.log(\`[download] \${name} (\${data.length} bytes)\`);
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
    const ms = secondsOrMs > 60 ? secondsOrMs : secondsOrMs * 1000;
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
    if (typeof cb !== "function") {
      console.log(\`[interval] Registered interval (\${ms}ms)\`);
      return { stop: () => {} };
    }
    const id = setInterval(cb, ms);
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
