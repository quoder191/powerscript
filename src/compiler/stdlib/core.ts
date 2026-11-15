export const CORE_STDLIB_SOURCE = `
  const toInt = (x) => {
    const n = typeof x === "boolean" ? (x ? 1 : 0) : Number.parseInt(String(x).trim(), 10);
    if (Number.isNaN(n)) throw new Error(\`TypeError: Cannot convert '\${x}' to int\`);
    return n;
  };

  const toFloat = (x) => {
    const n = typeof x === "boolean" ? (x ? 1 : 0) : Number.parseFloat(String(x).trim());
    if (Number.isNaN(n)) throw new Error(\`TypeError: Cannot convert '\${x}' to float\`);
    return n;
  };

  const smartSort = (arr, desc = false, cmp = null) => {
    if (typeof cmp === "function") return arr.sort(cmp);
    return arr.sort((a, b) => {
      let res = 0;
      if (typeof a === "number" && typeof b === "number") res = a - b;
      else res = String(a).localeCompare(String(b));
      return desc ? -res : res;
    });
  };

  const shuffleArray = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  const hasMember = (container, item) => {
    if (container === null || container === undefined) return false;
    if (Array.isArray(container) || typeof container === "string") return container.includes(item);
    if (container instanceof Set) return container.has(item);
    if (container instanceof Stack || container instanceof Queue) return container.contains(item);
    if (typeof container === "object") return Object.prototype.hasOwnProperty.call(container, item);
    return false;
  };

  const getLength = (x) => {
    if (x === null || x === undefined) return 0;
    if (Array.isArray(x) || typeof x === "string") return x.length;
    if (x instanceof Stack || x instanceof Queue) return x.len();
    if (x instanceof Set || x instanceof Map) return x.size;
    if (typeof x === "object") return Object.keys(x).length;
    return 0;
  };

  const randomNum = (a, b) => {
    if (a === undefined && b === undefined) return Math.random();
    if (b === undefined) return Math.floor(Math.random() * (a + 1));
    return Math.floor(Math.random() * (b - a + 1)) + a;
  };
`;
