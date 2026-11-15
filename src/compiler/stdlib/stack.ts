export const STACK_LIBRARY_SOURCE = `
  const stackLib = Object.freeze({
    array: (...items) => (items.length === 1 && Array.isArray(items[0]) ? [...items[0]] : items),
    list: (count = 0, fillVal = null) => Array.from({ length: count }, (_, i) => (typeof fillVal === "function" ? fillVal(i) : fillVal)),
    dict: (a = undefined, b = undefined) => {
      if (a === undefined) return {};
      if (Array.isArray(a) && Array.isArray(b)) {
        const obj = {};
        for (let i = 0; i < Math.min(a.length, b.length); i++) obj[a[i]] = b[i];
        return obj;
      }
      if (Array.isArray(a)) {
        const obj = {};
        for (const pair of a) {
          if (Array.isArray(pair) && pair.length >= 2) obj[pair[0]] = pair[1];
        }
        return obj;
      }
      if (typeof a === "object" && a !== null) return { ...a };
      return {};
    },
    zip: (keysArr = [], valsArr = []) => {
      const obj = {};
      for (let i = 0; i < Math.min(keysArr.length, valsArr.length); i++) {
        obj[keysArr[i]] = valsArr[i];
      }
      return obj;
    },
    merge: (...dicts) => Object.assign({}, ...dicts),
    range: (start, end, step = 1) => {
      const out = [];
      if (step === 0) return out;
      if (step > 0) {
        for (let i = start; i < end; i += step) out.push(i);
      } else {
        for (let i = start; i > end; i += step) out.push(i);
      }
      return out;
    },
    lifo: (init = []) => new Stack(init),
    fifo: (init = []) => new Queue(init),
    set: (init = []) => new Set(init),
  });
`;
