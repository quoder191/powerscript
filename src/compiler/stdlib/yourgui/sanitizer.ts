/**
 * Canonical YourGUI & HTML/URL/CSS Sanitization Policy
 *
 * Single source of truth shared across:
 * - React UI preview hosts (`src/components/Output.tsx`)
 * - ASTInterpreter YourGUI runtime (`src/compiler/stdlib/yourgui/index.ts`)
 * - Compiled YourGUI & UI stdlib runtimes (`src/compiler/stdlib/yourgui/css.ts`, `dom.ts`, `modules.ts`)
 */

export const YOURGUI_ALLOWED_TAGS: readonly string[] = [
  'div', 'span', 'p', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'button', 'input', 'textarea', 'select', 'option', 'optgroup', 'label', 'form',
  'hr', 'br', 'a', 'img', 'video', 'audio', 'source',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'small', 'sub', 'sup',
];

// Any element in this set has BOTH its tag AND entire subtree discarded completely
export const YOURGUI_DROP_SUBTREE_TAGS: readonly string[] = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'portal', 'svg', 'math', 'foreignobject', 'meta', 'base', 'link', 'template',
  'noscript', 'title', 'xmp', 'plaintext',
];

export const YOURGUI_VOID_TAGS: readonly string[] = [
  'br', 'hr', 'img', 'input', 'source',
];

export const YOURGUI_ALLOWED_ATTRS: readonly string[] = [
  'id', 'class', 'type', 'value', 'placeholder', 'name', 'checked', 'disabled',
  'readonly', 'required', 'min', 'max', 'step', 'maxlength', 'minlength',
  'rows', 'cols', 'selected', 'multiple', 'alt', 'title', 'href', 'src', 'poster',
  'target', 'rel', 'controls', 'loop', 'muted', 'autoplay', 'colspan', 'rowspan',
  'for', 'role', 'width', 'height', 'tabindex',
];

export const YOURGUI_URL_ATTRS: readonly string[] = ['href', 'src', 'poster'];

const ALLOWED_TAG_SET = new Set(YOURGUI_ALLOWED_TAGS);
const DROP_SUBTREE_SET = new Set(YOURGUI_DROP_SUBTREE_TAGS);
const VOID_TAG_SET = new Set(YOURGUI_VOID_TAGS);
const ALLOWED_ATTR_SET = new Set(YOURGUI_ALLOWED_ATTRS);
const URL_ATTR_SET = new Set(YOURGUI_URL_ATTRS);

const NAMED_HTML_ENTITIES: Record<string, string> = {
  colon: ':',
  newline: '\n',
  tab: '\t',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  sol: '/',
  bsol: '\\',
  num: '#',
  semi: ';',
  nbsp: ' ',
};

export function decodeHtmlEntities(raw: string): string {
  return String(raw ?? '').replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);?/gi,
    (full, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith('#x')) {
        const cp = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      if (lower.startsWith('#')) {
        const cp = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      return NAMED_HTML_ENTITIES[lower] ?? full;
    }
  );
}

export function isAllowedYourGuiTag(rawTag: unknown): boolean {
  const tag = String(rawTag ?? '').trim().toLowerCase();
  return Boolean(tag) && ALLOWED_TAG_SET.has(tag);
}

export function normalizeYourGuiTag(rawTag: unknown): string {
  const tag = String(rawTag ?? '').trim().toLowerCase();
  return ALLOWED_TAG_SET.has(tag) ? tag : 'div';
}

export function isSafeYourGuiAttrName(rawName: unknown): boolean {
  const key = String(rawName ?? '').trim().toLowerCase();
  if (!key || !/^[a-z][a-z0-9_-]*$/.test(key)) return false;
  if (key.startsWith('on')) return false;
  if (
    key === 'srcdoc' ||
    key === 'formaction' ||
    key === 'action' ||
    key === 'style' ||
    key === 'xmlns' ||
    key === 'xlink:href' ||
    key === 'data-yg-id' ||
    key === '__proto__' ||
    key === 'constructor' ||
    key === 'prototype'
  ) {
    return false;
  }
  return ALLOWED_ATTR_SET.has(key) || /^aria-[a-z0-9_-]+$/.test(key) || /^data-[a-z0-9_-]+$/.test(key);
}

