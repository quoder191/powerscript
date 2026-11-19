/**
 * yourgui CSS & Security Sanitization Engine
 * Delegates to the single canonical YourGUI sanitization policy in ./sanitizer.ts.
 */
import {
  isAllowedYourGuiTag,
  isSafeYourGuiAttrName,
  normalizeYourGuiTag,
  sanitizeYourGuiCssText,
  sanitizeYourGuiHtmlString,
  sanitizeYourGuiStyleValue,
  sanitizeYourGuiUrl,
  YOURGUI_SANITIZER_JS_SOURCE,
} from './sanitizer.ts';

export {
  isAllowedYourGuiTag,
  isSafeYourGuiAttrName,
  normalizeYourGuiTag,
  sanitizeYourGuiCssText,
  sanitizeYourGuiHtmlString,
  sanitizeYourGuiStyleValue,
  sanitizeYourGuiUrl,
  YOURGUI_SANITIZER_JS_SOURCE,
};

export const YOURGUI_CSS_SOURCE = `
${YOURGUI_SANITIZER_JS_SOURCE}

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
