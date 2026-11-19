export const BROWSER_STDLIB_SOURCE = `
  const readInputRaw = (promptText = "") => {
    if (stdinQueue.length > 0) {
      const val = String(stdinQueue.shift());
      if (ioHandler && typeof ioHandler.onEcho === "function") {
        ioHandler.onEcho(promptText, val);
      }
      return val;
    }
    if (ioHandler && typeof ioHandler.onInput === "function") {
      return ioHandler.onInput(String(promptText));
    }
    return "";
  };

  const browserAlert = (msg = "") => {
    const text = msg === undefined ? "" : formatVal(msg);
    if (ioHandler && typeof ioHandler.onAlert === "function") {
      return ioHandler.onAlert(text);
    }
    console.log("[alert] " + text);
    return undefined;
  };

  const browserConfirm = (msg = "") => {
    const text = msg === undefined ? "" : formatVal(msg);
    if (stdinQueue.length > 0) {
      const val = String(stdinQueue.shift()).trim().toLowerCase();
      if (ioHandler && typeof ioHandler.onEcho === "function") {
        ioHandler.onEcho(text, val);
      }
      return ["y", "yes", "true", "1", "ok"].includes(val);
    }
    if (ioHandler && typeof ioHandler.onConfirm === "function") {
      return ioHandler.onConfirm(text);
    }
    if (ioHandler && typeof ioHandler.onInput === "function") {
      const res = ioHandler.onInput(text);
      if (res && typeof res.then === "function") {
        return res.then((v) => ["y", "yes", "true", "1", "ok"].includes(String(v).trim().toLowerCase()));
      }
      return ["y", "yes", "true", "1", "ok"].includes(String(res).trim().toLowerCase());
    }
    return false;
  };

  const browserPrompt = (msg = "", defaultValue = "") => {
    const text = msg === undefined ? "" : formatVal(msg);
    const def = defaultValue === undefined || defaultValue === null ? "" : String(defaultValue);
    if (stdinQueue.length > 0) {
      const next = stdinQueue.shift();
      const result = next === null ? null : String(next);
      if (ioHandler && typeof ioHandler.onEcho === "function") {
        ioHandler.onEcho(text, result === null ? "(cancelled)" : result);
      }
      return result;
    }
    if (ioHandler && typeof ioHandler.onPrompt === "function") {
      return ioHandler.onPrompt(text, def);
    }
    if (ioHandler && typeof ioHandler.onInput === "function") {
      return ioHandler.onInput(text);
    }
    return def;
  };

  const browserOpen = (url) => {
    const raw = String(url ?? "").trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("SecurityError: Invalid browser URL '" + raw + "'");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("SecurityError: Blocked browser URL protocol '" + parsed.protocol + "'");
    }
    const target = parsed.toString();
    if (ioHandler && typeof ioHandler.onBrowser === "function") {
      ioHandler.onBrowser(target);
    } else {
      console.log("[browser] " + target);
    }
    return target;
  };

  const copyText = async (text) => {
    const value = formatVal(text);
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fallback below
      }
    }
    console.log("[copy] " + value);
    return false;
  };

  const speakText = (text) => {
    const value = formatVal(text);
    console.log("[speak] " + value);
    if (typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      try {
        const utter = new SpeechSynthesisUtterance(value);
        window.speechSynthesis.speak(utter);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  const listenSpeech = async (promptText = "Listening (or type response): ") => {
    if (typeof window !== "undefined") {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Rec) {
        try {
          return await new Promise((resolve) => {
            const rec = new Rec();
            rec.lang = "en-US";
            rec.interimResults = false;
            rec.maxAlternatives = 1;
            rec.onresult = (e) => resolve(e.results?.[0]?.[0]?.transcript ?? "");
            rec.onerror = () => resolve(readInputRaw(promptText));
            rec.start();
          });
        } catch {
          // Fall back to interactive console input
        }
      }
    }
    return readInputRaw(promptText);
  };

  const fetchData = async (url, options = undefined) => {
    const raw = String(url ?? "");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("SecurityError: Invalid fetch URL '" + raw + "'");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("SecurityError: Blocked fetch protocol '" + parsed.protocol + "' in sandbox");
    }
    if (parsed.username || parsed.password) {
      throw new Error("SecurityError: Embedded URL credentials are blocked in fetch()");
    }
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.credentials === "string" && opts.credentials.toLowerCase() !== "omit") {
      throw new Error("SecurityError: fetch() credentials and cookies are blocked by security policy");
    }
    if (opts.headers && typeof opts.headers === "object") {
      const entries = typeof opts.headers.entries === "function"
        ? Array.from(opts.headers.entries())
        : Object.entries(opts.headers);
      for (const pair of entries) {
        const key = String(pair[0] || "").toLowerCase();
        if (key === "cookie" || key === "cookie2" || key === "set-cookie" || key === "authorization") {
          throw new Error("SecurityError: Header '" + pair[0] + "' is blocked by security policy");
        }
      }
    }
    const fetchFn = typeof __ejs_host_fetch === "function" ? __ejs_host_fetch : null;
    if (!fetchFn) {
      throw new Error("SecurityError: fetch() is unavailable in this sandbox");
    }
    const res = await fetchFn(parsed.toString(), {
      ...opts,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    const contentType = res.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  };
`;
