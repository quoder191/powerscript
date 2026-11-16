/**
 * yourgui Event Binding Helpers
 * Supports both standalone DOM addEventListener and IDE live-bridge callbacks.
 */
export const YOURGUI_EVENTS_SOURCE = `
  const attachEvent = (element, eventName, callback) => {
    if (!element || typeof callback !== "function") return element;
    const ev = String(eventName).toLowerCase().replace(/^on/, "");
    if (typeof element.addEventListener === "function") {
      element.addEventListener(ev, callback);
    }
    return element;
  };

  const onClick = (element, callback) => attachEvent(element, "click", callback);
  const onInput = (element, callback) => attachEvent(element, "input", callback);
  const onChange = (element, callback) => attachEvent(element, "change", callback);
  const onSubmit = (element, callback) => attachEvent(element, "submit", callback);
`;