export function sanitizeYourGuiUrl(rawUrl: unknown, allowMediaData = false): string {
  const raw = String(rawUrl ?? '').trim().slice(0, 2048);
  if (!raw) return '';

  // Decode HTML entities & strip all ASCII control/whitespace before analyzing URL structure
  const decoded = decodeHtmlEntities(raw);
  const compact = decoded.replace(/[\u0000-\u0020\u007f]+/g, '');
  const trimmed = decoded.trim();
  if (!compact || !trimmed) return '';

  // Explicitly block protocol-relative URLs (//host, /\host, \/host, \\host)
  if (
    compact.startsWith('//') ||
    compact.startsWith('/\\') ||
    compact.startsWith('\\/') ||
    compact.startsWith('\\\\') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\')
  ) {
    return '#';
  }

  // Block dangerous / executable schemes
  if (/^(javascript|vbscript|file|blob|filesystem):/i.test(compact)) {
    return '#';
  }

  if (/^data:/i.test(compact)) {
    if (
      allowMediaData &&
      /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(compact)
    ) {
      return compact;
    }
    return '#';
  }

  // Allow safe same-document hash fragments and strict single-slash relative paths
  if (compact === '#' || (compact.startsWith('#') && !/[<>]/.test(compact))) {
    return trimmed;
  }
  if (compact.startsWith('/') && compact[1] !== '/' && compact[1] !== '\\') {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '#';
  } catch {
    // Allow plain relative resource paths with no scheme separator or backslash trick
    if (!compact.includes(':') && !compact.startsWith('\\')) {
      return trimmed;
    }
    return '#';
  }
}

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
  const s = decodeHtmlEntities(String(rawVal ?? '').slice(0, 1024));
  if (
    /expression\s*\(|-moz-binding|behavior\s*:|@import|url\s*\(|javascript\s*:|vbscript\s*:/i.test(s)
  ) {
    return '';
  }
  return s.replace(/[;{}<>]/g, ' ').trim();
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeDomTree(srcNode: Node, outDoc: Document): Node | null {
  if (srcNode.nodeType === 3) {
    return outDoc.createTextNode(srcNode.textContent ?? '');
  }
  if (srcNode.nodeType !== 1) return null;

  const srcEl = srcNode as Element;
  const tag = String(srcEl.tagName ?? '').toLowerCase();

  // Strictly drop forbidden subtrees including SVG, MathML, iframe, script, style, etc.
  if (DROP_SUBTREE_SET.has(tag)) {
    return null;
  }

  if (!ALLOWED_TAG_SET.has(tag)) {
    const frag = outDoc.createDocumentFragment();
    for (const child of Array.from(srcEl.childNodes)) {
      const cleanChild = sanitizeDomTree(child, outDoc);
      if (cleanChild) frag.appendChild(cleanChild);
    }
    return frag;
  }

  const cleanEl = outDoc.createElement(tag);
  for (const attr of Array.from(srcEl.attributes ?? [])) {
    const key = String(attr.name ?? '').toLowerCase();
    if (!isSafeYourGuiAttrName(key)) continue;

    if (URL_ATTR_SET.has(key)) {
      const safeUrl = sanitizeYourGuiUrl(attr.value, key === 'src' || key === 'poster');
      cleanEl.setAttribute(key, safeUrl || '#');
    } else {
      cleanEl.setAttribute(key, attr.value);
    }
  }

  if (tag === 'a' && cleanEl.getAttribute('target') === '_blank') {
    cleanEl.setAttribute('rel', 'noopener noreferrer');
  }

  for (const child of Array.from(srcEl.childNodes)) {
    const cleanChild = sanitizeDomTree(child, outDoc);
    if (cleanChild) cleanEl.appendChild(cleanChild);
  }

  return cleanEl;
}

/**
 * Deterministic state-machine HTML sanitizer for non-DOM environments (Node worker / SSR / tests).
 * Parses HTML tokens without naive tag-stripping regexes:
 * - Drops dangerous subtrees (script, style, iframe, svg, math, object, embed, meta, base, link, template)
 * - Strips non-allowlisted tags and all disallowed/event-handler attributes
 * - Entity-decodes and validates URL attributes
 */
function sanitizeHtmlDeterministic(rawHtml: string): string {
  const input = rawHtml.slice(0, 32_768);
  const out: string[] = [];
  const openTagStack: string[] = [];
  let dropDepth = 0;
  let dropTag: string | null = null;
  let i = 0;

  const parseAttributes = (attrSrc: string): Array<[string, string]> => {
    const attrs: Array<[string, string]> = [];
    let pos = 0;
    const len = attrSrc.length;
    while (pos < len) {
      while (pos < len && /[\s/]/.test(attrSrc[pos])) pos++;
      if (pos >= len) break;

      const nameStart = pos;
      while (pos < len && !/[\s=/>]/.test(attrSrc[pos])) pos++;
      const name = attrSrc.slice(nameStart, pos).toLowerCase();
      while (pos < len && /\s/.test(attrSrc[pos])) pos++;

      let val = '';
      if (pos < len && attrSrc[pos] === '=') {
        pos++;
        while (pos < len && /\s/.test(attrSrc[pos])) pos++;
        if (pos < len && (attrSrc[pos] === '"' || attrSrc[pos] === "'")) {
          const quote = attrSrc[pos++];
          const valStart = pos;
          while (pos < len && attrSrc[pos] !== quote) pos++;
          val = attrSrc.slice(valStart, pos);
          if (pos < len && attrSrc[pos] === quote) pos++;
        } else {
          const valStart = pos;
          while (pos < len && !/[\s>]/.test(attrSrc[pos])) pos++;
          val = attrSrc.slice(valStart, pos);
        }
      }
      if (name) attrs.push([name, val]);
    }
    return attrs;
  };

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      if (dropDepth === 0) {
        out.push(escapeHtmlText(input.slice(i)));
      }
      break;
    }

    if (lt > i && dropDepth === 0) {
      out.push(escapeHtmlText(input.slice(i, lt)));
    }

    // Comments or DOCTYPE
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt + 2);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    // Scan tag ending while respecting quotes
    let pos = lt + 1;
    let inQuote: string | null = null;
    while (pos < input.length) {
      const ch = input[pos];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else {
        if (ch === '"' || ch === "'") inQuote = ch;
        else if (ch === '>') break;
      }
      pos++;
    }
    if (pos >= input.length) {
      // Unclosed `<` treated safely as text unless dropping subtree
      if (dropDepth === 0) {
        out.push(escapeHtmlText(input.slice(lt)));
      }
      break;
    }

    const rawTagBody = input.slice(lt + 1, pos).trim();
    i = pos + 1;

    if (!rawTagBody) continue;
    const isClosing = rawTagBody.startsWith('/');
    const tagMatch = (isClosing ? rawTagBody.slice(1) : rawTagBody).match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!tagMatch) continue;

    const tag = tagMatch[1].toLowerCase();

    if (dropDepth > 0) {
      if (isClosing && tag === dropTag) {
        dropDepth -= 1;
        if (dropDepth === 0) dropTag = null;
      } else if (!isClosing && tag === dropTag && !rawTagBody.endsWith('/')) {
        dropDepth += 1;
      }
      continue;
    }

    if (isClosing) {
      if (ALLOWED_TAG_SET.has(tag) && !VOID_TAG_SET.has(tag)) {
        const idx = openTagStack.lastIndexOf(tag);
        if (idx !== -1) {
          while (openTagStack.length > idx) {
            const popped = openTagStack.pop()!;
            out.push(`</${popped}>`);
          }
        }
      }
      continue;
    }

    if (DROP_SUBTREE_SET.has(tag)) {
      const selfClosed = rawTagBody.endsWith('/') || VOID_TAG_SET.has(tag);
      if (!selfClosed) {
        dropDepth = 1;
        dropTag = tag;
      }
      continue;
    }

    if (!ALLOWED_TAG_SET.has(tag)) {
      // Non-allowlisted benign wrapper tag: strip wrapper but keep inner text/children
      continue;
    }

    const attrSlice = rawTagBody.slice(tagMatch[0].length);
    const parsedAttrs = parseAttributes(attrSlice.endsWith('/') ? attrSlice.slice(0, -1) : attrSlice);
    const renderedAttrs: string[] = [];
    let hasBlankTarget = false;
    let hasRel = false;

    for (const [k, rawVal] of parsedAttrs) {
      if (!isSafeYourGuiAttrName(k)) continue;
      if (URL_ATTR_SET.has(k)) {
        const safeUrl = sanitizeYourGuiUrl(rawVal, k === 'src' || k === 'poster');
        renderedAttrs.push(`${k}="${escapeHtmlAttr(safeUrl || '#')}"`);
      } else {
        if (k === 'target' && rawVal.trim().toLowerCase() === '_blank') {
          hasBlankTarget = true;
        }
        if (k === 'rel') hasRel = true;
        renderedAttrs.push(`${k}="${escapeHtmlAttr(rawVal)}"`);
      }
    }

    if (tag === 'a' && hasBlankTarget && !hasRel) {
      renderedAttrs.push('rel="noopener noreferrer"');
    }

    const attrStr = renderedAttrs.length > 0 ? ' ' + renderedAttrs.join(' ') : '';
    out.push(`<${tag}${attrStr}>`);
    if (!VOID_TAG_SET.has(tag) && !rawTagBody.endsWith('/')) {
      openTagStack.push(tag);
    }
  }

  while (openTagStack.length > 0) {
    out.push(`</${openTagStack.pop()!}>`);
  }

  return out.join('');
}

