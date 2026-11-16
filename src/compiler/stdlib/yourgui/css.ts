/**
 * yourgui CSS Engine Bridge
 * Uses the browser's native CSS engine via <style> injection when running in DOM,
 * and registers CSS stylesheets cleanly for live sandboxed preview rendering.
 */
export const YOURGUI_CSS_SOURCE = `
  const injectYourGuiCss = (cssText, registry, onUpdate) => {
    const clean = String(cssText ?? "");
    if (!clean.trim()) return "";
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
