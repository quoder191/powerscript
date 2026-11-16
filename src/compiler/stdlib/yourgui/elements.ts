/**
 * yourgui Element Metadata & JS Runtime Factory Source
 * Implements all standard HTML UI primitives via document.createElement() in DOM mode
 * and virtual DOM handles in sandboxed IDE preview mode.
 */
export const YOURGUI_ELEMENT_NAMES = new Set([
  'button',
  'input',
  'text',
  'heading',
  'image',
  'link',
  'textarea',
  'checkbox',
  'radio',
  'video',
  'audio',
  'select',
  'option',
  'container',
  'section',
  'line',
  'row',
  'column',
  'grid',
  'form',
]);

export const YOURGUI_EVENT_HELPER_NAMES = new Set([
  'onClick',
  'onInput',
  'onChange',
  'onSubmit',
  'click',
  'dom',
  'byId',
  'getById',
  'selectId',
  'render',
  'mount',
]);

export const YOURGUI_ALL_GUI_SYMBOLS = new Set([
  'yourgui',
  ...YOURGUI_ELEMENT_NAMES,
  ...YOURGUI_EVENT_HELPER_NAMES,
]);

export const YOURGUI_ELEMENTS_SOURCE = `
  const applyElementOpts = (el, opts) => {
    if (!opts || typeof opts !== "object" || Array.isArray(opts)) return;
    if (opts.id !== undefined) el.id = String(opts.id);
    if (opts.className !== undefined) el.className = String(opts.className);
    if (opts.class !== undefined) el.className = String(opts.class);
    if (opts.text !== undefined) el.textContent = formatVal(opts.text);
    if (opts.textContent !== undefined) el.textContent = formatVal(opts.textContent);
    if (opts.innerText !== undefined) el.textContent = formatVal(opts.innerText);
    if (opts.innertext !== undefined) el.textContent = formatVal(opts.innertext);
    if (opts.innerHTML !== undefined) el.innerHTML = String(opts.innerHTML);
    if (opts.innerhtml !== undefined) el.innerHTML = String(opts.innerhtml);
    if (opts.html !== undefined) el.innerHTML = String(opts.html);
    if (opts.value !== undefined) el.value = String(opts.value);
    if (opts.placeholder !== undefined) el.placeholder = String(opts.placeholder);
    if (opts.href !== undefined) el.href = String(opts.href);
    if (opts.src !== undefined) el.src = String(opts.src);
    if (opts.alt !== undefined) el.alt = String(opts.alt);
    if (opts.type !== undefined) el.type = String(opts.type);
    if (opts.name !== undefined) el.setAttr("name", String(opts.name));
    if (opts.checked !== undefined) el.checked = Boolean(opts.checked);
    if (opts.disabled !== undefined) el.disabled = Boolean(opts.disabled);
    if (opts.title !== undefined) el.setAttr("title", String(opts.title));
    if (opts.style && typeof opts.style === "object") el.setStyle(opts.style);
    if (typeof opts.onclick === "function") el.onclick = opts.onclick;
    if (typeof opts.onClick === "function") el.onclick = opts.onClick;
    if (typeof opts.oninput === "function") el.oninput = opts.oninput;
    if (typeof opts.onInput === "function") el.oninput = opts.onInput;
    if (typeof opts.onchange === "function") el.onchange = opts.onchange;
    if (typeof opts.onChange === "function") el.onchange = opts.onChange;
    if (typeof opts.onsubmit === "function") el.onsubmit = opts.onsubmit;
    if (typeof opts.onSubmit === "function") el.onsubmit = opts.onSubmit;
  };
`;
