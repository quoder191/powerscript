import type { GuiVNodeSnapshot, VisualOutputItem } from '../../utils/helpers.ts';
import {
  isSafeYourGuiAttrName,
  sanitizeYourGuiCssText,
  sanitizeYourGuiHtmlString,
  sanitizeYourGuiStyleValue,
  sanitizeYourGuiUrl,
  YOURGUI_CSS_SOURCE,
} from './css.ts';
import {
  YOURGUI_ALL_GUI_SYMBOLS,
  YOURGUI_ELEMENT_NAMES,
  YOURGUI_ELEMENTS_SOURCE,
  YOURGUI_EVENT_HELPER_NAMES,
} from './elements.ts';
import { YOURGUI_EVENTS_SOURCE } from './events.ts';
import { YOURGUI_DOM_SOURCE } from './dom.ts';

export { YOURGUI_ALL_GUI_SYMBOLS, YOURGUI_ELEMENT_NAMES, YOURGUI_EVENT_HELPER_NAMES };

export const YOURGUI_STDLIB_SOURCE = `
${YOURGUI_CSS_SOURCE}
${YOURGUI_ELEMENTS_SOURCE}
${YOURGUI_EVENTS_SOURCE}
${YOURGUI_DOM_SOURCE}
`;

export interface GuiNodeHandle {
  __isGuiElement: true;
  __guiId: string;
  __tag: string;
  id: string;
  className: string;
  textContent: string;
  text: string;
  innerText: string;
  innertext: string;
  innerHTML: string;
  innerhtml: string;
  value: string;
  checked: boolean;
  placeholder: string;
  href: string;
  src: string;
  alt: string;
  type: string;
  disabled: boolean;
  style: Record<string, string>;
  onclick: unknown;
  oninput: unknown;
  onchange: unknown;
  onsubmit: unknown;
  addEventListener: (eventType: string, fn: unknown) => GuiNodeHandle;
  on: (eventType: string, fn: unknown) => GuiNodeHandle;
  onClick: (fn: unknown) => GuiNodeHandle;
  onInput: (fn: unknown) => GuiNodeHandle;
  onChange: (fn: unknown) => GuiNodeHandle;
  onSubmit: (fn: unknown) => GuiNodeHandle;
  click: () => Promise<GuiNodeHandle>;
  setText: (v: unknown) => GuiNodeHandle;
  getText: () => string;
  setStyle: (styleMap: Record<string, unknown>) => GuiNodeHandle;
  setColor: (fg: unknown, bg?: unknown) => GuiNodeHandle;
  setBg: (bg: unknown) => GuiNodeHandle;
  setAttr: (k: string, v: unknown) => GuiNodeHandle;
  getAttr: (k: string) => unknown;
  disable: () => GuiNodeHandle;
  enable: () => GuiNodeHandle;
  setDisabled: (flag: unknown) => GuiNodeHandle;
  hide: () => GuiNodeHandle;
  show: () => GuiNodeHandle;
  toggle: () => GuiNodeHandle;
  addClass: (cls: unknown) => GuiNodeHandle;
  removeClass: (cls: unknown) => GuiNodeHandle;
  toggleClass: (cls: unknown) => GuiNodeHandle;
  append: (...items: unknown[]) => GuiNodeHandle;
  add: (...items: unknown[]) => GuiNodeHandle;
  appendChild: (item: unknown) => unknown;
  push: (...items: unknown[]) => number;
  pop: () => unknown;
  peek: () => unknown;
  count: () => number;
  len: () => number;
  size: () => number;
  clear: () => GuiNodeHandle;
  remove: () => GuiNodeHandle;
  render: (builderOrHtml: unknown) => Promise<GuiNodeHandle>;
  mount: (childOrBuilder: unknown) => Promise<GuiNodeHandle>;
  toString: () => string;
  _detach: () => void;
  _setParent: (p: GuiNodeHandle | null) => void;
  _removeChildRef: (c: GuiNodeHandle) => void;
  _getListeners: (ev: string) => unknown[];
  _syncFromBrowser: (payload?: { value?: string; checked?: boolean }) => void;
  _setRadioCheckedQuiet: (val: boolean) => void;
  _toSnapshot: () => GuiVNodeSnapshot;
}

/**
 * Pure TypeScript YourGUI engine for the zero-eval ASTInterpreter.
 * Mirrors the exact DOM/CSS/event semantics of the compiled JS runtime.
 */
