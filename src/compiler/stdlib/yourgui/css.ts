/**
 * yourgui CSS & Security Sanitization Engine
 * Uses the browser's native CSS engine via <style> injection when running in DOM,
 * and enforces strict XSS, attribute, URI, and CSS-injection sanitization.
 */

const BLOCKED_ATTR_NAMES = new Set([
  'srcdoc',
  'formaction',
  'xmlns',
  'xlink:href',
  '__proto__',
  'constructor',
  'prototype',
]);

export function sanitizeYourGuiCssText(rawCss: unknown): string {
  const s = String(rawCss ?? '').slice(0, 32_768);
  return s
    .replace(/<\/\s*style/gi, ' ')
    .replace(/@import\b[^;}\n]*;?/gi, '/* blocked */')
    .replace(/@charset\b[^;}\n]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/-moz-binding\s*:[^;}\n]*/gi, '')
    .replace(/behavior\s*:[^;}\n]*/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '');
}

export function sanitizeYourGuiStyleValue(rawVal: unknown): string {
  const s = String(rawVal ?? '').slice(0, 1024);
  if (
    /expression\s*\(|-moz-binding|behavior\s*:|@import|url\s*\(|javascript\s*:|vbscript\s*:/i.test(
      s
    )
  ) {
    return '';
  }
  return s.replace(/[;{}]/g, ' ').trim();
}

export function sanitizeYourGuiUrl(rawUrl: unknown, allowMediaData = false): string {
  const raw = String(rawUrl ?? '').trim().slice(0, 2048);
  if (!raw) return '';
  if (raw === '#' || raw.startsWith('#') || raw.startsWith('/')) {
    return raw.startsWith('//') ? '#' : raw;
  }
  const normalized = raw.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/^(javascript|vbscript|file):/i.test(normalized)) {
    return '#';
  }
  if (/^data:/i.test(normalized)) {
    if (
      allowMediaData &&
      /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(normalized)
    ) {
      return raw;
    }
    return '#';
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return raw;
    }
  } catch {
    // Allow simple relative asset paths without colons
    if (!normalized.includes(':')) {
      return raw;
    }
  }
  return '#';
}

export function isSafeYourGuiAttrName(rawName: unknown): boolean {
  const key = String(rawName ?? '').trim().toLowerCase();
  if (!key || !/^[a-z][a-z0-9_-]*$/i.test(key)) return false;
  if (key.startsWith('on')) return false;
  if (BLOCKED_ATTR_NAMES.has(key)) return false;
  if (key === 'style') return false;
  return true;
}

export function sanitizeYourGuiHtmlString(rawHtml: unknown): string {
  const s = String(rawHtml ?? '').slice(0, 32_768);
  return s
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|meta|base|link|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|meta|base|link|template|noscript)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:srcdoc|formaction|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:javascript|vbscript|data\s*:\s*(?:text\/html|image\/svg\+xml))\s*:/gi, 'blocked:');
}

export const YOURGUI_CSS_SOURCE = `
  const YG_BLOCKED_ATTRS = new Set(["srcdoc", "formaction", "xmlns", "xlink:href", "__proto__", "constructor", "prototype", "style"]);

  const sanitizeYourGuiCss = (rawCss) => {
    const s = String(rawCss ?? "").slice(0, 32768);
    return s
      .replace(/<\\/\\s*style/gi, " ")
      .replace(/@import\\b[^;}\\n]*;?/gi, "/* blocked */")
      .replace(/@charset\\b[^;}\\n]*;?/gi, "")
      .replace(/expression\\s*\\([^)]*\\)/gi, "none")
      .replace(/-moz-binding\\s*:[^;}\\n]*/gi, "")
      .replace(/behavior\\s*:[^;}\\n]*/gi, "")
      .replace(/url\\s*\\([^)]*\\)/gi, "none")
      .replace(/javascript\\s*:/gi, "")
      .replace(/vbscript\\s*:/gi, "");
  };

  const sanitizeYourGuiStyleValue = (rawVal) => {
    const s = String(rawVal ?? "").slice(0, 1024);
    if (/expression\\s*\\(|-moz-binding|behavior\\s*:|@import|url\\s*\\(|javascript\\s*:|vbscript\\s*:/i.test(s)) {
      return "";
    }
    return s.replace(/[;{}]/g, " ").trim();
  };

  const sanitizeYourGuiUrl = (rawUrl, allowMediaData = false) => {
    const raw = String(rawUrl ?? "").trim().slice(0, 2048);
    if (!raw) return "";
    if (raw === "#" || raw.startsWith("#") || raw.startsWith("/")) {
      return raw.startsWith("//") ? "#" : raw;
    }
    const normalized = raw.replace(/[\\u0000-\\u0020\\u007f]+/g, "");
    if (/^(javascript|vbscript|file):/i.test(normalized)) {
      return "#";
    }
    if (/^data:/i.test(normalized)) {
      if (allowMediaData && /^data:image\\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(normalized)) {
        return raw;
      }
      return "#";
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return raw;
      }
    } catch {
      if (!normalized.includes(":")) return raw;
    }
    return "#";
  };

  const isSafeYourGuiAttr = (rawKey) => {
    const key = String(rawKey ?? "").trim().toLowerCase();
    if (!key || !/^[a-z][a-z0-9_-]*$/i.test(key)) return false;
    if (key.startsWith("on")) return false;
    if (YG_BLOCKED_ATTRS.has(key)) return false;
    return true;
  };

  const sanitizeYourGuiHtml = (rawHtml) => {
    const s = String(rawHtml ?? "").slice(0, 32768);
    return s
      .replace(/<\\s*(script|style|iframe|object|embed|svg|math|meta|base|link|template|noscript)\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>/gi, "")
      .replace(/<\\s*(script|style|iframe|object|embed|svg|math|meta|base|link|template|noscript)\\b[^>]*\\/?>/gi, "")
      .replace(/\\son[a-z0-9_-]+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)/gi, "")
      .replace(/\\s(?:srcdoc|formaction|style)\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)/gi, "")
      .replace(/(?:javascript|vbscript|data\\s*:\\s*(?:text\\/html|image\\/svg\\+xml))\\s*:/gi, "blocked:");
  };

  const injectYourGuiCss = (cssText, registry, onUpdate) => {
    const clean = sanitizeYourGuiCss(cssText);
    if (!clean.trim()) return "";
    if (registry.length >= 64) {
      throw new Error("SecurityError: CSS stylesheet quota exceeded in yourgui");
    }
    registry.push(clean);

    // Native browser CSS engine path (only when running standalone outside IDE/test harness)
    if (typeof document !== "undefined" && !ioHandler) {
      const sheet = document.createElement("style");
      sheet.setAttribute("data-yourgui", "true");
      sheet.textContent = clean;
      if (document.head) {
        document.head.appendChild(sheet);
      } else if (document.documentElement) {
        document.documentElement.appendChild(sheet);
      }
    }

    if (typeof onUpdate === "function") onUpdate();
    return clean;
  };
`;

