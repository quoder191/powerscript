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
    const text = formatVal(msg);
    if (ioHandler && typeof ioHandler.onAlert === "function") {
      return ioHandler.onAlert(text);
    }
    console.log("[alert] " + text);
    return text;
  };

  const browserOpen = (url) => {
    const target = String(url ?? "");
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
    const res = await globalThis.fetch(String(url), options);
    const contentType = res.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  };
`;