export class YourGuiEngine {
  public readonly pageId = `yg_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  private readonly styles: string[] = [];
  private readonly rootNodes: GuiNodeHandle[] = [];
  private readonly nodeRegistry = new Map<string, GuiNodeHandle>();
  private readonly idRegistry = new Map<string, GuiNodeHandle>();
  private readonly mountStack: GuiNodeHandle[] = [];
  private pageTitle = 'EasyJS YourGUI App';
  private nextId = 1;
  private emitQueued = false;
  private dirty = false;

  private readonly formatVal: (v: unknown) => string;
  private readonly invokeCallback: (fn: unknown, args: unknown[]) => Promise<unknown>;
  private readonly onVisualUpdate: (item: VisualOutputItem) => void;

  constructor(deps: {
    formatVal: (v: unknown) => string;
    invokeCallback: (fn: unknown, args: unknown[]) => Promise<unknown>;
    onVisualUpdate: (item: VisualOutputItem) => void;
  }) {
    this.formatVal = deps.formatVal;
    this.invokeCallback = deps.invokeCallback;
    this.onVisualUpdate = deps.onVisualUpdate;
  }

  public getSnapshot(): VisualOutputItem {
    return {
      kind: 'yourgui',
      pageId: this.pageId,
      title: this.pageTitle,
      styles: [...this.styles],
      nodes: this.rootNodes.map((n) => n._toSnapshot()),
    };
  }

  public emitSnapshot(): void {
    this.dirty = false;
    this.emitQueued = false;
    this.onVisualUpdate(this.getSnapshot());
  }

  public requestEmit(): void {
    this.dirty = true;
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      if (this.dirty) {
        this.emitSnapshot();
      } else {
        this.emitQueued = false;
      }
    });
  }

  public flush(): void {
    if (this.dirty || this.rootNodes.length > 0 || this.styles.length > 0) {
      this.emitSnapshot();
    }
  }

  public injectCss(cssText: unknown): string {
    const clean = sanitizeYourGuiCssText(cssText);
    if (!clean.trim()) return '';
    if (this.styles.length >= 64) {
      throw new Error('SecurityError: CSS stylesheet quota exceeded in yourgui');
    }
    this.styles.push(clean);
    this.requestEmit();
    return clean;
  }

  public async dispatchEvent(
    elementId: string,
    eventType: string,
    payload?: { value?: string; checked?: boolean }
  ): Promise<void> {
    const target = this.nodeRegistry.get(String(elementId));
    if (!target) return;
    target._syncFromBrowser(payload);
    const ev = String(eventType).toLowerCase();
    if (ev === 'click' && target.disabled) return;
    const handlers = [...target._getListeners(ev)];
    const eventObj = {
      type: ev,
      target,
      value: target.value,
      checked: target.checked,
    };
    for (const fn of handlers) {
      await this.invokeCallback(fn, [eventObj]);
    }
    this.emitSnapshot();
  }

  private applyElementOpts(el: GuiNodeHandle, opts: unknown): void {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return;
    const o = opts as Record<string, unknown>;
    if (o.id !== undefined) el.id = String(o.id);
    if (o.className !== undefined) el.className = String(o.className);
    if (o.class !== undefined) el.className = String(o.class);
    if (o.text !== undefined) el.textContent = this.formatVal(o.text);
    if (o.textContent !== undefined) el.textContent = this.formatVal(o.textContent);
    if (o.innerText !== undefined) el.textContent = this.formatVal(o.innerText);
    if (o.innertext !== undefined) el.textContent = this.formatVal(o.innertext);
    if (o.innerHTML !== undefined) el.innerHTML = String(o.innerHTML);
    if (o.innerhtml !== undefined) el.innerHTML = String(o.innerhtml);
    if (o.html !== undefined) el.innerHTML = String(o.html);
    if (o.value !== undefined) el.value = String(o.value);
    if (o.placeholder !== undefined) el.placeholder = String(o.placeholder);
    if (o.href !== undefined) el.href = String(o.href);
    if (o.src !== undefined) el.src = String(o.src);
    if (o.alt !== undefined) el.alt = String(o.alt);
    if (o.type !== undefined) el.type = String(o.type);
    if (o.name !== undefined) el.setAttr('name', String(o.name));
    if (o.checked !== undefined) el.checked = Boolean(o.checked);
    if (o.disabled !== undefined) el.disabled = Boolean(o.disabled);
    if (o.title !== undefined) el.setAttr('title', String(o.title));
    if (o.style && typeof o.style === 'object') {
      el.setStyle(o.style as Record<string, unknown>);
    }
    if (o.onclick !== undefined) el.onclick = o.onclick;
    if (o.onClick !== undefined) el.onclick = o.onClick;
    if (o.oninput !== undefined) el.oninput = o.oninput;
    if (o.onInput !== undefined) el.oninput = o.onInput;
    if (o.onchange !== undefined) el.onchange = o.onchange;
    if (o.onChange !== undefined) el.onchange = o.onChange;
    if (o.onsubmit !== undefined) el.onsubmit = o.onsubmit;
    if (o.onSubmit !== undefined) el.onsubmit = o.onSubmit;
  }

  private normalizeDomId(raw: unknown): string {
    return String(raw ?? '').trim().replace(/^#/, '');
  }

  private isHashIdArg(v: unknown): v is string {
    return typeof v === 'string' && v.startsWith('#') && v.length > 1;
  }

  private findElementById(rawId: unknown): GuiNodeHandle | null {
    const clean = this.normalizeDomId(rawId);
    if (!clean) return null;
    const direct = this.idRegistry.get(clean);
    if (direct) return direct;
    for (const node of this.nodeRegistry.values()) {
      if (node.id === clean || node.__guiId === clean) return node;
    }
    return null;
  }

  private isCallable(v: unknown): boolean {
    return Boolean(
      typeof v === 'function' ||
        (v && typeof v === 'object' && (v as { __isEjsFn?: boolean }).__isEjsFn)
    );
  }

  private makeElement(tag: string, textValue?: unknown): GuiNodeHandle {
    if (this.nodeRegistry.size >= 1000) {
      throw new Error('SecurityError: yourgui DOM node quota (1000) exceeded');
    }
    const safeTag = /^[a-z0-9]+$/i.test(String(tag || '')) ? String(tag).toLowerCase() : 'div';
    const id = `el_${this.nextId++}`;
    const attrs: Record<string, string | boolean> = {};
    const styleObj: Record<string, string> = {};
    const listeners = new Map<string, unknown[]>();
    const children: GuiNodeHandle[] = [];
    const textHistory: string[] = [];
    let parentNode: GuiNodeHandle | null = null;
    let textContent = textValue !== undefined ? this.formatVal(textValue) : '';
    let htmlContent: string | undefined = undefined;
    let prevDisplay = '';
    let customId = '';

    const emit = () => this.requestEmit();
    const rootNodes = this.rootNodes;
    const nodeRegistry = this.nodeRegistry;
    const idRegistry = this.idRegistry;
    const mountStack = this.mountStack;
    const formatVal = this.formatVal;
    const isCallable = (v: unknown) => this.isCallable(v);
    const invokeCallback = (fn: unknown, args: unknown[]) => this.invokeCallback(fn, args);

    const styleProxy = new Proxy(styleObj, {
      set: (target, prop, val) => {
        const key = String(prop);
        if (
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype' ||
          !/^[a-zA-Z-]+$/.test(key)
        ) {
          return true;
        }
        target[key] = sanitizeYourGuiStyleValue(val);
        emit();
        return true;
      },
      get: (target, prop) =>
        Object.prototype.hasOwnProperty.call(target, String(prop)) ? target[String(prop)] : undefined,
    });

    const getClasses = () =>
      String(attrs.class ?? '')
        .split(/\s+/)
        .filter(Boolean);

    const handle: GuiNodeHandle = {
      __isGuiElement: true,
      __guiId: id,
      __tag: safeTag,
      style: styleProxy,

      get id(): string { return String(attrs.id ?? ''); },
      set id(v: string) {
        if (customId && idRegistry.get(customId) === handle) {
          idRegistry.delete(customId);
        }
        const clean = String(v ?? '').trim().replace(/^#/, '');
        customId = clean;
        if (clean) {
          attrs.id = clean;
          idRegistry.set(clean, handle);
        } else {
          delete attrs.id;
        }
        emit();
      },

      get className(): string { return String(attrs.class ?? ''); },
      set className(v: string) { attrs.class = String(v); emit(); },

      get textContent(): string { return textContent; },
      set textContent(v: string) {
        const raw: unknown = v;
        htmlContent = undefined;
        textContent = raw === null || raw === undefined ? '' : formatVal(raw);
        emit();
      },

      get text(): string { return textContent; },
      set text(v: string) { handle.textContent = v; },

      get innerText(): string { return textContent; },
      set innerText(v: string) { handle.textContent = v; },

      get innertext(): string { return textContent; },
      set innertext(v: string) { handle.textContent = v; },

      get innerHTML(): string { return htmlContent !== undefined ? htmlContent : textContent; },
      set innerHTML(v: string) {
        const raw: unknown = v;
        for (const c of children) c._setParent(null);
        children.length = 0;
        const s = raw === null || raw === undefined ? '' : sanitizeYourGuiHtmlString(raw);
        htmlContent = s;
        textContent = s.replace(/<[^>]*>/g, '');
        emit();
      },

      get innerhtml(): string { return handle.innerHTML; },
      set innerhtml(v: string) { handle.innerHTML = v; },

      get value(): string { return String(attrs.value ?? ''); },
      set value(v: string) {
        const raw: unknown = v;
        attrs.value = raw === null || raw === undefined ? '' : String(raw);
        emit();
      },

      get checked(): boolean { return Boolean(attrs.checked); },
      set checked(v: boolean) {
        attrs.checked = Boolean(v);
        emit();
      },

      get placeholder(): string { return String(attrs.placeholder ?? ''); },
      set placeholder(v: string) { attrs.placeholder = String(v ?? ''); emit(); },

      get href(): string { return String(attrs.href ?? ''); },
      set href(v: string) { attrs.href = sanitizeYourGuiUrl(v, false) || '#'; emit(); },

      get src(): string { return String(attrs.src ?? ''); },
      set src(v: string) { attrs.src = sanitizeYourGuiUrl(v, true); emit(); },

      get alt(): string { return String(attrs.alt ?? ''); },
      set alt(v: string) { attrs.alt = String(v ?? ''); emit(); },

      get type(): string { return String(attrs.type ?? ''); },
      set type(v: string) { attrs.type = String(v ?? ''); emit(); },

      get disabled(): boolean { return Boolean(attrs.disabled); },
      set disabled(v: boolean) {
        if (Boolean(v)) attrs.disabled = true;
        else delete attrs.disabled;
        emit();
      },

      get onclick() { return listeners.get('click')?.[0] ?? null; },
      set onclick(fn: unknown) { listeners.set('click', isCallable(fn) ? [fn] : []); },

      get oninput() { return listeners.get('input')?.[0] ?? null; },
      set oninput(fn: unknown) { listeners.set('input', isCallable(fn) ? [fn] : []); },

      get onchange() { return listeners.get('change')?.[0] ?? null; },
      set onchange(fn: unknown) { listeners.set('change', isCallable(fn) ? [fn] : []); },

      get onsubmit() { return listeners.get('submit')?.[0] ?? null; },
      set onsubmit(fn: unknown) { listeners.set('submit', isCallable(fn) ? [fn] : []); },

      addEventListener: (eventType: string, fn: unknown) => {
        if (!isCallable(fn)) return handle;
        const ev = String(eventType).toLowerCase().replace(/^on/, '');
        const list = listeners.get(ev) ?? [];
        list.push(fn);
        listeners.set(ev, list);
        return handle;
      },

      on: (eventType: string, fn: unknown) => handle.addEventListener(eventType, fn),
      onClick: (fn: unknown) => handle.addEventListener('click', fn),
      onInput: (fn: unknown) => handle.addEventListener('input', fn),
      onChange: (fn: unknown) => handle.addEventListener('change', fn),
      onSubmit: (fn: unknown) => handle.addEventListener('submit', fn),

      click: async () => {
        if (attrs.disabled) return handle;
        await this.dispatchEvent(id, 'click');
        return handle;
      },

      setText: (v: unknown) => {
        handle.textContent = v === null || v === undefined ? '' : formatVal(v);
        return handle;
      },

      getText: () => textContent,

      setStyle: (styleMap: Record<string, unknown>) => {
        if (styleMap && typeof styleMap === 'object') {
          for (const [k, v] of Object.entries(styleMap)) {
            const key = String(k);
            if (
              key === '__proto__' ||
              key === 'constructor' ||
              key === 'prototype' ||
              !/^[a-zA-Z-]+$/.test(key)
            ) {
              continue;
            }
            styleObj[key] = sanitizeYourGuiStyleValue(v);
          }
          emit();
        }
        return handle;
      },

      setColor: (fg: unknown, bg?: unknown) => {
        if (fg !== undefined && fg !== null) styleObj.color = sanitizeYourGuiStyleValue(fg);
        if (bg !== undefined && bg !== null) styleObj.backgroundColor = sanitizeYourGuiStyleValue(bg);
        emit();
        return handle;
      },

      setBg: (bg: unknown) => {
        styleObj.backgroundColor = bg === null || bg === undefined ? '' : sanitizeYourGuiStyleValue(bg);
        emit();
        return handle;
      },

      setAttr: (k: string, v: unknown) => {
        const key = String(k);
        const lower = key.toLowerCase();
        if (!isSafeYourGuiAttrName(key)) {
          return handle;
        }
        if (v === false || v === null || v === undefined) {
          delete attrs[key];
        } else {
          let safeVal: string | boolean = v === true ? true : String(v);
          if (safeVal !== true && (lower === 'href' || lower === 'src' || lower === 'poster' || lower === 'action')) {
            safeVal = sanitizeYourGuiUrl(safeVal, lower === 'src' || lower === 'poster') || '#';
          }
          attrs[key] = safeVal;
        }
        emit();
        return handle;
      },

      getAttr: (k: string) => attrs[String(k)] ?? null,

      disable: () => {
        handle.disabled = true;
        return handle;
      },

      enable: () => {
        handle.disabled = false;
        return handle;
      },

      setDisabled: (flag: unknown) => {
        handle.disabled = Boolean(flag);
        return handle;
      },

      hide: () => {
        if (styleObj.display !== 'none') {
          prevDisplay = styleObj.display ?? '';
        }
        styleObj.display = 'none';
        emit();
        return handle;
      },

      show: () => {
        if (styleObj.display === 'none') {
          if (prevDisplay) styleObj.display = prevDisplay;
          else delete styleObj.display;
          emit();
        }
        return handle;
      },

      toggle: () => (styleObj.display === 'none' ? handle.show() : handle.hide()),

      addClass: (cls: unknown) => {
        const parts = String(cls ?? '').split(/\s+/).filter(Boolean);
        const set = new Set(getClasses());
        for (const c of parts) set.add(c);
        attrs.class = Array.from(set).join(' ');
        emit();
        return handle;
      },

      removeClass: (cls: unknown) => {
        const toRemove = new Set(String(cls ?? '').split(/\s+/).filter(Boolean));
        const next = getClasses().filter((c) => !toRemove.has(c));
        if (next.length > 0) attrs.class = next.join(' ');
        else delete attrs.class;
        emit();
        return handle;
      },

      toggleClass: (cls: unknown) => {
        const parts = String(cls ?? '').split(/\s+/).filter(Boolean);
        const set = new Set(getClasses());
        for (const c of parts) {
          if (set.has(c)) set.delete(c);
          else set.add(c);
        }
        if (set.size > 0) attrs.class = Array.from(set).join(' ');
        else delete attrs.class;
        emit();
        return handle;
      },

      append: (...items: unknown[]) => {
        for (const item of items) {
          if (!item || typeof item !== 'object' || !(item as GuiNodeHandle).__isGuiElement) continue;
          const node = item as GuiNodeHandle;
          node._detach();
          node._setParent(handle);
          children.push(node);
        }
        emit();
        return handle;
      },

      add: (...items: unknown[]) => handle.append(...items),

      appendChild: (item: unknown) => {
        handle.append(item);
        return item;
      },

      push: (...items: unknown[]) => {
        for (const item of items) {
          if (item && typeof item === 'object' && (item as GuiNodeHandle).__isGuiElement) {
            const node = item as GuiNodeHandle;
            node._detach();
            node._setParent(handle);
            children.push(node);
          } else {
            textHistory.push(textContent);
            htmlContent = undefined;
            textContent = item === null || item === undefined ? '' : formatVal(item);
          }
        }
        emit();
        return children.length > 0 ? children.length : textHistory.length;
      },

      pop: () => {
        if (textHistory.length > 0) {
          const popped = textContent;
          htmlContent = undefined;
          textContent = textHistory.pop()!;
          emit();
          return popped;
        }
        if (children.length > 0) {
          const last = children.pop()!;
          last._setParent(null);
          emit();
          return last;
        }
        return null;
      },

      peek: () => {
        if (children.length > 0) return children[children.length - 1];
        if (textHistory.length > 0) return textContent;
        return textContent;
      },

      count: () => (children.length > 0 ? children.length : textHistory.length),
      len: () => (children.length > 0 ? children.length : textHistory.length),
      size: () => (children.length > 0 ? children.length : textHistory.length),

      clear: () => {
        for (const c of children) c._setParent(null);
        children.length = 0;
        textHistory.length = 0;
        htmlContent = undefined;
        emit();
        return handle;
      },

      remove: () => {
        handle._detach();
        if (customId && idRegistry.get(customId) === handle) {
          idRegistry.delete(customId);
        }
        emit();
        return handle;
      },

      render: async (builderOrContent: unknown) => {
        handle.clear();
        if (isCallable(builderOrContent)) {
          mountStack.push(handle);
          try {
            await invokeCallback(builderOrContent, [handle]);
          } finally {
            if (mountStack[mountStack.length - 1] === handle) {
              mountStack.pop();
            }
          }
        } else if (
          builderOrContent &&
          typeof builderOrContent === 'object' &&
          (builderOrContent as GuiNodeHandle).__isGuiElement
        ) {
          handle.append(builderOrContent);
        } else if (builderOrContent !== undefined && builderOrContent !== null) {
          handle.textContent = formatVal(builderOrContent);
        }
        emit();
        return handle;
      },

      mount: async (childOrBuilder: unknown) => {
        if (isCallable(childOrBuilder)) {
          mountStack.push(handle);
          try {
            await invokeCallback(childOrBuilder, [handle]);
          } finally {
            if (mountStack[mountStack.length - 1] === handle) {
              mountStack.pop();
            }
          }
        } else if (
          childOrBuilder &&
          typeof childOrBuilder === 'object' &&
          (childOrBuilder as GuiNodeHandle).__isGuiElement
        ) {
          handle.append(childOrBuilder);
        }
        emit();
        return handle;
      },

      toString: () => `<${tag}#${customId || id}>`,