export function sanitizeYourGuiHtmlString(rawHtml: unknown): string {
  const str = String(rawHtml ?? '').slice(0, 32_768);
  if (!str) return '';

  if (typeof DOMParser === 'function' && typeof document !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(str, 'text/html');
      const container = document.createElement('div');
      for (const child of Array.from(parsed.body.childNodes)) {
        const safeChild = sanitizeDomTree(child, document);
        if (safeChild) container.appendChild(safeChild);
      }
      return container.innerHTML;
    } catch {
      // Fall through to deterministic sanitizer
    }
  }

  return sanitizeHtmlDeterministic(str);
}

/**
 * Generates self-contained JS sanitizer functions bound cleanly inside compiled runtimes
 * and sandboxed YourGUI iframe documents using the exact same allowlists and entity decoder.
 */
export const YOURGUI_SANITIZER_JS_SOURCE = `
  const YG_ALLOWED_TAGS = new Set(${JSON.stringify(YOURGUI_ALLOWED_TAGS)});
  const YG_DROP_SUBTREE_TAGS = new Set(${JSON.stringify(YOURGUI_DROP_SUBTREE_TAGS)});
  const YG_VOID_TAGS = new Set(${JSON.stringify(YOURGUI_VOID_TAGS)});
  const YG_ALLOWED_ATTRS = new Set(${JSON.stringify(YOURGUI_ALLOWED_ATTRS)});
  const YG_URL_ATTRS = new Set(${JSON.stringify(YOURGUI_URL_ATTRS)});
  const YG_NAMED_ENTITIES = ${JSON.stringify(NAMED_HTML_ENTITIES)};

  const decodeYourGuiHtmlEntities = (raw) => {
    return String(raw ?? "").replace(/&(#x[0-9a-f]+|#\\d+|[a-z][a-z0-9]+);?/gi, (full, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const cp = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      }
      if (lower.startsWith("#")) {
        const cp = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      }
      return YG_NAMED_ENTITIES[lower] ?? full;
    });
  };

  const isSafeYourGuiTag = (rawTag) => YG_ALLOWED_TAGS.has(String(rawTag ?? "").trim().toLowerCase());
  const normalizeYourGuiTag = (rawTag) => {
    const t = String(rawTag ?? "").trim().toLowerCase();
    return YG_ALLOWED_TAGS.has(t) ? t : "div";
  };

  const isSafeYourGuiAttr = (rawKey) => {
    const key = String(rawKey ?? "").trim().toLowerCase();
    if (!key || !/^[a-z][a-z0-9_-]*$/.test(key)) return false;
    if (key.startsWith("on")) return false;
    if (
      key === "srcdoc" || key === "formaction" || key === "action" || key === "style" ||
      key === "xmlns" || key === "xlink:href" || key === "data-yg-id" ||
      key === "__proto__" || key === "constructor" || key === "prototype"
    ) return false;
    return YG_ALLOWED_ATTRS.has(key) || /^aria-[a-z0-9_-]+$/.test(key) || /^data-[a-z0-9_-]+$/.test(key);
  };

  const sanitizeYourGuiUrl = (rawUrl, allowMediaData = false) => {
    const raw = String(rawUrl ?? "").trim().slice(0, 2048);
    if (!raw) return "";
    const decoded = decodeYourGuiHtmlEntities(raw);
    const compact = decoded.replace(/[\\u0000-\\u0020\\u007f]+/g, "");
    const trimmed = decoded.trim();
    if (!compact || !trimmed) return "";
    if (
      compact.startsWith("//") || compact.startsWith("/\\\\") || compact.startsWith("\\\\/") ||
      compact.startsWith("\\\\\\\\") || trimmed.startsWith("//") || trimmed.startsWith("/\\\\")
    ) {
      return "#";
    }
    if (/^(javascript|vbscript|file|blob|filesystem):/i.test(compact)) {
      return "#";
    }
    if (/^data:/i.test(compact)) {
      if (allowMediaData && /^data:image\\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(compact)) {
        return compact;
      }
      return "#";
    }
    if (compact === "#" || (compact.startsWith("#") && !/[<>]/.test(compact))) {
      return trimmed;
    }
    if (compact.startsWith("/") && compact[1] !== "/" && compact[1] !== "\\\\") {
      return trimmed;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
      return "#";
    } catch {
      if (!compact.includes(":") && !compact.startsWith("\\\\")) {
        return trimmed;
      }
      return "#";
    }
  };

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
    const s = decodeYourGuiHtmlEntities(String(rawVal ?? "").slice(0, 1024));
    if (/expression\\s*\\(|-moz-binding|behavior\\s*:|@import|url\\s*\\(|javascript\\s*:|vbscript\\s*:/i.test(s)) {
      return "";
    }
    return s.replace(/[;{}<>]/g, " ").trim();
  };

  const sanitizeYourGuiDomTree = (srcNode, outDoc) => {
    if (srcNode.nodeType === 3) return outDoc.createTextNode(srcNode.textContent || "");
    if (srcNode.nodeType !== 1) return null;
    const tag = String(srcNode.tagName || "").toLowerCase();
    if (YG_DROP_SUBTREE_TAGS.has(tag)) return null;
    if (!YG_ALLOWED_TAGS.has(tag)) {
      const frag = outDoc.createDocumentFragment();
      for (const ch of Array.from(srcNode.childNodes)) {
        const clean = sanitizeYourGuiDomTree(ch, outDoc);
        if (clean) frag.appendChild(clean);
      }
      return frag;
    }
    const cleanEl = outDoc.createElement(tag);
    for (const attr of Array.from(srcNode.attributes || [])) {
      const k = String(attr.name || "").toLowerCase();
      if (!isSafeYourGuiAttr(k)) continue;
      if (YG_URL_ATTRS.has(k)) {
        const safeUrl = sanitizeYourGuiUrl(attr.value, k === "src" || k === "poster");
        cleanEl.setAttribute(k, safeUrl || "#");
      } else {
        cleanEl.setAttribute(k, attr.value);
      }
    }
    if (tag === "a" && cleanEl.getAttribute("target") === "_blank") {
      cleanEl.setAttribute("rel", "noopener noreferrer");
    }
    for (const ch of Array.from(srcNode.childNodes)) {
      const clean = sanitizeYourGuiDomTree(ch, outDoc);
      if (clean) cleanEl.appendChild(clean);
    }
    return cleanEl;
  };

  const sanitizeYourGuiHtmlDeterministic = (rawHtml) => {
    const escText = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escAttr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const input = String(rawHtml ?? "").slice(0, 32768);
    const out = [];
    const stack = [];
    let dropDepth = 0;
    let dropTag = null;
    let i = 0;

    const parseAttrs = (attrSrc) => {
      const attrs = [];
      let pos = 0;
      const len = attrSrc.length;
      while (pos < len) {
        while (pos < len && /[\\s/]/.test(attrSrc[pos])) pos++;
        if (pos >= len) break;
        const nStart = pos;
        while (pos < len && !/[\\s=/>]/.test(attrSrc[pos])) pos++;
        const name = attrSrc.slice(nStart, pos).toLowerCase();
        while (pos < len && /\\s/.test(attrSrc[pos])) pos++;
        let val = "";
        if (pos < len && attrSrc[pos] === "=") {
          pos++;
          while (pos < len && /\\s/.test(attrSrc[pos])) pos++;
          if (pos < len && (attrSrc[pos] === '"' || attrSrc[pos] === "'")) {
            const q = attrSrc[pos++];
            const vStart = pos;
            while (pos < len && attrSrc[pos] !== q) pos++;
            val = attrSrc.slice(vStart, pos);
            if (pos < len && attrSrc[pos] === q) pos++;
          } else {
            const vStart = pos;
            while (pos < len && !/[\\s>]/.test(attrSrc[pos])) pos++;
            val = attrSrc.slice(vStart, pos);
          }
        }
        if (name) attrs.push([name, val]);
      }
      return attrs;
    };

    while (i < input.length) {
      const lt = input.indexOf("<", i);
      if (lt === -1) {
        if (dropDepth === 0) out.push(escText(input.slice(i)));
        break;
      }
      if (lt > i && dropDepth === 0) out.push(escText(input.slice(i, lt)));
      if (input.startsWith("<!--", lt)) {
        const end = input.indexOf("-->", lt + 4);
        i = end === -1 ? input.length : end + 3;
        continue;
      }
      if (input.startsWith("<!", lt) || input.startsWith("<?", lt)) {
        const end = input.indexOf(">", lt + 2);
        i = end === -1 ? input.length : end + 1;
        continue;
      }
      let pos = lt + 1;
      let inQ = null;
      while (pos < input.length) {
        const ch = input[pos];
        if (inQ) { if (ch === inQ) inQ = null; }
        else { if (ch === '"' || ch === "'") inQ = ch; else if (ch === ">") break; }
        pos++;
      }
      if (pos >= input.length) {
        if (dropDepth === 0) out.push(escText(input.slice(lt)));
        break;
      }
      const body = input.slice(lt + 1, pos).trim();
      i = pos + 1;
      if (!body) continue;
      const isClosing = body.startsWith("/");
      const tm = (isClosing ? body.slice(1) : body).match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
      if (!tm) continue;
      const tag = tm[1].toLowerCase();
      if (dropDepth > 0) {
        if (isClosing && tag === dropTag) { dropDepth -= 1; if (dropDepth === 0) dropTag = null; }
        else if (!isClosing && tag === dropTag && !body.endsWith("/")) dropDepth += 1;
        continue;
      }
      if (isClosing) {
        if (YG_ALLOWED_TAGS.has(tag) && !YG_VOID_TAGS.has(tag)) {
          const idx = stack.lastIndexOf(tag);
          if (idx !== -1) while (stack.length > idx) out.push("</" + stack.pop() + ">");
        }
        continue;
      }
      if (YG_DROP_SUBTREE_TAGS.has(tag)) {
        if (!body.endsWith("/") && !YG_VOID_TAGS.has(tag)) { dropDepth = 1; dropTag = tag; }
        continue;
      }
      if (!YG_ALLOWED_TAGS.has(tag)) continue;
      const attrSlice = body.slice(tm[0].length);
      const attrs = parseAttrs(attrSlice.endsWith("/") ? attrSlice.slice(0, -1) : attrSlice);
      const rendered = [];
      let blankTarget = false;
      let hasRel = false;
      for (const [k, rv] of attrs) {
        if (!isSafeYourGuiAttr(k)) continue;
        if (YG_URL_ATTRS.has(k)) {
          const su = sanitizeYourGuiUrl(rv, k === "src" || k === "poster");
          rendered.push(k + '="' + escAttr(su || "#") + '"');
        } else {
          if (k === "target" && rv.trim().toLowerCase() === "_blank") blankTarget = true;
          if (k === "rel") hasRel = true;
          rendered.push(k + '="' + escAttr(rv) + '"');
        }
      }
      if (tag === "a" && blankTarget && !hasRel) rendered.push('rel="noopener noreferrer"');
      out.push("<" + tag + (rendered.length ? " " + rendered.join(" ") : "") + ">");
      if (!YG_VOID_TAGS.has(tag) && !body.endsWith("/")) stack.push(tag);
    }
    while (stack.length > 0) out.push("</" + stack.pop() + ">");
    return out.join("");
  };

  const sanitizeYourGuiHtml = (rawHtml) => {
    const str = String(rawHtml ?? "").slice(0, 32768);
    if (!str) return "";
    if (typeof DOMParser === "function" && typeof document !== "undefined") {
      try {
        const parsed = new DOMParser().parseFromString(str, "text/html");
        const container = document.createElement("div");
        for (const child of Array.from(parsed.body.childNodes)) {
          const safeChild = sanitizeYourGuiDomTree(child, document);
          if (safeChild) container.appendChild(safeChild);
        }
        return container.innerHTML;
      } catch {}
    }
    return sanitizeYourGuiHtmlDeterministic(str);
  };
`;
