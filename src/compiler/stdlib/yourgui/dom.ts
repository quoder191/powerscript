/**
 * yourgui DOM Runtime (Standalone Native DOM + IDE Live Virtual DOM Bridge)
 * Uses document.createElement() directly in real browsers, and maintains an
 * interactive virtual DOM snapshot with bidirectional event dispatch in the IDE.
 */
export const YOURGUI_DOM_SOURCE = `
  const createYourGuiRuntime = () => {
    const pageId = "yg_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
    const styles = [];
    const rootNodes = [];
    const nodeRegistry = new Map();
    const idRegistry = new Map();
    const mountStack = [];
    let pageTitle = "EasyJS YourGUI App";
    let nextId = 1;
    let scheduleFlush = false;
    let dirty = false;

    const normalizeDomId = (raw) => String(raw ?? "").trim().replace(/^#/, "");
    const isHashIdArg = (v) => typeof v === "string" && v.startsWith("#") && v.length > 1;
    const findElementById = (rawId) => {
      const clean = normalizeDomId(rawId);
      if (!clean) return null;
      if (idRegistry.has(clean)) return idRegistry.get(clean);
      for (const node of nodeRegistry.values()) {
        if (node.id === clean || node.__guiId === clean) return node;
      }
      return null;
    };

    const useNativeDom = typeof document !== "undefined" && !ioHandler;

    const buildSnapshot = () => ({
      kind: "yourgui",
      pageId,
      title: pageTitle,
      styles: [...styles],
      nodes: rootNodes.map((n) => n._toSnapshot()),
    });

    const emitSnapshot = () => {
      if (useNativeDom) return;
      dirty = false;
      scheduleFlush = false;
      const snap = buildSnapshot();
      const idx = visualOutputs.findIndex((v) => v && v.kind === "yourgui" && v.pageId === pageId);
      if (idx === -1) {
        visualOutputs.push(snap);
      } else {
        visualOutputs[idx] = snap;
      }
      if (ioHandler && typeof ioHandler.onVisual === "function") {
        ioHandler.onVisual(snap);
      }
    };

    const requestEmit = () => {
      if (useNativeDom) return;
      dirty = true;
      if (scheduleFlush) return;
      scheduleFlush = true;
      queueMicrotask(() => {
        if (dirty) {
          emitSnapshot();
        } else {
          scheduleFlush = false;
        }
      });
    };

    const flush = () => {
      if (useNativeDom) return;
      if (dirty || rootNodes.length > 0 || styles.length > 0) {
        emitSnapshot();
      }
    };

    const makeGuiElement = (tag, textValue = undefined) => {
      const id = "el_" + (nextId++);
      const attrs = {};
      const styleObj = {};
      const listeners = new Map();
      const children = [];
      const textHistory = [];
      let parentNode = null;
      let textContent = textValue !== undefined ? formatVal(textValue) : "";
      let htmlContent = undefined;
      let prevDisplay = "";
      let customId = "";
      let domEl = useNativeDom ? document.createElement(tag) : null;
      if (domEl && textContent) domEl.textContent = textContent;

      const __GuiProxy = typeof __ejs_host_Proxy === "function" ? __ejs_host_Proxy : (typeof Proxy === "function" ? Proxy : null);
      const styleProxy = __GuiProxy ? new __GuiProxy(styleObj, {
        set(target, prop, val) {
          const key = String(prop);
          target[key] = val === null || val === undefined ? "" : String(val);
          if (domEl) domEl.style[key] = target[key];
          requestEmit();
          return true;
        },
        get(target, prop) {
          return target[String(prop)];
        },
      }) : styleObj;

      const getClasses = () => String(attrs.class ?? "").split(/\\s+/).filter(Boolean);

      const handle = {
        __isGuiElement: true,
        __guiId: id,
        __tag: tag,
        __dom: domEl,
        style: styleProxy,

        get id() { return attrs.id ?? ""; },
        set id(v) {
          if (customId && idRegistry.get(customId) === handle) {
            idRegistry.delete(customId);
          }
          const clean = String(v ?? "").trim().replace(/^#/, "");
          customId = clean;
          if (clean) {
            attrs.id = clean;
            idRegistry.set(clean, handle);
            if (domEl) domEl.id = clean;
          } else {
            delete attrs.id;
            if (domEl) domEl.removeAttribute("id");
          }
          requestEmit();
        },

        get className() { return attrs.class ?? ""; },
        set className(v) {
          attrs.class = String(v);
          if (domEl) domEl.className = attrs.class;
          requestEmit();
        },

        get textContent() { return textContent; },
        set textContent(v) {
          htmlContent = undefined;
          textContent = v === null || v === undefined ? "" : formatVal(v);
          if (domEl) domEl.textContent = textContent;
          requestEmit();
        },

        get text() { return textContent; },
        set text(v) { handle.textContent = v; },

        get innerText() { return textContent; },
        set innerText(v) { handle.textContent = v; },

        get innertext() { return textContent; },
        set innertext(v) { handle.textContent = v; },

        get innerHTML() { return htmlContent !== undefined ? htmlContent : textContent; },
        set innerHTML(v) {
          for (const c of children) c._setParent(null);
          children.length = 0;
          const s = v === null || v === undefined ? "" : String(v);
          htmlContent = s;
          textContent = s.replace(/<[^>]*>/g, "");
          if (domEl) domEl.innerHTML = s;
          requestEmit();
        },

        get innerhtml() { return handle.innerHTML; },
        set innerhtml(v) { handle.innerHTML = v; },

        get value() { return domEl && "value" in domEl ? domEl.value : (attrs.value ?? ""); },
        set value(v) {
          const next = v === null || v === undefined ? "" : String(v);
          attrs.value = next;
          if (domEl && "value" in domEl) domEl.value = next;
          requestEmit();
        },

        get checked() { return domEl && "checked" in domEl ? Boolean(domEl.checked) : Boolean(attrs.checked); },
        set checked(v) {
          const next = Boolean(v);
          attrs.checked = next;
          if (domEl && "checked" in domEl) domEl.checked = next;
          requestEmit();
        },

        get placeholder() { return String(attrs.placeholder ?? ""); },
        set placeholder(v) {
          attrs.placeholder = String(v ?? "");
          if (domEl && "placeholder" in domEl) domEl.placeholder = attrs.placeholder;
          requestEmit();
        },

        get href() { return String(attrs.href ?? ""); },
        set href(v) {
          attrs.href = String(v ?? "#");
          if (domEl && "href" in domEl) domEl.href = attrs.href;
          requestEmit();
        },

        get src() { return String(attrs.src ?? ""); },
        set src(v) {
          attrs.src = String(v ?? "");
          if (domEl && "src" in domEl) domEl.src = attrs.src;
          requestEmit();
        },

        get alt() { return String(attrs.alt ?? ""); },
        set alt(v) {
          attrs.alt = String(v ?? "");
          if (domEl && "alt" in domEl) domEl.alt = attrs.alt;
          requestEmit();
        },

        get type() { return String(attrs.type ?? ""); },
        set type(v) {
          attrs.type = String(v ?? "");
          if (domEl && "type" in domEl) domEl.type = attrs.type;
          requestEmit();
        },

        get disabled() { return Boolean(attrs.disabled); },
        set disabled(v) {
          if (Boolean(v)) attrs.disabled = true;
          else delete attrs.disabled;
          if (domEl && "disabled" in domEl) domEl.disabled = Boolean(v);
          requestEmit();
        },

        get onclick() { return listeners.get("click")?.[0] ?? null; },
        set onclick(fn) {
          listeners.set("click", typeof fn === "function" ? [fn] : []);
          if (domEl) domEl.onclick = typeof fn === "function" ? (e) => fn(e) : null;
        },

        get oninput() { return listeners.get("input")?.[0] ?? null; },
        set oninput(fn) {
          listeners.set("input", typeof fn === "function" ? [fn] : []);
          if (domEl) domEl.oninput = typeof fn === "function" ? (e) => fn(e) : null;
        },

        get onchange() { return listeners.get("change")?.[0] ?? null; },
        set onchange(fn) {
          listeners.set("change", typeof fn === "function" ? [fn] : []);
          if (domEl) domEl.onchange = typeof fn === "function" ? (e) => fn(e) : null;
        },

        get onsubmit() { return listeners.get("submit")?.[0] ?? null; },
        set onsubmit(fn) {
          listeners.set("submit", typeof fn === "function" ? [fn] : []);
          if (domEl) {
            domEl.onsubmit = typeof fn === "function" ? (e) => { e.preventDefault?.(); fn(e); } : null;
          }
        },

        addEventListener(eventType, fn) {
          if (typeof fn !== "function") return handle;
          const ev = String(eventType).toLowerCase().replace(/^on/, "");
          const list = listeners.get(ev) || [];
          list.push(fn);
          listeners.set(ev, list);
          if (domEl) {
            domEl.addEventListener(ev, (e) => {
              if (ev === "submit") e.preventDefault?.();
              return fn(e);
            });
          }
          return handle;
        },

        on(eventType, fn) {
          return handle.addEventListener(eventType, fn);
        },

        onClick(fn) { return handle.addEventListener("click", fn); },
        onInput(fn) { return handle.addEventListener("input", fn); },
        onChange(fn) { return handle.addEventListener("change", fn); },
        onSubmit(fn) { return handle.addEventListener("submit", fn); },

        click() {
          if (attrs.disabled) return handle;
          if (domEl && typeof domEl.click === "function") {
            domEl.click();
            return handle;
          }
          const handlers = [...(listeners.get("click") || [])];
          const eventObj = {
            type: "click",
            target: handle,
            value: handle.value,
            checked: handle.checked,
          };
          let pending = null;
          for (const fn of handlers) {
            const res = fn(eventObj);
            if (res && typeof res.then === "function") {
              pending = pending ? pending.then(() => res) : res;
            }
          }
          emitSnapshot();
          if (pending) {
            return pending.then(() => {
              emitSnapshot();
              return handle;
            });
          }
          return handle;
        },

        setText(v) {
          handle.textContent = v;
          return handle;
        },

        getText() {
          return textContent;
        },

        setStyle(styleMap) {
          if (styleMap && typeof styleMap === "object") {
            for (const [k, v] of Object.entries(styleMap)) {
              styleObj[k] = v === null || v === undefined ? "" : String(v);
              if (domEl) domEl.style[k] = styleObj[k];
            }
            requestEmit();
          }
          return handle;
        },

        setColor(fg, bg = undefined) {
          if (fg !== undefined && fg !== null) {
            styleObj.color = String(fg);
            if (domEl) domEl.style.color = styleObj.color;
          }
          if (bg !== undefined && bg !== null) {
            styleObj.backgroundColor = String(bg);
            if (domEl) domEl.style.backgroundColor = styleObj.backgroundColor;
          }
          requestEmit();
          return handle;
        },

        setBg(bg) {
          styleObj.backgroundColor = bg === null || bg === undefined ? "" : String(bg);
          if (domEl) domEl.style.backgroundColor = styleObj.backgroundColor;
          requestEmit();
          return handle;
        },

        setAttr(k, v) {
          const key = String(k);
          if (v === false || v === null || v === undefined) {
            delete attrs[key];
            if (domEl) domEl.removeAttribute(key);
          } else {
            attrs[key] = v === true ? true : String(v);
            if (domEl) domEl.setAttribute(key, v === true ? "" : String(v));
          }
          requestEmit();
          return handle;
        },

        getAttr(k) {
          return attrs[String(k)] ?? null;
        },

        disable() {
          handle.disabled = true;
          return handle;
        },

        enable() {
          handle.disabled = false;
          return handle;
        },

        setDisabled(flag) {
          handle.disabled = Boolean(flag);
          return handle;
        },

        hide() {
          if (styleObj.display !== "none") {
            prevDisplay = styleObj.display ?? "";
          }
          styleObj.display = "none";
          if (domEl) domEl.style.display = "none";
          requestEmit();
          return handle;
        },

        show() {
          if (styleObj.display === "none") {
            if (prevDisplay) {
              styleObj.display = prevDisplay;
              if (domEl) domEl.style.display = prevDisplay;
            } else {
              delete styleObj.display;
              if (domEl) domEl.style.display = "";
            }
            requestEmit();
          }
          return handle;
        },

        toggle() {
          return styleObj.display === "none" ? handle.show() : handle.hide();
        },

        addClass(cls) {
          const parts = String(cls ?? "").split(/\\s+/).filter(Boolean);
          const set = new Set(getClasses());
          for (const c of parts) set.add(c);
          attrs.class = Array.from(set).join(" ");
          if (domEl) domEl.className = attrs.class;
          requestEmit();
          return handle;
        },

        removeClass(cls) {
          const toRemove = new Set(String(cls ?? "").split(/\\s+/).filter(Boolean));
          const next = getClasses().filter((c) => !toRemove.has(c));
          if (next.length > 0) attrs.class = next.join(" ");
          else delete attrs.class;
          if (domEl) domEl.className = attrs.class ?? "";
          requestEmit();
          return handle;
        },

        toggleClass(cls) {
          const parts = String(cls ?? "").split(/\\s+/).filter(Boolean);
          const set = new Set(getClasses());
          for (const c of parts) {
            if (set.has(c)) set.delete(c);
            else set.add(c);
          }
          if (set.size > 0) attrs.class = Array.from(set).join(" ");
          else delete attrs.class;
          if (domEl) domEl.className = attrs.class ?? "";
          requestEmit();
          return handle;
        },

        append(...items) {
          for (const item of items) {
            if (!item || !item.__isGuiElement) continue;
            item._detach();
            item._setParent(handle);
            children.push(item);
            if (domEl && item.__dom) domEl.appendChild(item.__dom);
          }
          requestEmit();
          return handle;
        },

        add(...items) {
          return handle.append(...items);
        },

        appendChild(item) {
          handle.append(item);
          return item;
        },

        push(...items) {
          for (const item of items) {
            if (item && typeof item === "object" && item.__isGuiElement) {
              item._detach();
              item._setParent(handle);
              children.push(item);
              if (domEl && item.__dom) domEl.appendChild(item.__dom);
            } else {
              textHistory.push(textContent);
              htmlContent = undefined;
              textContent = item === null || item === undefined ? "" : formatVal(item);
              if (domEl) domEl.textContent = textContent;
            }
          }
          requestEmit();
          return children.length > 0 ? children.length : textHistory.length;
        },

        pop() {
          if (textHistory.length > 0) {
            const popped = textContent;
            htmlContent = undefined;
            textContent = textHistory.pop();
            if (domEl) domEl.textContent = textContent;
            requestEmit();
            return popped;
          }
          if (children.length > 0) {
            const last = children.pop();
            last._setParent(null);
            if (domEl && last.__dom && last.__dom.parentNode === domEl) {
              domEl.removeChild(last.__dom);
            }
            requestEmit();
            return last;
          }
          return null;
        },

        peek() {
          if (children.length > 0) return children[children.length - 1];
          return textContent;
        },

        count() { return children.length > 0 ? children.length : textHistory.length; },
        len() { return children.length > 0 ? children.length : textHistory.length; },
        size() { return children.length > 0 ? children.length : textHistory.length; },

        clear() {
          for (const c of children) c._setParent(null);
          children.length = 0;
          textHistory.length = 0;
          htmlContent = undefined;
          if (domEl) domEl.innerHTML = "";
          requestEmit();
          return handle;
        },

        remove() {
          handle._detach();
          if (customId && idRegistry.get(customId) === handle) {
            idRegistry.delete(customId);
          }
          if (domEl && domEl.parentNode) domEl.parentNode.removeChild(domEl);
          requestEmit();
          return handle;
        },

        render(builderOrContent) {
          handle.clear();
          if (typeof builderOrContent === "function") {
            mountStack.push(handle);
            try {
              const maybePromise = builderOrContent(handle);
              if (maybePromise && typeof maybePromise.then === "function") {
                return maybePromise.then(() => {
                  if (mountStack[mountStack.length - 1] === handle) mountStack.pop();
                  requestEmit();
                  return handle;
                });
              }
            } finally {
              if (mountStack[mountStack.length - 1] === handle) mountStack.pop();
            }
          } else if (builderOrContent && typeof builderOrContent === "object" && builderOrContent.__isGuiElement) {
            handle.append(builderOrContent);
          } else if (builderOrContent !== undefined && builderOrContent !== null) {
            handle.textContent = formatVal(builderOrContent);
          }
          requestEmit();
          return handle;
        },

        mount(childOrBuilder) {
          if (typeof childOrBuilder === "function") {
            mountStack.push(handle);
            try {
              const maybePromise = childOrBuilder(handle);
              if (maybePromise && typeof maybePromise.then === "function") {
                return maybePromise.then(() => {
                  if (mountStack[mountStack.length - 1] === handle) mountStack.pop();
                  requestEmit();
                  return handle;
                });
              }
            } finally {
              if (mountStack[mountStack.length - 1] === handle) mountStack.pop();
            }
          } else if (childOrBuilder && typeof childOrBuilder === "object" && childOrBuilder.__isGuiElement) {
            handle.append(childOrBuilder);
          }
          requestEmit();
          return handle;
        },

        toString() {
          return "<" + tag + "#" + (customId || id) + ">";
        },

        _detach() {
          if (parentNode) {
            parentNode._removeChildRef(handle);
            parentNode = null;
          } else {
            const idx = rootNodes.indexOf(handle);
            if (idx !== -1) rootNodes.splice(idx, 1);
          }
        },

        _setParent(p) {
          parentNode = p;
        },

        _removeChildRef(c) {
          const idx = children.indexOf(c);
          if (idx !== -1) children.splice(idx, 1);
        },

        _getListeners(ev) {
          return listeners.get(ev) || [];
        },

        _syncFromBrowser(payload) {
          if (!payload || typeof payload !== "object") return;
          if (payload.value !== undefined) attrs.value = String(payload.value);
          if (payload.checked !== undefined) {
            const nextChecked = Boolean(payload.checked);
            attrs.checked = nextChecked;
            if (tag === "input" && attrs.type === "radio" && attrs.name && nextChecked) {
              for (const other of nodeRegistry.values()) {
                if (other !== handle && other.__tag === "input" && other.getAttr("type") === "radio" && other.getAttr("name") === attrs.name) {
                  other._setRadioCheckedQuiet(false);
                }
              }
            }
          }
        },

        _setRadioCheckedQuiet(val) {
          attrs.checked = val;
        },

        _toSnapshot() {
          return {
            id,
            tag,
            textContent: children.length === 0 ? textContent : undefined,
            html: children.length === 0 ? htmlContent : undefined,
            attrs: { ...attrs },
            style: { ...styleObj },
            children: children.map((c) => c._toSnapshot()),
          };
        },
      };

      nodeRegistry.set(id, handle);
      return handle;
    };

    const mountNode = (node) => {
      if (mountStack.length > 0) {
        mountStack[mountStack.length - 1].append(node);
      } else {
        rootNodes.push(node);
        if (useNativeDom && document.body && node.__dom) {
          document.body.appendChild(node.__dom);
        }
        requestEmit();
      }
      return node;
    };

    const createWrappedChoice = (inputType, label = "", checkedOrName = false, valOrOpts = undefined, maybeOpts = undefined) => {
      const inputEl = makeGuiElement("input");
      inputEl.type = inputType;
      if (inputType === "checkbox") {
        if (typeof checkedOrName === "object" && checkedOrName !== null) {
          applyElementOpts(inputEl, checkedOrName);
        } else {
          inputEl.checked = Boolean(checkedOrName);
          applyElementOpts(inputEl, valOrOpts);
        }
      } else {
        const groupName = typeof checkedOrName === "string" && checkedOrName ? checkedOrName : "radio_group";
        inputEl.setAttr("name", groupName);
        inputEl.value = typeof valOrOpts === "string" ? valOrOpts : String(label ?? "");
        if (typeof valOrOpts === "object" && valOrOpts !== null) applyElementOpts(inputEl, valOrOpts);
        else applyElementOpts(inputEl, maybeOpts);
      }

      if (!label) {
        return mountNode(inputEl);
      }

      const wrapper = makeGuiElement("label");
      wrapper.setStyle({ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" });
      const textSpan = makeGuiElement("span", String(label));
      wrapper.append(inputEl);
      wrapper.append(textSpan);
      mountNode(wrapper);
      requestEmit();
      return inputEl;
    };

    const dispatchEvent = async (elementId, eventType, payload = {}) => {
      const target = nodeRegistry.get(String(elementId));
      if (!target) return;
      target._syncFromBrowser(payload);
      const ev = String(eventType).toLowerCase();
      if (ev === "click" && target.disabled) return;
      const handlers = [...target._getListeners(ev)];
      const eventObj = {
        type: ev,
        target,
        value: target.value,
        checked: target.checked,
      };
      for (const fn of handlers) {
        await fn(eventObj);
      }
      emitSnapshot();
    };

    if (ioHandler && typeof ioHandler.registerGuiDispatcher === "function") {
      ioHandler.registerGuiDispatcher(dispatchEvent);
    }

    const normalizeSectionArgs = (a, b, c) => {
      let customId = undefined;
      let opts = undefined;
      let builder = undefined;
      if (typeof a === "string") {
        customId = normalizeDomId(a);
        if (typeof b === "function") {
          builder = b;
        } else {
          opts = b;
          if (typeof c === "function") builder = c;
        }
      } else if (typeof a === "function") {
        builder = a;
      } else {
        opts = a;
        if (typeof b === "function") builder = b;
      }
      return { customId, opts, builder };
    };

    const runTagContainer = (tag, a, b, c) => {
      const { customId, opts, builder } = normalizeSectionArgs(a, b, c);
      const el = makeGuiElement(tag);
      if (customId) el.id = customId;
      applyElementOpts(el, opts);
      mountNode(el);
      if (builder) {
        mountStack.push(el);
        try {
          const maybePromise = builder(el);
          if (maybePromise && typeof maybePromise.then === "function") {
            return maybePromise.then(() => {
              if (mountStack[mountStack.length - 1] === el) mountStack.pop();
              requestEmit();
              return el;
            });
          }
        } finally {
          if (mountStack[mountStack.length - 1] === el) mountStack.pop();
        }
        requestEmit();
      }
      return el;
    };

    const yourgui = Object.freeze({
      css: (cssText) => injectYourGuiCss(cssText, styles, requestEmit),
      style: (cssText) => injectYourGuiCss(cssText, styles, requestEmit),
      title: (t) => {
        pageTitle = formatVal(t);
        if (useNativeDom && typeof document !== "undefined") document.title = pageTitle;
        requestEmit();
        return pageTitle;
      },
      flush,
      clear: () => {
        rootNodes.length = 0;
        styles.length = 0;
        idRegistry.clear();
        if (useNativeDom && document.body) document.body.innerHTML = "";
        emitSnapshot();
        return true;
      },

      dom: (id) => findElementById(id),
      byId: (id) => findElementById(id),
      getById: (id) => findElementById(id),
      selectId: (id) => findElementById(id),
      render: (targetOrId, builderOrContent) => {
        const target = typeof targetOrId === "string" ? findElementById(targetOrId) : targetOrId;
        if (target && target.__isGuiElement) {
          return target.render(builderOrContent);
        }
        return null;
      },

      button: (value = "Button", onClickOrOpts = undefined, maybeOpts = undefined, fourthArg = undefined) => {
        let customId = undefined;
        let textVal = value;
        let a2 = onClickOrOpts;
        let a3 = maybeOpts;
        if (isHashIdArg(value) && onClickOrOpts !== undefined) {
          customId = normalizeDomId(value);
          textVal = onClickOrOpts;
          a2 = maybeOpts;
          a3 = fourthArg;
        }
        let el;
        if (typeof textVal === "object" && textVal !== null && !Array.isArray(textVal) && !textVal.__isGuiElement) {
          const initialText = textVal.text ?? textVal.innerText ?? textVal.innertext ?? textVal.textContent ?? "Button";
          el = makeGuiElement("button", initialText);
          if (customId) el.id = customId;
          applyElementOpts(el, textVal);
          if (typeof a2 === "function") el.onclick = a2;
        } else {
          el = makeGuiElement("button", textVal);
          if (customId) el.id = customId;
          if (typeof a2 === "function") {
            el.onclick = a2;
            if (a3) applyElementOpts(el, a3);
          } else {
            applyElementOpts(el, a2);
            if (typeof a3 === "function") el.onclick = a3;
          }
        }
        return mountNode(el);
      },

      input: (placeholderOrOpts = "", typeOrOpts = "text", thirdArg = undefined) => {
        let customId = undefined;
        let ph = placeholderOrOpts;
        let tp = typeOrOpts;
        if (isHashIdArg(placeholderOrOpts) && typeOrOpts !== undefined) {
          customId = normalizeDomId(placeholderOrOpts);
          ph = typeOrOpts;
          tp = thirdArg ?? "text";
        }
        const el = makeGuiElement("input");
        if (customId) el.id = customId;
        if (typeof ph === "object" && ph !== null && !Array.isArray(ph)) {
          el.type = ph.type ? String(ph.type) : "text";
          applyElementOpts(el, ph);
        } else {
          el.placeholder = String(ph ?? "");
          if (typeof tp === "string") {
            el.type = tp;
          } else {
            el.type = "text";
            applyElementOpts(el, tp);
          }
        }
        return mountNode(el);
      },

      text: (value = "", opts = undefined, thirdArg = undefined) => {
        let customId = undefined;
        let val = value;
        let resolvedOpts = opts;
        if (isHashIdArg(value) && opts !== undefined) {
          customId = normalizeDomId(value);
          val = opts;
          resolvedOpts = thirdArg;
        }
        const el = makeGuiElement("p", val);
        if (customId) el.id = customId;
        applyElementOpts(el, resolvedOpts);
        return mountNode(el);
      },

      heading: (value = "", levelOrOpts = 1, thirdArg = undefined) => {
        let customId = undefined;
        let val = value;
        let lvlArg = levelOrOpts;
        if (isHashIdArg(value) && levelOrOpts !== undefined) {
          customId = normalizeDomId(value);
          val = levelOrOpts;
          lvlArg = thirdArg ?? 1;
        }
        let level = 1;
        let opts = undefined;
        if (typeof lvlArg === "number") {
          level = Math.min(6, Math.max(1, Math.trunc(lvlArg)));
        } else if (typeof lvlArg === "object" && lvlArg !== null) {
          opts = lvlArg;
          if (typeof lvlArg.level === "number") {
            level = Math.min(6, Math.max(1, Math.trunc(lvlArg.level)));
          }
        }
        const el = makeGuiElement("h" + level, val);
        if (customId) el.id = customId;
        applyElementOpts(el, opts);
        return mountNode(el);
      },

      image: (src = "", altOrOpts = "", maybeOpts = undefined) => {
        let customId = undefined;
        let s = src;
        let a = altOrOpts;
        let m = maybeOpts;
        if (isHashIdArg(src) && altOrOpts !== undefined) {
          customId = normalizeDomId(src);
          s = altOrOpts;
          a = maybeOpts ?? "";
          m = undefined;
        }
        const el = makeGuiElement("img");
        if (customId) el.id = customId;
        if (typeof s === "object" && s !== null) {
          applyElementOpts(el, s);
        } else {
          el.src = String(s ?? "");
          if (typeof a === "string") {
            el.alt = a;
            applyElementOpts(el, m);
          } else {
            applyElementOpts(el, a);
          }
        }
        return mountNode(el);
      },

      link: (label = "", hrefOrOpts = "#", maybeOpts = undefined) => {
        let customId = undefined;
        let lbl = label;
        let h = hrefOrOpts;
        let m = maybeOpts;
        if (isHashIdArg(label) && hrefOrOpts !== undefined) {
          customId = normalizeDomId(label);
          lbl = hrefOrOpts;
          h = maybeOpts ?? "#";
          m = undefined;
        }
        const el = makeGuiElement("a", lbl);
        if (customId) el.id = customId;
        if (typeof h === "string") {
          el.href = h;
          applyElementOpts(el, m);
        } else {
          el.href = "#";
          applyElementOpts(el, h);
        }
        el.setAttr("target", "_blank");
        el.setAttr("rel", "noopener noreferrer");
        return mountNode(el);
      },

      textarea: (placeholderOrOpts = "", maybeOpts = undefined) => {
        let customId = undefined;
        let ph = placeholderOrOpts;
        let m = maybeOpts;
        if (isHashIdArg(placeholderOrOpts) && maybeOpts !== undefined) {
          customId = normalizeDomId(placeholderOrOpts);
          ph = maybeOpts;
          m = undefined;
        }
        const el = makeGuiElement("textarea");
        if (customId) el.id = customId;
        if (typeof ph === "object" && ph !== null) {
          applyElementOpts(el, ph);
        } else {
          el.placeholder = String(ph ?? "");
          applyElementOpts(el, m);
        }
        return mountNode(el);
      },

      checkbox: (label = "", checked = false, opts = undefined) =>
        createWrappedChoice("checkbox", label, checked, opts),

      radio: (label = "", name = "group", value = undefined, opts = undefined) =>
        createWrappedChoice("radio", label, name, value, opts),

      video: (src = "", opts = undefined) => {
        const el = makeGuiElement("video");
        el.src = typeof src === "object" && src !== null ? String(src.src ?? "") : String(src ?? "");
        el.setAttr("controls", true);
        applyElementOpts(el, typeof src === "object" ? src : opts);
        return mountNode(el);
      },

      audio: (src = "", opts = undefined) => {
        const el = makeGuiElement("audio");
        el.src = typeof src === "object" && src !== null ? String(src.src ?? "") : String(src ?? "");
        el.setAttr("controls", true);
        applyElementOpts(el, typeof src === "object" ? src : opts);
        return mountNode(el);
      },

      select: (options = [], opts = undefined) => {
        const el = makeGuiElement("select");
        applyElementOpts(el, opts);
        mountNode(el);
        if (Array.isArray(options)) {
          for (let i = 0; i < options.length; i++) {
            const raw = options[i];
            const optLabel = typeof raw === "object" && raw !== null ? String(raw.label ?? raw.text ?? raw.value ?? "") : String(raw);
            const optVal = typeof raw === "object" && raw !== null ? String(raw.value ?? optLabel) : optLabel;
            const optEl = makeGuiElement("option", optLabel);
            optEl.value = optVal;
            if (i === 0) el.value = optVal;
            el.append(optEl);
          }
        }
        return el;
      },

      option: (label = "", value = undefined, selectParent = undefined) => {
        const el = makeGuiElement("option", label);
        el.value = value !== undefined ? String(value) : String(label ?? "");
        if (selectParent && selectParent.__isGuiElement) {
          selectParent.append(el);
          return el;
        }
        return mountNode(el);
      },

      section: (a = undefined, b = undefined, c = undefined) => runTagContainer("section", a, b, c),

      container: (a = undefined, b = undefined, c = undefined) => runTagContainer("div", a, b, c),

      row: (a = undefined, b = undefined, c = undefined) => {
        const applyRowStyle = (el) => {
          if (el && typeof el.setStyle === "function") {
            el.setStyle({ display: "flex", flexDirection: "row", gap: "12px", alignItems: "center", flexWrap: "wrap" });
          }
          return el;
        };
        const res = runTagContainer("div", a, b, c);
        return res && typeof res.then === "function" ? res.then(applyRowStyle) : applyRowStyle(res);
      },

      column: (a = undefined, b = undefined, c = undefined) => {
        const applyColStyle = (el) => {
          if (el && typeof el.setStyle === "function") {
            el.setStyle({ display: "flex", flexDirection: "column", gap: "12px" });
          }
          return el;
        };
        const res = runTagContainer("div", a, b, c);
        return res && typeof res.then === "function" ? res.then(applyColStyle) : applyColStyle(res);
      },

      grid: (colsOrId = 2, optsOrBuilder = undefined, maybeBuilder = undefined, fourthBuilder = undefined) => {
        let customId = undefined;
        let colsArg = colsOrId;
        let a2 = optsOrBuilder;
        let a3 = maybeBuilder;
        if (typeof colsOrId === "string") {
          customId = normalizeDomId(colsOrId);
          colsArg = optsOrBuilder ?? 2;
          a2 = maybeBuilder;
          a3 = fourthBuilder;
        }
        const columns = typeof colsArg === "number" ? colsArg : 2;
        const firstOpt = typeof colsArg === "function" ? colsArg : a2;
        const secondOpt = typeof colsArg === "function" ? undefined : a3;
        const applyGridStyle = (el) => {
          if (el && typeof el.setStyle === "function") {
            el.setStyle({ display: "grid", gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))", gap: "12px" });
          }
          return el;
        };
        const res = runTagContainer("div", customId ?? firstOpt, customId ? firstOpt : secondOpt, customId ? secondOpt : undefined);
        return res && typeof res.then === "function" ? res.then(applyGridStyle) : applyGridStyle(res);
      },

      form: (a = undefined, b = undefined, c = undefined) => runTagContainer("form", a, b, c),

      line: (opts = undefined) => {
        const el = makeGuiElement("hr");
        if (typeof opts === "string") {
          el.id = normalizeDomId(opts);
        } else {
          applyElementOpts(el, opts);
        }
        return mountNode(el);
      },

      mount: (parentOrId, childOrBuilder) => {
        const target = typeof parentOrId === "string" ? findElementById(parentOrId) : parentOrId;
        if (target && target.__isGuiElement) {
          if (typeof childOrBuilder === "function") {
            return target.mount(childOrBuilder);
          }
          if (childOrBuilder && childOrBuilder.__isGuiElement) {
            target.append(childOrBuilder);
            return childOrBuilder;
          }
        }
        return childOrBuilder;
      },

      onClick,
      onInput,
      onChange,
      onSubmit,
      click: (elOrId) => {
        const el = typeof elOrId === "string" ? findElementById(elOrId) : elOrId;
        return el && typeof el.click === "function" ? el.click() : elOrId;
      },
      on: attachEvent,
    });

    return { yourgui, dispatchEvent };
  };

  const { yourgui: yourguiLib } = createYourGuiRuntime();
`;