      _detach: () => {
        if (parentNode) {
          parentNode._removeChildRef(handle);
          parentNode = null;
        } else {
          const idx = rootNodes.indexOf(handle);
          if (idx !== -1) rootNodes.splice(idx, 1);
        }
      },

      _setParent: (p: GuiNodeHandle | null) => {
        parentNode = p;
      },

      _removeChildRef: (c: GuiNodeHandle) => {
        const idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
      },

      _getListeners: (ev: string) => listeners.get(ev) ?? [],

      _syncFromBrowser: (payload?: { value?: string; checked?: boolean }) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.value !== undefined) attrs.value = String(payload.value);
        if (payload.checked !== undefined) {
          const nextChecked = Boolean(payload.checked);
          attrs.checked = nextChecked;
          if (tag === 'input' && attrs.type === 'radio' && attrs.name && nextChecked) {
            for (const other of nodeRegistry.values()) {
              if (
                other !== handle &&
                other.__tag === 'input' &&
                other.getAttr('type') === 'radio' &&
                other.getAttr('name') === attrs.name
              ) {
                other._setRadioCheckedQuiet(false);
              }
            }
          }
        }
      },

      _setRadioCheckedQuiet: (val: boolean) => {
        attrs.checked = val;
      },

      _toSnapshot: (): GuiVNodeSnapshot => ({
        id,
        tag: safeTag,
        textContent: children.length === 0 ? textContent : undefined,
        html: children.length === 0 ? htmlContent : undefined,
        attrs: { ...attrs },
        style: { ...styleObj },
        children: children.map((c) => c._toSnapshot()),
      }),
    };

    this.nodeRegistry.set(id, handle);
    return handle;
  }

  private mountNode(node: GuiNodeHandle): GuiNodeHandle {
    if (this.mountStack.length > 0) {
      this.mountStack[this.mountStack.length - 1].append(node);
    } else {
      this.rootNodes.push(node);
      this.requestEmit();
    }
    return node;
  }

  private createWrappedChoice(
    inputType: 'checkbox' | 'radio',
    label = '',
    checkedOrName: unknown = false,
    valOrOpts?: unknown,
    maybeOpts?: unknown
  ): GuiNodeHandle {
    const inputEl = this.makeElement('input');
    inputEl.type = inputType;
    if (inputType === 'checkbox') {
      if (typeof checkedOrName === 'object' && checkedOrName !== null) {
        this.applyElementOpts(inputEl, checkedOrName);
      } else {
        inputEl.checked = Boolean(checkedOrName);
        this.applyElementOpts(inputEl, valOrOpts);
      }
    } else {
      const groupName =
        typeof checkedOrName === 'string' && checkedOrName ? checkedOrName : 'radio_group';
      inputEl.setAttr('name', groupName);
      inputEl.value = typeof valOrOpts === 'string' ? valOrOpts : String(label ?? '');
      if (typeof valOrOpts === 'object' && valOrOpts !== null) {
        this.applyElementOpts(inputEl, valOrOpts);
      } else {
        this.applyElementOpts(inputEl, maybeOpts);
      }
    }

    if (!label) return this.mountNode(inputEl);

    const wrapper = this.makeElement('label');
    wrapper.setStyle({ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' });
    const textSpan = this.makeElement('span', String(label));
    wrapper.append(inputEl);
    wrapper.append(textSpan);
    this.mountNode(wrapper);
    return inputEl;
  }

  public createNamespace(): Record<string, unknown> {
    const attachEvent = (element: unknown, eventName: unknown, callback: unknown) => {
      if (element && typeof element === 'object' && (element as GuiNodeHandle).__isGuiElement) {
        (element as GuiNodeHandle).addEventListener(String(eventName), callback);
      }
      return element;
    };

    const normalizeSectionArgs = (a?: unknown, b?: unknown, c?: unknown) => {
      let customId: string | undefined;
      let opts: unknown;
      let builder: unknown;
      if (typeof a === 'string') {
        customId = this.normalizeDomId(a);
        if (this.isCallable(b)) {
          builder = b;
        } else {
          opts = b;
          if (this.isCallable(c)) builder = c;
        }
      } else if (this.isCallable(a)) {
        builder = a;
      } else {
        opts = a;
        if (this.isCallable(b)) builder = b;
      }
      return { customId, opts, builder };
    };

    const runTagContainer = async (tag: string, a?: unknown, b?: unknown, c?: unknown) => {
      const { customId, opts, builder } = normalizeSectionArgs(a, b, c);
      const el = this.makeElement(tag);
      if (customId) el.id = customId;
      this.applyElementOpts(el, opts);
      this.mountNode(el);
      if (builder) {
        this.mountStack.push(el);
        try {
          await this.invokeCallback(builder, [el]);
        } finally {
          if (this.mountStack[this.mountStack.length - 1] === el) {
            this.mountStack.pop();
          }
        }
        this.requestEmit();
      }
      return el;
    };

    const ns: Record<string, unknown> = {
      css: (cssText: unknown) => this.injectCss(cssText),
      style: (cssText: unknown) => this.injectCss(cssText),
      title: (t: unknown) => {
        this.pageTitle = this.formatVal(t);
        this.requestEmit();
        return this.pageTitle;
      },
      flush: () => this.flush(),
      clear: () => {
        this.rootNodes.length = 0;
        this.styles.length = 0;
        this.idRegistry.clear();
        this.emitSnapshot();
        return true;
      },

      dom: (id: unknown) => this.findElementById(id),
      byId: (id: unknown) => this.findElementById(id),
      getById: (id: unknown) => this.findElementById(id),
      selectId: (id: unknown) => this.findElementById(id),
      render: async (targetOrId: unknown, builderOrContent: unknown) => {
        const target =
          typeof targetOrId === 'string'
            ? this.findElementById(targetOrId)
            : (targetOrId as GuiNodeHandle | null);
        if (target && typeof target === 'object' && target.__isGuiElement) {
          return target.render(builderOrContent);
        }
        return null;
      },

      button: (value: unknown = 'Button', onClickOrOpts?: unknown, maybeOpts?: unknown, fourthArg?: unknown) => {
        let customId: string | undefined;
        let textVal = value;
        let a2 = onClickOrOpts;
        let a3 = maybeOpts;
        if (this.isHashIdArg(value) && onClickOrOpts !== undefined) {
          customId = this.normalizeDomId(value);
          textVal = onClickOrOpts;
          a2 = maybeOpts;
          a3 = fourthArg;
        }
        let el: GuiNodeHandle;
        if (
          typeof textVal === 'object' &&
          textVal !== null &&
          !Array.isArray(textVal) &&
          !(textVal as GuiNodeHandle).__isGuiElement
        ) {
          const cfg = textVal as Record<string, unknown>;
          const initialText = cfg.text ?? cfg.innerText ?? cfg.innertext ?? cfg.textContent ?? 'Button';
          el = this.makeElement('button', initialText);
          if (customId) el.id = customId;
          this.applyElementOpts(el, textVal);
          if (this.isCallable(a2)) el.onclick = a2;
        } else {
          el = this.makeElement('button', textVal);
          if (customId) el.id = customId;
          if (this.isCallable(a2)) {
            el.onclick = a2;
            if (a3) this.applyElementOpts(el, a3);
          } else {
            this.applyElementOpts(el, a2);
            if (this.isCallable(a3)) el.onclick = a3;
          }
        }
        return this.mountNode(el);
      },

      input: (placeholderOrOpts: unknown = '', typeOrOpts: unknown = 'text', thirdArg?: unknown) => {
        let customId: string | undefined;
        let ph = placeholderOrOpts;
        let tp = typeOrOpts;
        if (this.isHashIdArg(placeholderOrOpts) && typeOrOpts !== undefined) {
          customId = this.normalizeDomId(placeholderOrOpts);
          ph = typeOrOpts;
          tp = thirdArg ?? 'text';
        }
        const el = this.makeElement('input');
        if (customId) el.id = customId;
        if (
          typeof ph === 'object' &&
          ph !== null &&
          !Array.isArray(ph)
        ) {
          const obj = ph as Record<string, unknown>;
          el.type = obj.type ? String(obj.type) : 'text';
          this.applyElementOpts(el, ph);
        } else {
          el.placeholder = String(ph ?? '');
          if (typeof tp === 'string') {
            el.type = tp;
          } else {
            el.type = 'text';
            this.applyElementOpts(el, tp);
          }
        }
        return this.mountNode(el);
      },

      text: (value: unknown = '', opts?: unknown, thirdArg?: unknown) => {
        let customId: string | undefined;
        let val = value;
        let resolvedOpts = opts;
        if (this.isHashIdArg(value) && opts !== undefined) {
          customId = this.normalizeDomId(value);
          val = opts;
          resolvedOpts = thirdArg;
        }
        const el = this.makeElement('p', val);
        if (customId) el.id = customId;
        this.applyElementOpts(el, resolvedOpts);
        return this.mountNode(el);
      },

      heading: (value: unknown = '', levelOrOpts: unknown = 1, thirdArg?: unknown) => {
        let customId: string | undefined;
        let val = value;
        let lvlArg = levelOrOpts;
        if (this.isHashIdArg(value) && levelOrOpts !== undefined) {
          customId = this.normalizeDomId(value);
          val = levelOrOpts;
          lvlArg = thirdArg ?? 1;
        }
        let level = 1;
        let opts: unknown = undefined;
        if (typeof lvlArg === 'number') {
          level = Math.min(6, Math.max(1, Math.trunc(lvlArg)));
        } else if (typeof lvlArg === 'object' && lvlArg !== null) {
          opts = lvlArg;
          const l = (lvlArg as Record<string, unknown>).level;
          if (typeof l === 'number') level = Math.min(6, Math.max(1, Math.trunc(l)));
        }
        const el = this.makeElement(`h${level}`, val);
        if (customId) el.id = customId;
        this.applyElementOpts(el, opts);
        return this.mountNode(el);
      },

      image: (src: unknown = '', altOrOpts: unknown = '', maybeOpts?: unknown) => {
        let customId: string | undefined;
        let s = src;
        let a = altOrOpts;
        let m = maybeOpts;
        if (this.isHashIdArg(src) && altOrOpts !== undefined) {
          customId = this.normalizeDomId(src);
          s = altOrOpts;
          a = maybeOpts ?? '';
          m = undefined;
        }
        const el = this.makeElement('img');
        if (customId) el.id = customId;
        if (typeof s === 'object' && s !== null) {
          this.applyElementOpts(el, s);
        } else {
          el.src = String(s ?? '');
          if (typeof a === 'string') {
            el.alt = a;
            this.applyElementOpts(el, m);
          } else {
            this.applyElementOpts(el, a);
          }
        }
        return this.mountNode(el);
      },

      link: (label: unknown = '', hrefOrOpts: unknown = '#', maybeOpts?: unknown) => {
        let customId: string | undefined;
        let lbl = label;
        let h = hrefOrOpts;
        let m = maybeOpts;
        if (this.isHashIdArg(label) && hrefOrOpts !== undefined) {
          customId = this.normalizeDomId(label);
          lbl = hrefOrOpts;
          h = maybeOpts ?? '#';
          m = undefined;
        }
        const el = this.makeElement('a', lbl);
        if (customId) el.id = customId;
        if (typeof h === 'string') {
          el.href = h;
          this.applyElementOpts(el, m);
        } else {
          el.href = '#';
          this.applyElementOpts(el, h);
        }
        el.setAttr('target', '_blank');
        el.setAttr('rel', 'noopener noreferrer');
        return this.mountNode(el);
      },

      textarea: (placeholderOrOpts: unknown = '', maybeOpts?: unknown) => {
        let customId: string | undefined;
        let ph = placeholderOrOpts;
        let m = maybeOpts;
        if (this.isHashIdArg(placeholderOrOpts) && maybeOpts !== undefined) {
          customId = this.normalizeDomId(placeholderOrOpts);
          ph = maybeOpts;
          m = undefined;
        }
        const el = this.makeElement('textarea');
        if (customId) el.id = customId;
        if (typeof ph === 'object' && ph !== null) {
          this.applyElementOpts(el, ph);
        } else {
          el.placeholder = String(ph ?? '');
          this.applyElementOpts(el, m);
        }
        return this.mountNode(el);
      },

      checkbox: (label: unknown = '', checked: unknown = false, opts?: unknown) =>
        this.createWrappedChoice('checkbox', String(label ?? ''), checked, opts),

      radio: (label: unknown = '', name: unknown = 'group', value?: unknown, opts?: unknown) =>
        this.createWrappedChoice('radio', String(label ?? ''), String(name ?? 'group'), value, opts),

      video: (src: unknown = '', opts?: unknown) => {
        const el = this.makeElement('video');
        el.src =
          typeof src === 'object' && src !== null
            ? String((src as Record<string, unknown>).src ?? '')
            : String(src ?? '');
        el.setAttr('controls', true);
        this.applyElementOpts(el, typeof src === 'object' ? src : opts);
        return this.mountNode(el);
      },

      audio: (src: unknown = '', opts?: unknown) => {
        const el = this.makeElement('audio');
        el.src =
          typeof src === 'object' && src !== null
            ? String((src as Record<string, unknown>).src ?? '')
            : String(src ?? '');
        el.setAttr('controls', true);
        this.applyElementOpts(el, typeof src === 'object' ? src : opts);
        return this.mountNode(el);
      },

      select: (options: unknown[] = [], opts?: unknown) => {
        const el = this.makeElement('select');
        this.applyElementOpts(el, opts);
        this.mountNode(el);
        if (Array.isArray(options)) {
          for (let i = 0; i < options.length; i++) {
            const raw = options[i];
            const optLabel =
              typeof raw === 'object' && raw !== null
                ? String((raw as Record<string, unknown>).label ?? (raw as Record<string, unknown>).text ?? (raw as Record<string, unknown>).value ?? '')
                : String(raw);
            const optVal =
              typeof raw === 'object' && raw !== null
                ? String((raw as Record<string, unknown>).value ?? optLabel)
                : optLabel;
            const optEl = this.makeElement('option', optLabel);
            optEl.value = optVal;
            if (i === 0) el.value = optVal;
            el.append(optEl);
          }
        }
        return el;
      },

      option: (label: unknown = '', value?: unknown, selectParent?: unknown) => {
        const el = this.makeElement('option', label);
        el.value = value !== undefined ? String(value) : String(label ?? '');
        if (selectParent && typeof selectParent === 'object' && (selectParent as GuiNodeHandle).__isGuiElement) {
          (selectParent as GuiNodeHandle).append(el);
          return el;
        }
        return this.mountNode(el);
      },

      section: (a?: unknown, b?: unknown, c?: unknown) => runTagContainer('section', a, b, c),

      container: (a?: unknown, b?: unknown, c?: unknown) => runTagContainer('div', a, b, c),

      row: async (a?: unknown, b?: unknown, c?: unknown) => {
        const el = await runTagContainer('div', a, b, c);
        el.setStyle({ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center', flexWrap: 'wrap' });
        return el;
      },

      column: async (a?: unknown, b?: unknown, c?: unknown) => {
        const el = await runTagContainer('div', a, b, c);
        el.setStyle({ display: 'flex', flexDirection: 'column', gap: '12px' });
        return el;
      },

      grid: async (colsOrId: unknown = 2, optsOrBuilder?: unknown, maybeBuilder?: unknown, fourthBuilder?: unknown) => {
        let customId: string | undefined;
        let colsArg = colsOrId;
        let a2 = optsOrBuilder;
        let a3 = maybeBuilder;
        if (typeof colsOrId === 'string') {
          customId = this.normalizeDomId(colsOrId);
          colsArg = optsOrBuilder ?? 2;
          a2 = maybeBuilder;
          a3 = fourthBuilder;
        }
        const columns = typeof colsArg === 'number' ? colsArg : 2;
        const firstOpt = this.isCallable(colsArg) ? colsArg : a2;
        const secondOpt = this.isCallable(colsArg) ? undefined : a3;
        const el = await runTagContainer('div', customId ?? firstOpt, customId ? firstOpt : secondOpt, customId ? secondOpt : undefined);
        el.setStyle({ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '12px' });
        return el;
      },

      form: (a?: unknown, b?: unknown, c?: unknown) => runTagContainer('form', a, b, c),

      line: (opts?: unknown) => {
        const el = this.makeElement('hr');
        if (typeof opts === 'string') {
          el.id = this.normalizeDomId(opts);
        } else {
          this.applyElementOpts(el, opts);
        }
        return this.mountNode(el);
      },

      mount: async (parentOrId: unknown, childOrBuilder: unknown) => {
        const target =
          typeof parentOrId === 'string'
            ? this.findElementById(parentOrId)
            : (parentOrId as GuiNodeHandle | null);
        if (target && typeof target === 'object' && target.__isGuiElement) {
          if (this.isCallable(childOrBuilder)) {
            return target.mount(childOrBuilder);
          }
          if (
            childOrBuilder &&
            typeof childOrBuilder === 'object' &&
            (childOrBuilder as GuiNodeHandle).__isGuiElement
          ) {
            target.append(childOrBuilder);
            return childOrBuilder;
          }
        }
        return childOrBuilder;
      },

      onClick: (el: unknown, fn: unknown) => attachEvent(el, 'click', fn),
      onInput: (el: unknown, fn: unknown) => attachEvent(el, 'input', fn),
      onChange: (el: unknown, fn: unknown) => attachEvent(el, 'change', fn),
      onSubmit: (el: unknown, fn: unknown) => attachEvent(el, 'submit', fn),
      click: async (elOrId: unknown) => {
        const el =
          typeof elOrId === 'string'
            ? this.findElementById(elOrId)
            : (elOrId as GuiNodeHandle | null);
        if (el && typeof el === 'object' && el.__isGuiElement) {
          return el.click();
        }
        return elOrId;
      },
      on: attachEvent,
    };

    return ns;
  }
}
