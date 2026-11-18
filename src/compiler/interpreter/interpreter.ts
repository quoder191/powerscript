import {
  BlockStatementNode,
  ClassDeclarationNode,
  ExpressionNode,
  MatchPattern,
  ParamNode,
  ProgramNode,
  StatementNode,
  StructDeclarationNode,
} from '../ast/nodes.ts';
import {
  CallFrame,
  DebugVariable,
  ExecuteAsyncOptions,
  ExecutionResult,
  PointerRuntimeEvent,
  RegisteredRouteInfo,
  VisualOutputItem,
} from '../utils/helpers.ts';
import { YourGuiEngine } from '../stdlib/yourgui/index.ts';

class ReturnSignal {
  public readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

class BreakSignal {}
class ContinueSignal {}

class ExitSignal extends Error {
  public readonly isExitSignal = true;
  constructor(reason = 'Program exited') {
    super(reason);
    this.name = 'ExitSignal';
  }
}

interface EnvBinding {
  value: unknown;
  mutable: boolean;
  kind: string;
  getter?: () => unknown;
  setter?: (val: unknown) => void;
}

class Environment {
  public readonly values = new Map<string, EnvBinding>();
  public readonly parent: Environment | null;
  public readonly label: string;

  constructor(parent: Environment | null = null, label = 'global') {
    this.parent = parent;
    this.label = label;
  }

  public define(name: string, value: unknown, mutable = true, kind = 'variable'): void {
    this.values.set(name, { value, mutable, kind });
  }

  public defineAlias(
    name: string,
    getter: () => unknown,
    setter?: (val: unknown) => void,
    mutable = true,
    kind = 'ref_alias'
  ): void {
    this.values.set(name, { value: undefined, mutable, kind, getter, setter });
  }

  public findOwner(name: string): Environment | null {
    if (this.values.has(name)) return this;
    return this.parent ? this.parent.findOwner(name) : null;
  }

  public get(name: string): unknown {
    if (this.values.has(name)) {
      const b = this.values.get(name)!;
      return b.getter ? b.getter() : b.value;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    throw new Error(`ReferenceError: '${name}' is not defined`);
  }

  public has(name: string): boolean {
    if (this.values.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  public assign(name: string, value: unknown): void {
    if (this.values.has(name)) {
      const binding = this.values.get(name)!;
      if (!binding.mutable) {
        throw new Error(`TypeError: Cannot reassign constant '${name}'`);
      }
      if (binding.setter) {
        binding.setter(value);
      } else if (binding.getter) {
        throw new Error(`TypeError: Cannot modify const reference '${name}'`);
      } else {
        binding.value = value;
      }
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value);
      return;
    }
    this.define(name, value, true, 'variable');
  }

  public snapshotVariables(): DebugVariable[] {
    const out: DebugVariable[] = [];
    let cur: Environment | null = this;
    const seen = new Set<string>();
    while (cur && cur.parent !== null) {
      for (const [name, binding] of cur.values.entries()) {
        if (seen.has(name)) continue;
        seen.add(name);
        let rawVal: unknown = binding.value;
        try {
          if (binding.getter) rawVal = binding.getter();
        } catch {
          rawVal = '<unreadable>';
        }
        out.push({
          name,
          value: formatVal(rawVal),
          type: inferRuntimeType(rawVal),
          scope: cur.label,
        });
      }
      cur = cur.parent;
    }
    // Include user-defined globals (skip internal stdlib functions)
    if (cur) {
      for (const [name, binding] of cur.values.entries()) {
        if (binding.kind === 'stdlib' || seen.has(name)) continue;
        seen.add(name);
        let rawVal: unknown = binding.value;
        try {
          if (binding.getter) rawVal = binding.getter();
        } catch {
          rawVal = '<unreadable>';
        }
        out.push({
          name,
          value: formatVal(rawVal),
          type: inferRuntimeType(rawVal),
          scope: cur.label,
        });
      }
    }
    return out;
  }
}

interface EjsClassDef {
  __isEjsClass: true;
  name: string;
  decl: ClassDeclarationNode;
  superDef: EjsClassDef | null;
  closure: Environment;
  staticProps: Record<string, unknown>;
}

interface EjsInstance {
  __isEjsInstance: true;
  classDef: EjsClassDef;
  fields: Record<string, unknown>;
}

interface EjsStructDef {
  __isEjsStruct: true;
  name: string;
  decl: StructDeclarationNode;
  closure: Environment;
}

interface EjsCallable {
  __isEjsFn: true;
  name: string;
  params: ParamNode[];
  body: BlockStatementNode | ExpressionNode;
  closure: Environment;
  boundSelf?: unknown;
  boundSuper?: EjsClassDef | null;
}

class EjsStack {
  public _items: unknown[];
  constructor(init: unknown[] = []) {
    this._items = Array.isArray(init) ? [...init] : [];
  }
  push(v: unknown) { this._items.push(v); return this._items.length; }
  append(v: unknown) { return this.push(v); }
  pop() {
    if (!this._items.length) throw new Error('RuntimeError: Cannot pop from an empty Stack');
    return this._items.pop();
  }
  peek() { return this._items.length ? this._items[this._items.length - 1] : null; }
  top() { return this.peek(); }
  isEmpty() { return this._items.length === 0; }
  len() { return this._items.length; }
  size() { return this._items.length; }
  contains(v: unknown) { return this._items.includes(v); }
  clear() { this._items.length = 0; return this; }
  toArray() { return [...this._items]; }
  toString() { return `Stack[${this._items.map(formatVal).join(', ')}]`; }
}

class EjsQueue {
  public _items: unknown[];
  constructor(init: unknown[] = []) {
    this._items = Array.isArray(init) ? [...init] : [];
  }
  enqueue(v: unknown) { this._items.push(v); return this._items.length; }
  push(v: unknown) { return this.enqueue(v); }
  dequeue() {
    if (!this._items.length) throw new Error('RuntimeError: Cannot dequeue from an empty Queue');
    return this._items.shift();
  }
  pop() { return this.dequeue(); }
  peek() { return this._items.length ? this._items[0] : null; }
  isEmpty() { return this._items.length === 0; }
  len() { return this._items.length; }
  size() { return this._items.length; }
  contains(v: unknown) { return this._items.includes(v); }
  clear() { this._items.length = 0; return this; }
  toArray() { return [...this._items]; }
  toString() { return `Queue[${this._items.map(formatVal).join(', ')}]`; }
}

function inferRuntimeType(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof EjsStack) return 'stack';
  if (v instanceof EjsQueue) return 'queue';
  if (v instanceof Set) return 'set';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'function' || (typeof v === 'object' && (v as EjsCallable).__isEjsFn)) return 'fn';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.__ptrKind) return `ptr<${String(o.__ptrKind)}>`;
    if (o.__enumTag) return String(o.__enumName);
    if (o.__structName) return String(o.__structName);
    if (o.__isEjsInstance) return (o as unknown as EjsInstance).classDef.name;
    return 'dict';
  }
  return typeof v;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (obj.__ptrKind) {
      if (!obj.alive) return `<${obj.__ptrKind} ${obj.name}: dropped>`;
      if (obj.moved) return `<${obj.__ptrKind} ${obj.name}: moved>`;
      if (obj.__ptrKind === 'ptr') {
        const cur = typeof obj.get === 'function' ? (obj.get as () => unknown)() : obj.value;
        return `<ptr ${obj.name} @ ${obj.addr}: ${formatVal(cur)}>`;
      }
      if (obj.__ptrKind === 'weak') {
        const expiredFn = obj.expired as (() => boolean) | undefined;
        return expiredFn?.call(obj)
          ? `<weak_ptr ${obj.name}: expired>`
          : `<weak_ptr ${obj.name}: ${formatVal((obj.target as Record<string, unknown>).value)}>`;
      }
      const target = obj.__ptrKind === 'ref' ? (obj.target as Record<string, unknown>).value : obj.value;
      return `<${obj.__ptrKind} ${obj.name}: ${formatVal(target)}>`;
    }
    if (obj.__enumTag) {
      const vals = obj.__payload ? Object.values(obj.__payload as object).map(formatVal).join(', ') : '';
      return vals ? `${obj.__enumName}.${obj.__enumTag}(${vals})` : `${obj.__enumName}.${obj.__enumTag}`;
    }
    if (obj instanceof EjsStack || obj instanceof EjsQueue) return obj.toString();
    if (obj instanceof Set) return `Set{${Array.from(obj).map(formatVal).join(', ')}}`;
    if (Array.isArray(v)) return '[' + v.map(formatVal).join(', ') + ']';
    if (obj.__structName && typeof obj.toString === 'function') return String((obj.toString as () => string)());
    if (obj.__isEjsInstance) {
      const inst = v as EjsInstance;
      return `${inst.classDef.name} ${JSON.stringify(inst.fields)}`;
    }
    if (obj.__isEjsFn) return `<fn ${(v as EjsCallable).name}>`;
    if (typeof (obj as { toString?: () => string }).toString === 'function' && obj.toString !== Object.prototype.toString) {
      return String((obj as { toString: () => string }).toString());
    }
    try {
      return JSON.stringify(v);
    } catch {
      return '[Object]';
    }
  }
  return String(v);
}

export type DebuggerStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface DebugSnapshot {
  status: DebuggerStatus;
  currentLine: number | null;
  variables: DebugVariable[];
  callStack: CallFrame[];
  logs: string[];
  visualOutputs: VisualOutputItem[];
  registeredRoutes: RegisteredRouteInfo[];
  pointerEvents: PointerRuntimeEvent[];
  durationMs: number;
  error?: string;
}

export interface InterpreterOptions extends ExecuteAsyncOptions {
  breakpoints?: number[];
  startPaused?: boolean;
  onPause?: (snapshot: DebugSnapshot) => void;
}

export class ASTInterpreter {
  private readonly logs: string[] = [];
  private readonly pointerEvents: PointerRuntimeEvent[] = [];
  private readonly visualOutputs: VisualOutputItem[] = [];
  private readonly routes: Array<{ method: string; path: string; handler: unknown }> = [];
  private readonly callStack: CallFrame[] = [];
  private readonly memoryVfs = new Map<string, string>();
  private readonly memoryDb = new Map<string, Array<Record<string, unknown>>>();
  private readonly installedPkgs = new Map<string, Record<string, unknown>>();
  private readonly activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly activeIntervals = new Set<ReturnType<typeof setInterval>>();
  private readonly stdinQueue: string[];
  private readonly options: InterpreterOptions;

  private globalEnv: Environment;
  private activeEnv: Environment;
  private breakpoints: Set<number>;
  private stepMode = false;
  private aborted = false;
  private startTime = 0;
  private currentLine: number | null = null;
  private opsSinceYield = 0;
  private lastYieldAt = 0;
  private resumeResolver: ((mode: 'step' | 'continue' | 'stop') => void) | null = null;
  private yourgui!: YourGuiEngine;

  constructor(options: InterpreterOptions = {}) {
    this.options = options;
    this.stdinQueue = [...(options.stdin ?? [])];
    this.breakpoints = new Set(options.breakpoints ?? []);
    this.stepMode = Boolean(options.startPaused);
    this.globalEnv = new Environment(null, 'global');
    this.activeEnv = this.globalEnv;
    this.yourgui = new YourGuiEngine({
      formatVal,
      invokeCallback: (fn, args) => this.invokeCallableValue(fn, args, 0),
      onVisualUpdate: (item) => {
        if (item.kind === 'yourgui') {
          const idx = this.visualOutputs.findIndex(
            (v) => v.kind === 'yourgui' && v.pageId === item.pageId
          );
          if (idx === -1) this.visualOutputs.push(item);
          else this.visualOutputs[idx] = item;
        } else {
          this.visualOutputs.push(item);
        }
        this.options.onVisual?.(item);
      },
    });
    this.options.registerGuiDispatcher?.((elementId, eventType, payload) =>
      this.yourgui.dispatchEvent(elementId, eventType, payload)
    );
    this.installStdlib(this.globalEnv);
  }

  public setBreakpoints(lines: number[]): void {
    this.breakpoints = new Set(lines);
  }

  public step(): void {
    this.stepMode = true;
    const r = this.resumeResolver;
    this.resumeResolver = null;
    r?.('step');
  }

  public continue(): void {
    this.stepMode = false;
    const r = this.resumeResolver;
    this.resumeResolver = null;
    r?.('continue');
  }

  public stop(): void {
    this.aborted = true;
    this.cleanupTimers();
    const r = this.resumeResolver;
    this.resumeResolver = null;
    r?.('stop');
  }

  public getSnapshot(status: DebuggerStatus, error?: string): DebugSnapshot {
    return {
      status,
      currentLine: this.currentLine,
      variables: this.activeEnv.snapshotVariables(),
      callStack: [...this.callStack],
      logs: [...this.logs],
      visualOutputs: [...this.visualOutputs],
      registeredRoutes: this.routes.map((r) => ({ method: r.method, path: r.path })),
      pointerEvents: [...this.pointerEvents],
      durationMs: Number((performance.now() - this.startTime).toFixed(2)),
      error,
    };
  }

  public async execute(program: ProgramNode): Promise<ExecutionResult> {
    this.startTime = performance.now();
    this.opsSinceYield = 0;
    this.lastYieldAt = this.startTime;
    this.callStack.push({ name: '<module>', line: 1 });

    try {
      for (const stmt of program.body) {
        if (this.aborted) throw new ExitSignal('Stopped by debugger');
        await this.execStatement(stmt, this.globalEnv);
      }
      this.yourgui.flush();

      const durationMs = Number((performance.now() - this.startTime).toFixed(2));
      this.options.onPause?.(this.getSnapshot('completed'));
      return {
        logs: [...this.logs],
        pointerEvents: [...this.pointerEvents],
        visualOutputs: [...this.visualOutputs],
        registeredRoutes: this.routes.map((r) => ({ method: r.method, path: r.path })),
        finalVariables: this.activeEnv.snapshotVariables(),
        durationMs,
      };
    } catch (err) {
      const durationMs = Number((performance.now() - this.startTime).toFixed(2));
      if (err instanceof ExitSignal) {
        this.options.onPause?.(this.getSnapshot('completed'));
        return {
          logs: [...this.logs],
          pointerEvents: [...this.pointerEvents],
          visualOutputs: [...this.visualOutputs],
          registeredRoutes: this.routes.map((r) => ({ method: r.method, path: r.path })),
          finalVariables: this.activeEnv.snapshotVariables(),
          durationMs,
          haltedByExit: true,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.options.onPause?.(this.getSnapshot('error', msg));
      return {
        logs: [...this.logs],
        pointerEvents: [...this.pointerEvents],
        visualOutputs: [...this.visualOutputs],
        registeredRoutes: this.routes.map((r) => ({ method: r.method, path: r.path })),
        finalVariables: this.activeEnv.snapshotVariables(),
        durationMs,
        error: msg,
      };
    } finally {
      this.callStack.pop();
    }
  }

  private async maybePauseAt(line: number, env: Environment): Promise<void> {
    if (this.aborted) throw new ExitSignal('Stopped by debugger');
    this.activeEnv = env;
    this.currentLine = line;
    if (this.callStack.length > 0) {
      this.callStack[this.callStack.length - 1].line = line;
    }

    const shouldPause = this.stepMode || this.breakpoints.has(line);
    if (!shouldPause || !this.options.onPause) return;

    this.options.onPause(this.getSnapshot('paused'));
    const action = await new Promise<'step' | 'continue' | 'stop'>((resolve) => {
      this.resumeResolver = resolve;
    });
    if (action === 'stop' || this.aborted) {
      throw new ExitSignal('Stopped by debugger');
    }
  }

  private async tickLoop(): Promise<void> {
    if (this.aborted) throw new ExitSignal('Stopped by debugger');
    this.opsSinceYield++;
    if (this.opsSinceYield >= 200 || performance.now() - this.lastYieldAt > 12) {
      this.opsSinceYield = 0;
      this.lastYieldAt = performance.now();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.aborted) throw new ExitSignal('Stopped by debugger');
    }
  }

  private cleanupTimers(): void {
    for (const id of this.activeTimeouts) clearTimeout(id);
    for (const id of this.activeIntervals) clearInterval(id);
    this.activeTimeouts.clear();
    this.activeIntervals.clear();
  }

  private emitLog(line: string): void {
    this.logs.push(line);
    this.options.onLog?.(line);
  }

  private async execBlock(
    block: BlockStatementNode,
    parentEnv: Environment,
    label = 'block',
    reuseEnv = false
  ): Promise<unknown> {
    const env = reuseEnv ? parentEnv : new Environment(parentEnv, label);
    const defers: StatementNode[] = [];
    let result: unknown = undefined;

    try {
      for (const stmt of block.statements) {
        if (stmt.kind === 'DeferStatement') {
          defers.push(stmt.statement);
          continue;
        }
        result = await this.execStatement(stmt, env);
      }
      return result;
    } finally {
      for (let i = defers.length - 1; i >= 0; i--) {
        await this.execStatement(defers[i], env);
      }
    }
  }

  private async execStatement(stmt: StatementNode, env: Environment): Promise<unknown> {
    await this.maybePauseAt(stmt.line, env);

    switch (stmt.kind) {
      case 'VarDeclaration': {
        if (stmt.pointerMode === 'cpp_ref') {
          if (stmt.initializer) {
            const lval = await this.resolveLValueRef(stmt.initializer, env);
            env.defineAlias(stmt.name, lval.getter, lval.setter, !stmt.typeAnnotation?.isConst, 'cpp_ref');
            return lval.getter();
          }
          env.define(stmt.name, null, !stmt.typeAnnotation?.isConst, 'cpp_ref');
          return null;
        }
        if (
          stmt.pointerMode === 'ptr' &&
          stmt.initializer?.kind === 'PointerExpression' &&
          (stmt.initializer.op === 'addr' || stmt.initializer.op === 'borrow')
        ) {
          const val = await this.makeAddrPtr(
            stmt.initializer.argument,
            env,
            stmt.name,
            Boolean(stmt.typeAnnotation?.isConst)
          );
          env.define(stmt.name, val, stmt.mutable, stmt.mutable ? 'variable' : 'const');
          return val;
        }
        if (
          stmt.pointerMode === 'ref' &&
          stmt.initializer?.kind === 'PointerExpression' &&
          (stmt.initializer.op === 'borrow' || stmt.initializer.op === 'addr')
        ) {
          const target = await this.evalExpr(stmt.initializer.argument, env);
          const val = this.makeBorrow(target, stmt.name);
          env.define(stmt.name, val, stmt.mutable, stmt.mutable ? 'variable' : 'const');
          return val;
        }
        let val = stmt.initializer
          ? await this.evalExpr(stmt.initializer, env)
          : stmt.pointerMode === 'ptr' || stmt.pointerMode === 'unique' || stmt.pointerMode === 'weak'
            ? null
            : this.defaultForType(stmt.typeAnnotation?.name);
        if (stmt.pointerMode === 'own' && (!val || (val as Record<string, unknown>).__ptrKind !== 'own')) {
          val = this.makeOwn(val, stmt.name);
        } else if (stmt.pointerMode === 'shared' && (!val || (val as Record<string, unknown>).__ptrKind !== 'shared')) {
          val = this.makeShared(val, stmt.name);
        } else if (stmt.pointerMode === 'ref' && (!val || (val as Record<string, unknown>).__ptrKind !== 'ref')) {
          val = this.makeBorrow(val, stmt.name);
        }
        env.define(stmt.name, val, stmt.mutable, stmt.mutable ? 'variable' : 'const');
        return val;
      }

      case 'MultiVarDeclaration': {
        let last: unknown = undefined;
        for (const d of stmt.declarations) {
          last = await this.execStatement(d, env);
        }
        return last;
      }

      case 'ImportStatement': {
        const mod = this.loadModule(stmt.modulePath);
        if (stmt.namedImports.length > 0) {
          for (const key of stmt.namedImports) {
            env.define(key, (mod as Record<string, unknown>)[key], false, 'import');
          }
        } else {
          const bind = stmt.alias ?? stmt.defaultImport ?? 'mod';
          env.define(bind, mod, false, 'import');
        }
        return mod;
      }

      case 'FunctionDeclaration': {
        const fnObj: EjsCallable = {
          __isEjsFn: true,
          name: stmt.name,
          params: stmt.params,
          body: stmt.body,
          closure: env,
        };
        env.define(stmt.name, fnObj, false, 'function');
        return fnObj;
      }

      case 'ClassDeclaration': {
        let superDef: EjsClassDef | null = null;
        if (stmt.superClass) {
          const found = env.get(stmt.superClass);
          if (found && (found as EjsClassDef).__isEjsClass) {
            superDef = found as EjsClassDef;
          }
        }
        const staticProps: Record<string, unknown> = {};
        for (const f of stmt.fields) {
          if (f.isStatic) {
            staticProps[f.name] = f.initializer ? await this.evalExpr(f.initializer, env) : null;
          }
        }
        const classDef: EjsClassDef = {
          __isEjsClass: true,
          name: stmt.name,
          decl: stmt,
          superDef,
          closure: env,
          staticProps,
        };
        for (const m of stmt.methods) {
          if (m.isStatic) {
            staticProps[m.name] = {
              __isEjsFn: true,
              name: `${stmt.name}.${m.name}`,
              params: m.params,
              body: m.body,
              closure: env,
            } satisfies EjsCallable;
          }
        }
        env.define(stmt.name, classDef, false, 'class');
        return classDef;
      }

      case 'StructDeclaration': {
        const structDef: EjsStructDef = {
          __isEjsStruct: true,
          name: stmt.name,
          decl: stmt,
          closure: env,
        };
        env.define(stmt.name, structDef, false, 'struct');
        return structDef;
      }

      case 'EnumDeclaration': {
        const enumObj: Record<string, unknown> = {};
        for (const v of stmt.variants) {
          if (v.fields.length === 0) {
            enumObj[v.name] = Object.freeze({
              __enumName: stmt.name,
              __enumTag: v.name,
              __payload: {},
            });
          } else {
            enumObj[v.name] = (...args: unknown[]) => {
              const payload: Record<string, unknown> = {};
              v.fields.forEach((fName, idx) => {
                payload[fName] = args[idx];
              });
              return Object.freeze({
                __enumName: stmt.name,
                __enumTag: v.name,
                __payload: payload,
              });
            };
          }
        }
        env.define(stmt.name, Object.freeze(enumObj), false, 'enum');
        return enumObj;
      }

      case 'TraitDeclaration':
        return undefined;

      case 'BlockStatement':
        return this.execBlock(stmt, env, 'block');

      case 'ScopeStatement':
        return this.execBlock(stmt.body, env, stmt.name ? `scope:${stmt.name}` : 'scope');

      case 'IfStatement': {
        if (this.isTruthy(await this.evalExpr(stmt.condition, env))) {
          return this.execBlock(stmt.consequent, env, 'if');
        }
        for (const branch of stmt.elifBranches) {
          if (this.isTruthy(await this.evalExpr(branch.condition, env))) {
            return this.execBlock(branch.consequent, env, 'elif');
          }
        }
        if (stmt.alternate) {
          return this.execBlock(stmt.alternate, env, 'else');
        }
        return undefined;
      }

      case 'ForInStatement': {
        const iterable = await this.evalExpr(stmt.iterable, env);
        const items = this.toIterable(iterable);
        for (const item of items) {
          await this.tickLoop();
          const loopEnv = new Environment(env, 'for');
          loopEnv.define(stmt.variable, item, false, 'loop');
          try {
            await this.execBlock(stmt.body, loopEnv, 'for', true);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return undefined;
      }

      case 'CForStatement': {
        const forEnv = new Environment(env, 'for');
        if (stmt.init) await this.execStatement(stmt.init, forEnv);
        while (true) {
          await this.tickLoop();
          if (stmt.condition && !this.isTruthy(await this.evalExpr(stmt.condition, forEnv))) {
            break;
          }
          try {
            await this.execBlock(stmt.body, forEnv, 'for');
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) {
              if (stmt.update) await this.evalExpr(stmt.update, forEnv);
              continue;
            }
            throw sig;
          }
          if (stmt.update) await this.evalExpr(stmt.update, forEnv);
        }
        return undefined;
      }

      case 'WhileStatement': {
        while (this.isTruthy(await this.evalExpr(stmt.condition, env))) {
          await this.tickLoop();
          try {
            await this.execBlock(stmt.body, env, 'while');
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return undefined;
      }

      case 'DoWhileStatement': {
        do {
          await this.tickLoop();
          try {
            await this.execBlock(stmt.body, env, 'do-while');
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        } while (this.isTruthy(await this.evalExpr(stmt.condition, env)));
        return undefined;
      }

      case 'LoopStatement': {
        while (true) {
          await this.tickLoop();
          try {
            await this.execBlock(stmt.body, env, 'loop');
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return undefined;
      }

      case 'RepeatStatement': {
        const count = Number(await this.evalExpr(stmt.count, env));
        for (let i = 0; i < count; i++) {
          await this.tickLoop();
          try {
            await this.execBlock(stmt.body, env, 'repeat');
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return undefined;
      }

      case 'ReturnStatement': {
        const val = stmt.value ? await this.evalExpr(stmt.value, env) : undefined;
        throw new ReturnSignal(val);
      }

      case 'BreakStatement':
        throw new BreakSignal();

      case 'ContinueStatement':
        throw new ContinueSignal();

      case 'TryCatchStatement': {
        try {
          return await this.execBlock(stmt.tryBlock, env, 'try');
        } catch (err) {
          if (err instanceof ReturnSignal || err instanceof BreakSignal || err instanceof ContinueSignal || err instanceof ExitSignal) {
            throw err;
          }
          const catchEnv = new Environment(env, 'catch');
          if (stmt.catchVar) {
            const val = err instanceof Error ? err.message : err;
            catchEnv.define(stmt.catchVar, val, true, 'variable');
          }
          return this.execBlock(stmt.catchBlock, catchEnv, 'catch', true);
        }
      }

      case 'ThrowStatement': {
        const val = await this.evalExpr(stmt.value, env);
        throw val instanceof Error ? val : new Error(formatVal(val));
      }

      case 'DeferStatement':
        return this.execStatement(stmt.statement, env);

      case 'DropStatement': {
        const target = await this.evalExpr(stmt.target, env);
        this.dropPointer(target, Boolean(stmt.isArrayDelete));
        return null;
      }

      case 'StyleStatement':
        return this.yourgui.injectCss(stmt.css);

      case 'ExpressionStatement':
        return this.evalExpr(stmt.expression, env);
    }
  }

  private async evalExpr(expr: ExpressionNode, env: Environment): Promise<unknown> {
    switch (expr.kind) {
      case 'Literal':
        return expr.value;

      case 'Identifier':
        return env.get(expr.name);

      case 'SelfExpression':
        return env.get('self');

      case 'SuperExpression':
        return env.get('super');

      case 'FString': {
        let out = '';
        for (const p of expr.parts) {
          if (p.kind === 'text') out += p.value;
          else out += formatVal(await this.evalExpr(p.expression, env));
        }
        return out;
      }

      case 'ArrayLiteral': {
        const arr: unknown[] = [];
        for (const e of expr.elements) arr.push(await this.evalExpr(e, env));
        return arr;
      }

      case 'MapLiteral': {
        const obj: Record<string, unknown> = {};
        for (const entry of expr.entries) {
          const k = await this.evalExpr(entry.key, env);
          const v = await this.evalExpr(entry.value, env);
          obj[String(k)] = v;
        }
        return obj;
      }

      case 'RangeExpression': {
        const s = Number(await this.evalExpr(expr.start, env));
        const e = Number(await this.evalExpr(expr.end, env));
        const out: number[] = [];
        const lim = expr.inclusive ? e + 1 : e;
        for (let i = s; i < lim; i++) out.push(i);
        return out;
      }

      case 'UnaryExpression': {
        const val = await this.evalExpr(expr.operand, env);
        if (expr.operator === '!') return !this.isTruthy(val);
        if (expr.operator === '-') return -Number(val);
        return val;
      }

      case 'UpdateExpression': {
        if (expr.argument.kind === 'Identifier') {
          const cur = Number(env.get(expr.argument.name));
          const next = expr.operator === '++' ? cur + 1 : cur - 1;
          env.assign(expr.argument.name, next);
          return expr.prefix ? next : cur;
        }
        return 0;
      }

      case 'BinaryExpression': {
        const left = await this.evalExpr(expr.left, env);
        const right = await this.evalExpr(expr.right, env);
        switch (expr.operator) {
          case '+':
            if (
              left &&
              typeof left === 'object' &&
              (left as Record<string, unknown>).__ptrKind === 'ptr' &&
              typeof (left as Record<string, unknown>).offsetPtr === 'function'
            ) {
              return ((left as Record<string, unknown>).offsetPtr as (n: number) => unknown)(Number(right));
            }
            return typeof left === 'string' || typeof right === 'string'
              ? String(left) + String(right)
              : Number(left) + Number(right);
          case '-': return Number(left) - Number(right);
          case '*': return Number(left) * Number(right);
          case '/': return Number(left) / Number(right);
          case '%': return Number(left) % Number(right);
          case '**': return Number(left) ** Number(right);
          case '==': return left === right;
          case '!=': return left !== right;
          case '<': return (left as number) < (right as number);
          case '<=': return (left as number) <= (right as number);
          case '>': return (left as number) > (right as number);
          case '>=': return (left as number) >= (right as number);
          case 'in': return this.hasMember(right, left);
          case 'not in': return !this.hasMember(right, left);
          case 'is':
            return Boolean(
              left &&
              typeof left === 'object' &&
              (left as EjsInstance).__isEjsInstance &&
              (right as EjsClassDef)?.__isEjsClass &&
              this.isInstanceOf(left as EjsInstance, right as EjsClassDef)
            );
          default:
            return undefined;
        }
      }

      case 'LogicalExpression': {
        const left = await this.evalExpr(expr.left, env);
        if (expr.operator === 'and') return this.isTruthy(left) ? await this.evalExpr(expr.right, env) : left;
        if (expr.operator === 'or') return this.isTruthy(left) ? left : await this.evalExpr(expr.right, env);
        return left !== null && left !== undefined ? left : await this.evalExpr(expr.right, env);
      }

      case 'ConditionalExpression': {
        const cond = await this.evalExpr(expr.condition, env);
        return this.isTruthy(cond)
          ? this.evalExpr(expr.consequent, env)
          : this.evalExpr(expr.alternate, env);
      }

      case 'AssignmentExpression': {
        const rhs = await this.evalExpr(expr.value, env);
        if (expr.target.kind === 'Identifier') {
          const finalVal = expr.operator === '='
            ? rhs
            : this.applyCompoundOp(expr.operator, env.get(expr.target.name), rhs);
          env.assign(expr.target.name, finalVal);
          return finalVal;
        }
        if (expr.target.kind === 'MemberExpression') {
          if (this.isBlockedProperty(expr.target.property)) {
            throw new Error(`SecurityError: Access to '${expr.target.property}' is blocked in sandbox`);
          }
          const obj = (await this.evalExpr(expr.target.object, env)) as Record<string, unknown>;
          const targetObj = obj && (obj as unknown as EjsInstance).__isEjsInstance
            ? (obj as unknown as EjsInstance).fields
            : obj;
          const finalVal = expr.operator === '='
            ? rhs
            : this.applyCompoundOp(expr.operator, targetObj[expr.target.property], rhs);
          targetObj[expr.target.property] = finalVal;
          return finalVal;
        }
        if (expr.target.kind === 'IndexExpression') {
          const obj = (await this.evalExpr(expr.target.object, env)) as Record<string, unknown>;
          const idx = await this.evalExpr(expr.target.index, env);
          if (obj && typeof obj === 'object' && obj.__ptrKind === 'ptr') {
            if (!obj.alive) throw new Error(`NullPointerError: Write to freed/null pointer '${obj.name}'`);
            if (obj.isConst) throw new Error(`RuntimeRuleError: Cannot modify value through const pointer '${obj.name}'`);
            const numIdx = Number(idx);
            if (Array.isArray(obj.__heapArray)) {
              const pos = (Number(obj.offset) || 0) + numIdx;
              if (pos < 0 || pos >= obj.__heapArray.length) {
                throw new Error(`BoundsError: Heap index ${pos} out of bounds`);
              }
              const finalVal = expr.operator === '=' ? rhs : this.applyCompoundOp(expr.operator, obj.__heapArray[pos], rhs);
              obj.__heapArray[pos] = finalVal;
              return finalVal;
            }
            const cur = (obj.get as () => unknown)();
            if (Array.isArray(cur)) {
              const finalVal = expr.operator === '=' ? rhs : this.applyCompoundOp(expr.operator, cur[numIdx], rhs);
              cur[numIdx] = finalVal;
              return finalVal;
            }
            if (numIdx === 0) {
              const finalVal = expr.operator === '=' ? rhs : this.applyCompoundOp(expr.operator, cur, rhs);
              (obj.set as (v: unknown) => unknown)(finalVal);
              return finalVal;
            }
          }
          const key = String(idx);
          if (this.isBlockedProperty(key)) {
            throw new Error(`SecurityError: Access to '${key}' is blocked in sandbox`);
          }
          const finalVal = expr.operator === '='
            ? rhs
            : this.applyCompoundOp(expr.operator, obj[key], rhs);
          obj[key] = finalVal;
          return finalVal;
        }
        if (expr.target.kind === 'PointerExpression' && expr.target.op === 'deref') {
          const ptr = (await this.evalExpr(expr.target.argument, env)) as Record<string, unknown>;
          const finalVal = expr.operator === '='
            ? rhs
            : this.applyCompoundOp(expr.operator, this.derefPointer(ptr), rhs);
          this.setDerefPointer(ptr, finalVal);
          return finalVal;
        }
        throw new Error('RuntimeError: Invalid assignment target');
      }

      case 'PointerExpression': {
        switch (expr.op) {
          case 'own': return this.makeOwn(await this.evalExpr(expr.argument, env));
          case 'shared': return this.makeShared(await this.evalExpr(expr.argument, env));
          case 'borrow': return this.makeBorrow(await this.evalExpr(expr.argument, env));
          case 'move': return this.movePointer(await this.evalExpr(expr.argument, env));
          case 'deref': return this.derefPointer(await this.evalExpr(expr.argument, env));
          case 'addr': return this.makeAddrPtr(expr.argument, env, 'ptr', false);
          case 'sizeof':
            return expr.sizeofTypeName
              ? this.evalSizeof(expr.sizeofTypeName)
              : this.evalSizeof(await this.evalExpr(expr.argument, env));
        }
      }

      case 'LambdaExpression':
        return {
          __isEjsFn: true,
          name: '<lambda>',
          params: expr.params,
          body: expr.body,
          closure: env,
        } satisfies EjsCallable;

      case 'PipeExpression': {
        const leftVal = await this.evalExpr(expr.left, env);
        if (expr.right.kind === 'CallExpression') {
          const args = [leftVal];
          for (const a of expr.right.args) args.push(await this.evalExpr(a, env));
          return this.invokeCalleeExpr(expr.right.callee, args, env, expr.line);
        }
        const fn = await this.evalExpr(expr.right, env);
        return this.invokeCallableValue(fn, [leftVal], expr.line);
      }

      case 'CallExpression': {
        const args: unknown[] = [];
        for (const a of expr.args) args.push(await this.evalExpr(a, env));
        return this.invokeCalleeExpr(expr.callee, args, env, expr.line, expr.args);
      }

      case 'MemberExpression': {
        const obj = await this.evalExpr(expr.object, env);
        if ((obj === null || obj === undefined) && expr.optional) return undefined;
        return this.readMember(obj, expr.property);
      }

      case 'IndexExpression': {
        const obj = (await this.evalExpr(expr.object, env)) as Record<string, unknown>;
        const idx = await this.evalExpr(expr.index, env);
        if (obj === null || obj === undefined) throw new Error('NullPointerError: Cannot index null');
        if (typeof obj === 'object' && obj.__ptrKind === 'ptr') {
          if (!obj.alive) throw new Error(`NullPointerError: Dereference of freed/null pointer '${obj.name}'`);
          const numIdx = Number(idx);
          if (Array.isArray(obj.__heapArray)) {
            const pos = (Number(obj.offset) || 0) + numIdx;
            if (pos < 0 || pos >= obj.__heapArray.length) {
              throw new Error(`BoundsError: Heap index ${pos} out of bounds`);
            }
            return obj.__heapArray[pos];
          }
          const cur = (obj.get as () => unknown)();
          if (Array.isArray(cur) || typeof cur === 'string') return (cur as Record<number, unknown>)[numIdx];
          if (numIdx === 0) return cur;
          return undefined;
        }
        const key = String(idx);
        if (this.isBlockedProperty(key)) {
          throw new Error(`SecurityError: Access to '${key}' is blocked in sandbox`);
        }
        return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
      }

      case 'NewExpression': {
        if (expr.countExpr) {
          const cnt = Number(await this.evalExpr(expr.countExpr, env));
          return this.allocArray(cnt, expr.className);
        }
        const primitiveTypes = new Set([
          'int', 'float', 'number', 'double', 'long', 'short', 'char',
          'str', 'string', 'text', 'bool', 'boolean', 'any', 'ptr',
        ]);
        if (primitiveTypes.has(expr.className)) {
          const initVal = expr.args.length > 0
            ? await this.evalExpr(expr.args[0], env)
            : this.defaultForType(expr.className);
          return this.allocSingle(initVal, expr.className);
        }
        const cls = env.get(expr.className);
        const args: unknown[] = [];
        for (const a of expr.args) args.push(await this.evalExpr(a, env));
        if (cls && (cls as EjsClassDef).__isEjsClass) {
          return this.instantiateClass(cls as EjsClassDef, args, expr.line);
        }
        if (typeof cls === 'function') {
          return (cls as (...xs: unknown[]) => unknown)(...args);
        }
        throw new Error(`TypeError: '${expr.className}' is not a class`);
      }

      case 'StructInitExpression': {
        const def = env.get(expr.structName) as EjsStructDef;
        if (!def || !def.__isEjsStruct) {
          throw new Error(`TypeError: '${expr.structName}' is not a struct`);
        }
        const provided: Record<string, unknown> = {};
        for (const f of expr.fields) {
          provided[f.name] = await this.evalExpr(f.value, env);
        }
        return this.instantiateStruct(def, provided);
      }

      case 'MatchExpression': {
        const subject = await this.evalExpr(expr.subject, env);
        for (const arm of expr.arms) {
          const matchEnv = new Environment(env, 'match');
          if (this.matchPattern(arm.pattern, subject, matchEnv)) {
            if (arm.body.kind === 'BlockStatement') {
              try {
                return await this.execBlock(arm.body, matchEnv, 'match', true);
              } catch (sig) {
                if (sig instanceof ReturnSignal) return sig.value;
                throw sig;
              }
            }
            return this.evalExpr(arm.body, matchEnv);
          }
        }
        return undefined;
      }
    }
  }

  private async invokeCalleeExpr(
    callee: ExpressionNode,
    args: unknown[],
    env: Environment,
    line: number,
    argExprs?: ExpressionNode[]
  ): Promise<unknown> {
    if (callee.kind === 'SuperExpression') {
      const superDef = env.get('__superClass') as EjsClassDef | null;
      const selfInst = env.get('self') as EjsInstance;
      if (superDef) {
        const initFound = this.findMethod(superDef, 'init');
        if (initFound) {
          return this.invokeCallableValue(
            { ...initFound.fn, boundSelf: selfInst, boundSuper: initFound.owner.superDef },
            args,
            line,
            argExprs,
            env
          );
        }
      }
      return undefined;
    }

    if (callee.kind === 'MemberExpression' && callee.object.kind === 'SuperExpression') {
      const superDef = env.get('__superClass') as EjsClassDef | null;
      const selfInst = env.get('self') as EjsInstance;
      if (!superDef) {
        throw new Error(`ReferenceError: 'super' is unavailable in '${callee.property}()'`);
      }
      const found = this.findMethod(superDef, callee.property);
      if (!found) {
        throw new Error(`MethodError: Superclass '${superDef.name}' has no method '${callee.property}()'`);
      }
      return this.invokeCallableValue(
        { ...found.fn, boundSelf: selfInst, boundSuper: found.owner.superDef },
        args,
        line,
        argExprs,
        env
      );
    }

    if (callee.kind === 'MemberExpression') {
      const obj = await this.evalExpr(callee.object, env);
      if ((obj === null || obj === undefined) && callee.optional) return undefined;
      return this.callObjectMethod(obj, callee.property, args, line);
    }

    const fn = await this.evalExpr(callee, env);
    return this.invokeCallableValue(fn, args, line, argExprs, env);
  }

  private async invokeCallableValue(
    fn: unknown,
    args: unknown[],
    line: number,
    argExprs?: ExpressionNode[],
    callerEnv?: Environment
  ): Promise<unknown> {
    if (typeof fn === 'function') {
      return await (fn as (...xs: unknown[]) => unknown)(...args);
    }
    if (fn && typeof fn === 'object' && (fn as EjsClassDef).__isEjsClass) {
      return this.instantiateClass(fn as EjsClassDef, args, line);
    }
    if (fn && typeof fn === 'object' && (fn as EjsCallable).__isEjsFn) {
      const callable = fn as EjsCallable;
      const fnEnv = new Environment(callable.closure, `fn:${callable.name}`);
      if (callable.boundSelf !== undefined) {
        fnEnv.define('self', callable.boundSelf, false, 'self');
      }
      if (callable.boundSuper !== undefined) {
        fnEnv.define('__superClass', callable.boundSuper, false, 'super');
      }
      for (let i = 0; i < callable.params.length; i++) {
        const p = callable.params[i];
        if (p.typeAnnotation?.isReference && argExprs?.[i] && callerEnv) {
          const lval = await this.resolveLValueRef(argExprs[i], callerEnv);
          fnEnv.defineAlias(p.name, lval.getter, lval.setter, !p.typeAnnotation.isConst, 'param_ref');
          continue;
        }
        const val =
          i < args.length && args[i] !== undefined
            ? args[i]
            : p.defaultValue
              ? await this.evalExpr(p.defaultValue, fnEnv)
              : undefined;
        fnEnv.define(p.name, val, true, 'param');
      }

      this.callStack.push({ name: callable.name, line });
      try {
        if (callable.body.kind === 'BlockStatement') {
          await this.execBlock(callable.body, fnEnv, callable.name, true);
          return undefined;
        }
        return await this.evalExpr(callable.body, fnEnv);
      } catch (sig) {
        if (sig instanceof ReturnSignal) return sig.value;
        throw sig;
      } finally {
        this.callStack.pop();
      }
    }
    throw new Error(`TypeError: '${formatVal(fn)}' is not callable`);
  }

  private async instantiateClass(classDef: EjsClassDef, args: unknown[], line: number): Promise<EjsInstance> {
    const fields: Record<string, unknown> = {};
    const chain: EjsClassDef[] = [];
    let cur: EjsClassDef | null = classDef;
    while (cur) {
      chain.unshift(cur);
      cur = cur.superDef;
    }
    for (const c of chain) {
      for (const f of c.decl.fields) {
        if (!f.isStatic) {
          fields[f.name] = f.initializer ? await this.evalExpr(f.initializer, c.closure) : undefined;
        }
      }
    }
    const inst: EjsInstance = { __isEjsInstance: true, classDef, fields };
    const initFound = this.findMethod(classDef, 'init');
    if (initFound) {
      if (
        initFound.owner === classDef &&
        classDef.superDef &&
        !this.hasExplicitSuperCall(initFound.fn.body)
      ) {
        const parentInit = this.findMethod(classDef.superDef, 'init');
        if (parentInit) {
          await this.invokeCallableValue(
            { ...parentInit.fn, boundSelf: inst, boundSuper: parentInit.owner.superDef },
            [],
            line
          );
        }
      }
      await this.invokeCallableValue(
        { ...initFound.fn, boundSelf: inst, boundSuper: initFound.owner.superDef },
        args,
        line
      );
    }
    return inst;
  }

  private hasExplicitSuperCall(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const obj = node as Record<string, unknown>;
    if (obj.kind === 'CallExpression' && (obj.callee as Record<string, unknown>)?.kind === 'SuperExpression') {
      return true;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'line' || k === 'column') continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (this.hasExplicitSuperCall(item)) return true;
        }
      } else if (v && typeof v === 'object') {
        if (this.hasExplicitSuperCall(v)) return true;
      }
    }
    return false;
  }

  private async instantiateStruct(def: EjsStructDef, provided: Record<string, unknown>): Promise<Record<string, unknown>> {
    const obj: Record<string, unknown> = { __structName: def.name };
    for (const f of def.decl.fields) {
      obj[f.name] = provided[f.name] !== undefined
        ? provided[f.name]
        : f.defaultValue
          ? await this.evalExpr(f.defaultValue, def.closure)
          : null;
    }
    obj.clone = () => ({ ...obj });
    obj.toString = () => {
      const pairs = def.decl.fields.map((f) => `${f.name}: ${formatVal(obj[f.name])}`).join(', ');
      return `${def.name} { ${pairs} }`;
    };
    for (const m of def.decl.methods) {
      obj[m.name] = {
        __isEjsFn: true,
        name: `${def.name}.${m.name}`,
        params: m.params,
        body: m.body,
        closure: def.closure,
        boundSelf: obj,
      } satisfies EjsCallable;
    }
    return obj;
  }

  private findMethod(classDef: EjsClassDef, name: string): { fn: EjsCallable; owner: EjsClassDef } | null {
    let cur: EjsClassDef | null = classDef;
    while (cur) {
      const m = cur.decl.methods.find((mm) => !mm.isStatic && (mm.isConstructor ? 'init' : mm.name) === name);
      if (m) {
        return {
          owner: cur,
          fn: {
            __isEjsFn: true,
            name: `${cur.name}.${name}`,
            params: m.params,
            body: m.body,
            closure: cur.closure,
          },
        };
      }
      cur = cur.superDef;
    }
    return null;
  }

  private isInstanceOf(inst: EjsInstance, target: EjsClassDef): boolean {
    let cur: EjsClassDef | null = inst.classDef;
    while (cur) {
      if (cur.name === target.name) return true;
      cur = cur.superDef;
    }
    return false;
  }

  private isBlockedProperty(prop: string): boolean {
    return (
      prop === '__proto__' ||
      prop === 'constructor' ||
      prop === 'prototype' ||
      prop === '__defineGetter__' ||
      prop === '__defineSetter__' ||
      prop === '__lookupGetter__' ||
      prop === '__lookupSetter__'
    );
  }

  private readMember(obj: unknown, prop: string): unknown {
    if (this.isBlockedProperty(prop)) {
      throw new Error(`SecurityError: Access to '${prop}' is blocked in sandbox`);
    }
    if (obj === null || obj === undefined) throw new Error(`NullPointerError: Cannot read '.${prop}' of null`);
    if (typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      if (o.__ptrKind) {
        if (prop === 'addr' || prop === 'address') return o.addr;
        if (prop === 'location') return this.getBrowserLocation();
        if (prop === 'value') return typeof o.get === 'function' ? (o.get as () => unknown)() : this.derefPointer(o);
        if (prop in o) {
          const val = o[prop];
          return typeof val === 'function' ? val.bind(o) : val;
        }
        return this.readMember(this.derefPointer(o), prop);
      }
      if (o.__isEjsInstance) {
        const inst = obj as EjsInstance;
        if (Object.prototype.hasOwnProperty.call(inst.fields, prop)) return inst.fields[prop];
        const found = this.findMethod(inst.classDef, prop);
        if (found) return { ...found.fn, boundSelf: inst, boundSuper: found.owner.superDef };
        return undefined;
      }
      if (o.__isEjsClass) {
        return Object.prototype.hasOwnProperty.call((obj as EjsClassDef).staticProps, prop)
          ? (obj as EjsClassDef).staticProps[prop]
          : undefined;
      }
      return Object.prototype.hasOwnProperty.call(o, prop) ? o[prop] : undefined;
    }
    return undefined;
  }

  private async callObjectMethod(obj: unknown, method: string, args: unknown[], line: number): Promise<unknown> {
    if (this.isBlockedProperty(method)) {
      throw new Error(`SecurityError: Method '${method}()' is blocked in sandbox`);
    }
    if (obj === null || obj === undefined) throw new Error(`NullPointerError: Cannot call '.${method}()' on null`);

    if (typeof obj === 'object' && (obj as Record<string, unknown>).__ptrKind) {
      const o = obj as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(o, method) && typeof o[method] === 'function') {
        return await (o[method] as (...xs: unknown[]) => unknown).apply(obj, args);
      }
      return this.callObjectMethod(this.derefPointer(o), method, args, line);
    }

    if (typeof obj === 'object' && (obj as EjsInstance).__isEjsInstance) {
      const inst = obj as EjsInstance;
      const found = this.findMethod(inst.classDef, method);
      if (!found) throw new Error(`MethodError: '${inst.classDef.name}' has no method '${method}()'`);
      return this.invokeCallableValue({ ...found.fn, boundSelf: inst, boundSuper: found.owner.superDef }, args, line);
    }

    if (typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Set)) {
      const o = obj as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(o, method) && typeof o[method] === 'function') {
        return await (o[method] as (...xs: unknown[]) => unknown).apply(obj, args);
      }
      if (Object.prototype.hasOwnProperty.call(o, method) && o[method] && (o[method] as EjsCallable).__isEjsFn) {
        return this.invokeCallableValue(o[method], args, line);
      }
    }

    if (Array.isArray(obj)) {
      switch (method) {
        case 'append':
        case 'push':
          obj.push(...args);
          return obj;
        case 'prepend':
          obj.unshift(...args);
          return obj;
        case 'pop':
          return obj.pop();
        case 'insert':
          obj.splice(Number(args[0]), 0, args[1]);
          return obj;
        case 'remove': {
          const idx = obj.indexOf(args[0]);
          if (idx !== -1) { obj.splice(idx, 1); return true; }
          return false;
        }
        case 'removeAt':
          return obj.splice(Number(args[0]), 1)[0];
        case 'sort':
          return this.smartSort(obj, false);
        case 'sortDesc':
          return this.smartSort(obj, true);
        case 'shuffle':
          return this.shuffleArray(obj);
        case 'find': {
          if (typeof args[0] === 'function' || (args[0] && (args[0] as EjsCallable).__isEjsFn)) {
            for (const item of obj) {
              await this.tickLoop();
              if (this.isTruthy(await this.invokeCallableValue(args[0], [item], line))) return item;
            }
            return undefined;
          }
          return obj.find((el) => el === args[0]);
        }
        case 'filter': {
          const res: unknown[] = [];
          for (const item of obj) {
            await this.tickLoop();
            if (this.isTruthy(await this.invokeCallableValue(args[0], [item], line))) res.push(item);
          }
          return res;
        }
        case 'map': {
          const res: unknown[] = [];
          for (const item of obj) {
            await this.tickLoop();
            res.push(await this.invokeCallableValue(args[0], [item], line));
          }
          return res;
        }
        case 'contains':
        case 'has':
          return obj.includes(args[0]);
        case 'reverse':
          return obj.reverse();
        case 'unique':
          return [...new Set(obj)];
        case 'clear':
          obj.length = 0;
          return obj;
        case 'first':
          return obj[0] ?? null;
        case 'last':
          return obj[obj.length - 1] ?? null;
        case 'len':
        case 'length':
        case 'size':
          return obj.length;
        case 'isEmpty':
          return obj.length === 0;
        case 'sum':
          return obj.reduce<number>((a, b) => a + Number(b), 0);
        case 'avg':
          return obj.length ? obj.reduce<number>((a, b) => a + Number(b), 0) / obj.length : 0;
        case 'min':
          return obj.length ? Math.min(...obj.map(Number)) : null;
        case 'max':
          return obj.length ? Math.max(...obj.map(Number)) : null;
        case 'clone':
          return [...obj];
      }
    }

    if (typeof obj === 'string') {
      switch (method) {
        case 'upper':
        case 'uppercase':
        case 'toUpper':
          return obj.toUpperCase();
        case 'lower':
        case 'lowercase':
        case 'toLower':
          return obj.toLowerCase();
        case 'trim':
          return obj.trim();
        case 'split':
          return obj.split(String(args[0] ?? ' '));
        case 'replace':
          return obj.split(String(args[0])).join(String(args[1] ?? ''));
        case 'contains':
        case 'has':
          return obj.includes(String(args[0]));
        case 'reverse':
          return obj.split('').reverse().join('');
        case 'len':
        case 'length':
        case 'size':
          return obj.length;
        case 'toInt':
          return Number.parseInt(obj.trim(), 10);
        case 'toFloat':
          return Number.parseFloat(obj.trim());
      }
    }

    if (typeof obj === 'number') {
      switch (method) {
        case 'abs': return Math.abs(obj);
        case 'round': return Math.round(obj);
        case 'floor': return Math.floor(obj);
        case 'ceil': return Math.ceil(obj);
        case 'sqrt': return Math.sqrt(obj);
        case 'pow': return Math.pow(obj, Number(args[0] ?? 2));
        case 'toStr': return String(obj);
        case 'clamp': return Math.min(Math.max(obj, Number(args[0])), Number(args[1]));
      }
    }

    if (typeof obj === 'object') {
      const dict = obj as Record<string, unknown>;
      switch (method) {
        case 'set': dict[String(args[0])] = args[1]; return dict;
        case 'get': return Object.prototype.hasOwnProperty.call(dict, String(args[0])) ? dict[String(args[0])] : (args[1] ?? null);
        case 'has':
        case 'contains': return Object.prototype.hasOwnProperty.call(dict, String(args[0]));
        case 'remove':
        case 'delete': {
          const k = String(args[0]);
          const existed = Object.prototype.hasOwnProperty.call(dict, k);
          delete dict[k];
          return existed;
        }
        case 'keys': return Object.keys(dict);
        case 'values': return Object.values(dict);
        case 'entries': return Object.entries(dict);
        case 'len':
        case 'length':
        case 'size': return Object.keys(dict).length;
        case 'clone': return { ...dict };
      }
    }

    throw new Error(`MethodError: '${typeof obj}' has no method '${method}()'`);
  }

  private matchPattern(pattern: MatchPattern, subject: unknown, env: Environment): boolean {
    switch (pattern.kind) {
      case 'WildcardPattern':
        return true;
      case 'LiteralPattern':
        return subject === pattern.value;
      case 'RangePattern':
        return (
          typeof subject === 'number' &&
          subject >= pattern.start &&
          (pattern.inclusive ? subject <= pattern.end : subject < pattern.end)
        );
      case 'EnumPattern': {
        if (!subject || typeof subject !== 'object') return false;
        const s = subject as Record<string, unknown>;
        if (s.__enumTag !== pattern.variant) return false;
        if (pattern.enumName && s.__enumName !== pattern.enumName) return false;
        const vals = Object.values((s.__payload as Record<string, unknown>) || {});
        pattern.bindings.forEach((b, idx) => env.define(b, vals[idx], false, 'match'));
        return true;
      }
      case 'BindingPattern':
        env.define(pattern.name, subject, false, 'match');
        return true;
    }
  }

  private applyCompoundOp(op: string, current: unknown, rhs: unknown): unknown {
    switch (op) {
      case '+=':
        return typeof current === 'string' || typeof rhs === 'string'
          ? String(current) + String(rhs)
          : Number(current) + Number(rhs);
      case '-=': return Number(current) - Number(rhs);
      case '*=': return Number(current) * Number(rhs);
      case '/=': return Number(current) / Number(rhs);
      default: return rhs;
    }
  }

  private defaultForType(typeName?: string): unknown {
    switch (typeName) {
      case 'int':
      case 'float':
      case 'number': return 0;
      case 'str':
      case 'string':
      case 'text': return '';
      case 'bool':
      case 'boolean': return false;
      case 'array':
      case 'list': return [];
      case 'dict':
      case 'map': return {};
      case 'stack': return new EjsStack();
      case 'queue': return new EjsQueue();
      case 'set': return new Set();
      default: return null;
    }
  }

  private isTruthy(v: unknown): boolean {
    return Boolean(v);
  }

  private toIterable(x: unknown): unknown[] {
    if (x === null || x === undefined) return [];
    if (Array.isArray(x)) return x;
    if (typeof x === 'string') return x.split('');
    if (x instanceof Set) return Array.from(x);
    if (x instanceof EjsStack || x instanceof EjsQueue) return x.toArray();
    if (typeof x === 'object') return Object.keys(x);
    return [];
  }

  private hasMember(container: unknown, item: unknown): boolean {
    if (container === null || container === undefined) return false;
    if (Array.isArray(container)) return container.includes(item);
    if (typeof container === 'string') return container.includes(String(item));
    if (container instanceof Set) return container.has(item);
    if (container instanceof EjsStack || container instanceof EjsQueue) return container.contains(item);
    if (typeof container === 'object') return Object.prototype.hasOwnProperty.call(container, String(item));
    return false;
  }

  private smartSort(arr: unknown[], desc = false): unknown[] {
    return arr.sort((a, b) => {
      const res = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      return desc ? -res : res;
    });
  }

  private shuffleArray(arr: unknown[]): unknown[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // Pointer & C++ Memory Management helpers
  private nextAddrCounter = 0x1000;

  private nextHexAddr(): string {
    this.nextAddrCounter += 8;
    return '0x7ff' + this.nextAddrCounter.toString(16).padStart(8, '0');
  }

  private getBrowserLocation(): Record<string, string> {
    const loc = typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location : null;
    return {
      href: loc ? String(loc.href || 'about:blank') : 'about:blank',
      pathname: loc ? String(loc.pathname || '/') : '/',
      hostname: loc ? String(loc.hostname || 'localhost') : 'localhost',
      origin: loc ? String(loc.origin || 'null') : 'null',
      protocol: loc ? String(loc.protocol || 'http:') : 'http:',
      search: loc ? String(loc.search || '') : '',
      hash: loc ? String(loc.hash || '') : '',
    };
  }

  private async resolveLValueRef(
    target: ExpressionNode,
    env: Environment
  ): Promise<{ getter: () => unknown; setter?: (v: unknown) => void; label: string }> {
    if (target.kind === 'Identifier') {
      const owner = env.findOwner(target.name) ?? env;
      const name = target.name;
      return {
        label: name,
        getter: () => owner.get(name),
        setter: (v) => owner.assign(name, v),
      };
    }
    if (target.kind === 'MemberExpression') {
      if (this.isBlockedProperty(target.property)) {
        throw new Error(`SecurityError: Access to '${target.property}' is blocked in sandbox`);
      }
      const obj = (await this.evalExpr(target.object, env)) as Record<string, unknown>;
      const prop = target.property;
      return {
        label: prop,
        getter: () => this.readMember(obj, prop),
        setter: (v) => {
          const targetObj = obj && (obj as unknown as EjsInstance).__isEjsInstance
            ? (obj as unknown as EjsInstance).fields
            : obj;
          targetObj[prop] = v;
        },
      };
    }
    if (target.kind === 'IndexExpression') {
      const obj = (await this.evalExpr(target.object, env)) as Record<string, unknown>;
      const idx = await this.evalExpr(target.index, env);
      const key = String(idx);
      if (this.isBlockedProperty(key)) {
        throw new Error(`SecurityError: Access to '${key}' is blocked in sandbox`);
      }
      return {
        label: `[${key}]`,
        getter: () => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined),
        setter: (v) => {
          obj[key] = v;
        },
      };
    }
    if (target.kind === 'PointerExpression' && target.op === 'deref') {
      const ptr = (await this.evalExpr(target.argument, env)) as Record<string, unknown>;
      return {
        label: `*${String(ptr?.name ?? 'ptr')}`,
        getter: () => this.derefPointer(ptr),
        setter: (v) => this.setDerefPointer(ptr, v),
      };
    }
    const snapshotVal = await this.evalExpr(target, env);
    return { label: 'val', getter: () => snapshotVal };
  }

  private async makeAddrPtr(
    targetExpr: ExpressionNode,
    env: Environment,
    name = 'ptr',
    isConst = false
  ): Promise<Record<string, unknown>> {
    const lval = await this.resolveLValueRef(targetExpr, env);
    const addr = this.nextHexAddr();
    this.pointerEvents.push({ op: 'addr', name, state: 'active', detail: addr });
    const ptrObj = {
      __ptrKind: 'ptr',
      name,
      addr,
      alive: true,
      moved: false,
      isConst,
      offset: 0,
      get() {
        if (!this.alive) throw new Error(`NullPointerError: Dereference of freed/null pointer '${this.name}'`);
        if (this.moved) throw new Error(`RuntimeRuleError: Dereference of moved pointer '${this.name}'`);
        return lval.getter();
      },
      set(v: unknown) {
        if (!this.alive) throw new Error(`NullPointerError: Write to freed/null pointer '${this.name}'`);
        if (this.isConst) throw new Error(`RuntimeRuleError: Cannot modify value through const pointer '${this.name}'`);
        if (!lval.setter) throw new Error(`RuntimeRuleError: Pointer '${this.name}' has no mutable backing target`);
        lval.setter(v);
        return v;
      },
      toString() {
        return `<ptr ${this.name} @ ${this.addr}: ${formatVal(this.get())}>`;
      },
    };
    return ptrObj;
  }

  private allocSingle(val: unknown = null, typeName = 'T'): Record<string, unknown> {
    const addr = this.nextHexAddr();
    const label = `heap<${typeName}>`;
    this.pointerEvents.push({ op: 'new', name: label, state: 'active', detail: addr });
    return {
      __ptrKind: 'ptr',
      __heapAllocated: true,
      __typeName: typeName,
      name: label,
      addr,
      alive: true,
      moved: false,
      isConst: false,
      value: val,
      get() {
        if (!this.alive) throw new Error(`NullPointerError: Use after delete on '${this.name}'`);
        return this.value;
      },
      set(v: unknown) {
        if (!this.alive) throw new Error(`NullPointerError: Write after delete on '${this.name}'`);
        this.value = v;
        return v;
      },
      free() {
        if (!this.alive) throw new Error(`RuntimeRuleError: Double delete on '${this.name}'`);
        this.alive = false;
        this.value = undefined;
      },
    };
  }

  private allocArray(count: number, typeName = 'T'): Record<string, unknown> {
    const n = Math.max(0, Math.trunc(Number(count) || 0));
    const fill = ['int', 'float', 'number', 'double', 'long', 'short'].includes(typeName)
      ? 0
      : ['str', 'string', 'text'].includes(typeName)
        ? ''
        : typeName === 'bool' || typeName === 'boolean'
          ? false
          : null;
    const buf = Array.from({ length: n }, () => fill);
    const addr = this.nextHexAddr();
    const label = `heap<${typeName}[${n}]>`;
    this.pointerEvents.push({ op: 'new[]', name: label, state: 'active', detail: addr });
    const makeSlice = (offset: number): Record<string, unknown> => ({
      __ptrKind: 'ptr',
      __heapAllocated: true,
      __isArray: true,
      __heapArray: buf,
      __typeName: typeName,
      offset,
      name: label,
      addr,
      alive: true,
      moved: false,
      isConst: false,
      get() {
        if (!this.alive) throw new Error(`NullPointerError: Use after delete[] on '${this.name}'`);
        return (this.__heapArray as unknown[])[Number(this.offset)];
      },
      set(v: unknown) {
        if (!this.alive) throw new Error(`NullPointerError: Write after delete[] on '${this.name}'`);
        (this.__heapArray as unknown[])[Number(this.offset)] = v;
        return v;
      },
      offsetPtr(delta: number) {
        return makeSlice(Number(this.offset) + Math.trunc(Number(delta) || 0));
      },
      free() {
        if (!this.alive) throw new Error(`RuntimeRuleError: Double delete[] on '${this.name}'`);
        this.alive = false;
        (this.__heapArray as unknown[]).length = 0;
      },
    });
    return makeSlice(0);
  }

  private evalSizeof(vOrType: unknown): number {
    if (typeof vOrType === 'string') {
      if (vOrType.includes('*') || vOrType.includes('&')) return 8;
      switch (vOrType) {
        case 'bool': case 'boolean': case 'char': return 1;
        case 'short': return 2;
        case 'int': case 'float': return 4;
        case 'double': case 'long': case 'number': case 'ptr': return 8;
        case 'str': case 'string': case 'text': return 24;
        default: return 8;
      }
    }
    if (vOrType === null || vOrType === undefined) return 8;
    if (typeof vOrType === 'boolean') return 1;
    if (typeof vOrType === 'number') return Number.isInteger(vOrType) ? 4 : 8;
    if (typeof vOrType === 'string') return vOrType.length;
    if (Array.isArray(vOrType)) return vOrType.length * 8;
    if (typeof vOrType === 'object') {
      const o = vOrType as Record<string, unknown>;
      if (Array.isArray(o.__heapArray)) return o.__heapArray.length * 8;
      if (o.__ptrKind) return 8;
      return Object.keys(o).length * 8;
    }
    return 8;
  }

  private makeUnique(val: unknown, name = 'unique_ptr'): Record<string, unknown> {
    const addr = this.nextHexAddr();
    this.pointerEvents.push({ op: 'unique_ptr', name, state: 'active', detail: addr });
    return {
      __ptrKind: 'unique',
      name,
      addr,
      value: val,
      alive: true,
      moved: false,
      get() {
        if (!this.alive) throw new Error(`NullPointerError: Dereference of reset/deleted unique_ptr '${this.name}'`);
        if (this.moved) throw new Error(`RuntimeRuleError: Use of moved unique_ptr '${this.name}'`);
        return this.value;
      },
      set(v: unknown) {
        if (!this.alive || this.moved) throw new Error(`RuntimeRuleError: Invalid write on unique_ptr '${this.name}'`);
        this.value = v;
        return v;
      },
      release() {
        const out = this.value;
        this.value = null;
        this.alive = false;
        return out;
      },
      reset(nextVal?: unknown) {
        if (nextVal === undefined) {
          this.alive = false;
          this.value = undefined;
        } else {
          this.alive = true;
          this.moved = false;
          this.value = nextVal;
        }
      },
    };
  }

  private makeWeak(sharedPtr: unknown, name = 'weak_ptr'): Record<string, unknown> {
    interface WeakTarget {
      name?: unknown;
      alive?: unknown;
      refCount?: unknown;
      clone?: () => unknown;
    }
    const target = (sharedPtr && typeof sharedPtr === 'object' ? sharedPtr : null) as WeakTarget | null;
    this.pointerEvents.push({ op: 'weak_ptr', name, state: 'active', detail: target ? `-> ${target.name}` : 'empty' });
    const weakObj = {
      __ptrKind: 'weak',
      name,
      target,
      alive: true,
      moved: false,
      expired(): boolean {
        return !this.alive || !this.target || !this.target.alive || Number(this.target.refCount) <= 0;
      },
      use_count(): number {
        return this.expired() ? 0 : Number(this.target!.refCount);
      },
      lock(): unknown {
        if (this.expired()) return null;
        return typeof this.target!.clone === 'function' ? this.target!.clone() : sharedPtr;
      },
      reset(): void {
        this.alive = false;
        this.target = null;
      },
    };
    return weakObj;
  }

  private makeOwn(value: unknown, name = 'own') {
    const cell = { __ptrKind: 'own', name, value, alive: true, moved: false };
    this.pointerEvents.push({ op: 'own', name, state: 'active', detail: formatVal(value) });
    return cell;
  }

  private makeShared(value: unknown, name = 'shared') {
    const events = this.pointerEvents;
    const addr = this.nextHexAddr();
    const cell = {
      __ptrKind: 'shared',
      name,
      addr,
      value,
      alive: true,
      moved: false,
      refCount: 1,
      get() {
        if (!this.alive) throw new Error(`NullPointerError: Dereference of released shared_ptr '${this.name}'`);
        return this.value;
      },
      set(v: unknown) {
        if (!this.alive) throw new Error(`NullPointerError: Write to released shared_ptr '${this.name}'`);
        this.value = v;
        return v;
      },
      clone() {
        if (!this.alive) throw new Error(`RuntimeRuleError: Cannot clone dropped shared pointer '${this.name}'`);
        this.refCount += 1;
        events.push({ op: 'clone', name: this.name, state: 'active', detail: `refCount=${this.refCount}` });
        return this;
      },
      count() {
        return this.refCount;
      },
      use_count() {
        return this.refCount;
      },
      reset() {
        this.refCount = Math.max(0, this.refCount - 1);
        if (this.refCount === 0) {
          this.alive = false;
          this.value = undefined;
        }
      },
    };
    this.pointerEvents.push({ op: 'shared', name, state: 'active', detail: 'refCount=1' });
    return cell;
  }

  private makeBorrow(target: unknown, name = 'ref') {
    const t = target as Record<string, unknown> | null;
    if (t && t.__ptrKind) {
      if (!t.alive) throw new Error(`RuntimeRuleError: Cannot borrow dropped pointer '${t.name}'`);
      if (t.moved) throw new Error(`RuntimeRuleError: Cannot borrow moved pointer '${t.name}'`);
      this.pointerEvents.push({ op: 'borrow', name, state: 'borrowed', detail: `-> ${t.name}` });
      return { __ptrKind: 'ref', name, target: t, alive: true, moved: false };
    }
    const box = { __ptrKind: 'own', name: 'target', value: target, alive: true, moved: false };
    return { __ptrKind: 'ref', name, target: box, alive: true, moved: false };
  }

  private movePointer(ptr: unknown, newName = 'moved') {
    const p = ptr as Record<string, unknown> | null;
    if (!p || (p.__ptrKind !== 'own' && p.__ptrKind !== 'unique')) return ptr;
    if (!p.alive) throw new Error(`RuntimeRuleError: Cannot move dropped pointer '${p.name}'`);
    if (p.moved) throw new Error(`RuntimeRuleError: Cannot move '${p.name}' twice`);
    const val = p.value;
    p.moved = true;
    p.value = undefined;
    this.pointerEvents.push({ op: 'move', name: String(p.name), state: 'moved', detail: `-> ${newName}` });
    return p.__ptrKind === 'unique'
      ? this.makeUnique(val, newName)
      : { __ptrKind: 'own', name: newName, value: val, alive: true, moved: false };
  }

  private derefPointer(ptr: unknown): unknown {
    const p = ptr as Record<string, unknown> | null;
    if (!p || !p.__ptrKind) return ptr;
    if (p.__ptrKind === 'ref') {
      const t = p.target as Record<string, unknown>;
      if (!t.alive) throw new Error(`RuntimeRuleError: Dangling borrow '${p.name}' (owner dropped)`);
      if (t.moved) throw new Error(`RuntimeRuleError: Dangling borrow '${p.name}' (owner moved)`);
      return t.value;
    }
    if ((p.__ptrKind === 'ptr' || p.__ptrKind === 'unique') && typeof p.get === 'function') {
      return (p.get as () => unknown)();
    }
    if (!p.alive) throw new Error(`RuntimeRuleError: Dereference of dropped pointer '${p.name}'`);
    if (p.moved) throw new Error(`RuntimeRuleError: Dereference of moved pointer '${p.name}'`);
    return p.value;
  }

  private setDerefPointer(ptr: unknown, val: unknown): void {
    const p = ptr as Record<string, unknown> | null;
    if (!p || !p.__ptrKind) throw new Error('RuntimeRuleError: Cannot dereference-assign non-pointer');
    if (p.__ptrKind === 'ref') throw new Error(`RuntimeRuleError: Cannot mutate through immutable rule reference '${p.name}'`);
    if ((p.__ptrKind === 'ptr' || p.__ptrKind === 'unique') && typeof p.set === 'function') {
      (p.set as (v: unknown) => unknown)(val);
      return;
    }
    if (!p.alive) throw new Error(`RuntimeRuleError: Write to dropped pointer '${p.name}'`);
    if (p.moved) throw new Error(`RuntimeRuleError: Write to moved pointer '${p.name}'`);
    p.value = val;
  }

  private dropPointer(ptr: unknown, isArrayDelete = false): void {
    const p = ptr as Record<string, unknown> | null;
    if (!p || !p.__ptrKind) return;
    if (p.__ptrKind === 'shared') {
      p.refCount = Math.max(0, Number(p.refCount) - 1);
      if (p.refCount === 0) {
        p.alive = false;
        p.value = undefined;
      }
      this.pointerEvents.push({
        op: 'drop',
        name: String(p.name),
        state: p.alive ? 'active' : 'dropped',
        detail: `refCount=${p.refCount}`,
      });
      return;
    }
    if (p.__ptrKind === 'ptr') {
      if (!p.alive) throw new Error(`RuntimeRuleError: Double delete on '${p.name}'`);
      if (typeof p.free === 'function') {
        (p.free as () => void)();
      } else {
        p.alive = false;
      }
      this.pointerEvents.push({
        op: isArrayDelete ? 'delete[]' : 'delete',
        name: String(p.name),
        state: 'dropped',
        detail: String(p.addr || 'freed'),
      });
      return;
    }
    if (!p.alive) throw new Error(`RuntimeRuleError: Double drop on '${p.name}'`);
    p.alive = false;
    p.value = undefined;
    this.pointerEvents.push({ op: 'drop', name: String(p.name), state: 'dropped', detail: 'released' });
  }

  private loadModule(path: string): Record<string, unknown> {
    const cleaned = String(path).trim().replace(/^(\.\/|@)/, '');
    const key = cleaned.startsWith('stdlib/') ? cleaned : `stdlib/${cleaned}`;
    const env = this.globalEnv;
    const modules: Record<string, Record<string, unknown>> = {
      'stdlib/math': {
        PI: Math.PI,
        E: Math.E,
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        log: Math.log,
        exp: Math.exp,
        sqrt: Math.sqrt,
        pow: Math.pow,
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        hypot: Math.hypot,
        clamp: (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi),
        lerp: (a: number, b: number, t: number) => a + (b - a) * t,
        factorial: (n: number) => {
          let r = 1;
          for (let i = 2; i <= n; i++) r *= i;
          return r;
        },
        isPrime: (n: number) => {
          if (n < 2) return false;
          for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
          return true;
        },
        gcd: (a: number, b: number) => {
          let x = Math.abs(a), y = Math.abs(b);
          while (y !== 0) { const t = y; y = x % y; x = t; }
          return x;
        },
      },
      'stdlib/json': {
        parse: (s: unknown) => JSON.parse(String(s)),
        stringify: (v: unknown) => JSON.stringify(v),
        pretty: (v: unknown) => JSON.stringify(v, null, 2),
      },
      'stdlib/regex': {
        test: (p: string, t: string, f = '') => new RegExp(p, f).test(String(t)),
        match: (p: string, t: string, f = '') => String(t).match(new RegExp(p, f)),
        matchAll: (p: string, t: string) => [...String(t).matchAll(new RegExp(p, 'g'))].map((m) => m[0]),
        replace: (p: string, t: string, r: string) => String(t).replace(new RegExp(p, 'g'), r),
      },
      'stdlib/crypto': {
        uuid: () =>
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2),
        hash: (text: unknown) => {
          let h = 2166136261;
          const s = String(text);
          for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(16).padStart(8, '0');
        },
        base64Encode: (s: unknown) => btoa(String(s)),
        base64Decode: (s: unknown) => atob(String(s)),
      },
      'stdlib/datetime': {
        now: () => new Date().toISOString(),
        today: () => new Date().toISOString().slice(0, 10),
        timestamp: () => Date.now(),
      },
      'stdlib/db': env.get('db') as Record<string, unknown>,
      'stdlib/server': env.get('server') as Record<string, unknown>,
      'stdlib/ui': env.get('ui') as Record<string, unknown>,
      'stdlib/http': env.get('http') as Record<string, unknown>,
      'stdlib/stack': env.get('stack') as Record<string, unknown>,
      'stdlib/yourgui': env.get('yourgui') as Record<string, unknown>,
      yourgui: env.get('yourgui') as Record<string, unknown>,
    };
    if (modules[cleaned]) return modules[cleaned];
    if (modules[key]) return modules[key];
    throw new Error(`ModuleNotFoundError: Cannot import module '${path}'`);
  }

  private installStdlib(env: Environment): void {
    const def = (name: string, val: unknown) => env.define(name, val, false, 'stdlib');

    const readInputRaw = async (promptText = ''): Promise<string> => {
      if (this.stdinQueue.length > 0) {
        const val = String(this.stdinQueue.shift());
        this.options.onEcho?.(promptText, val);
        return val;
      }
      if (this.options.onInput) {
        return await this.options.onInput(String(promptText));
      }
      return '';
    };

    const emitVisual = (item: VisualOutputItem) => {
      this.visualOutputs.push(item);
      this.options.onVisual?.(item);
      return item;
    };

    // Built-in yourgui frontend framework + global UI shorthands
    const ygNs = this.yourgui.createNamespace();
    def('yourgui', ygNs);
    for (const helper of [
      'button', 'text', 'heading', 'image', 'link', 'textarea', 'checkbox', 'radio',
      'video', 'audio', 'select', 'option', 'section', 'container', 'line',
      'row', 'column', 'grid', 'form',
      'dom', 'byId', 'getById', 'selectId', 'render', 'mount',
      'onClick', 'onInput', 'onChange', 'onSubmit', 'click',
    ]) {
      def(helper, ygNs[helper]);
    }

    // Core I/O
    def('print', (...args: unknown[]) => {
      const text = args.map(formatVal).join(' ');
      this.emitLog(text);
      return text;
    });
    def('println', (...args: unknown[]) => {
      const text = args.map(formatVal).join(' ');
      this.emitLog(text);
      return text;
    });
    def('write', (...args: unknown[]) => {
      const text = args.map(formatVal).join(' ');
      this.emitLog(text);
      return text;
    });

    // Browser Popups with Exact JavaScript Behavior
    def('alert', async (msg: unknown = '') => {
      const text = msg === undefined ? '' : formatVal(msg);
      if (this.options.onAlert) {
        await this.options.onAlert(text);
      } else {
        this.emitLog(`[alert] ${text}`);
      }
      return undefined;
    });

    def('confirm', async (msg: unknown = '') => {
      const text = msg === undefined ? '' : formatVal(msg);
      if (this.stdinQueue.length > 0) {
        const val = String(this.stdinQueue.shift()).trim().toLowerCase();
        this.options.onEcho?.(text, val);
        return ['y', 'yes', 'true', '1', 'ok'].includes(val);
      }
      if (this.options.onConfirm) {
        return await this.options.onConfirm(text);
      }
      const raw = await readInputRaw(text);
      return ['y', 'yes', 'true', '1', 'ok'].includes(raw.trim().toLowerCase());
    });

    def('prompt', async (msg: unknown = '', defaultValue: unknown = '') => {
      const text = msg === undefined ? '' : formatVal(msg);
      const defVal = defaultValue === undefined || defaultValue === null ? '' : String(defaultValue);
      if (this.stdinQueue.length > 0) {
        const next = this.stdinQueue.shift();
        const res = next === undefined ? null : String(next);
        this.options.onEcho?.(text, res === null ? '(cancelled)' : res);
        return res;
      }
      if (this.options.onPrompt) {
        return await this.options.onPrompt(text, defVal);
      }
      return await readInputRaw(text);
    });

    def('input', (p = '') => readInputRaw(String(p)));
    def('ask', (p = '') => readInputRaw(String(p)));
    def('inputInt', async (p = '') => Number.parseInt((await readInputRaw(String(p))).trim(), 10));
    def('inputFloat', async (p = '') => Number.parseFloat((await readInputRaw(String(p))).trim()));
    def('browser', (url: unknown) => {
      const target = String(url ?? '');
      this.options.onBrowser ? this.options.onBrowser(target) : this.emitLog(`[browser] ${target}`);
      return target;
    });
    def('copy', async (text: unknown) => {
      const value = formatVal(text);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(value); return true; } catch { /* ignore */ }
      }
      this.emitLog(`[copy] ${value}`);
      return false;
    });
    def('speak', (text: unknown) => {
      const value = formatVal(text);
      this.emitLog(`[speak] ${value}`);
      return true;
    });
    def('listen', async (p = 'Listening: ') => readInputRaw(String(p)));
    def('fetch', async (url: unknown, opts?: RequestInit) => {
      const raw = String(url ?? '');
      let parsed: URL;
      try {
        parsed = new URL(raw, 'https://sandbox.invalid');
      } catch {
        throw new Error(`SecurityError: Invalid fetch URL '${raw}'`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`SecurityError: Blocked fetch protocol '${parsed.protocol}' in sandbox`);
      }
      const res = await globalThis.fetch(parsed.toString(), opts);
      const ct = res.headers?.get?.('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    });

    // Strings & Collections (18-34)
    def('uppercase', (s: unknown) => String(s).toUpperCase());
    def('upper', (s: unknown) => String(s).toUpperCase());
    def('lowercase', (s: unknown) => String(s).toLowerCase());
    def('lower', (s: unknown) => String(s).toLowerCase());
    def('trim', (s: unknown) => String(s).trim());
    def('split', (s: unknown, sep = ' ') => String(s).split(String(sep)));
    def('join', (arr: unknown[], sep = ', ') => arr.join(String(sep)));
    def('replace', (s: unknown, a: string, b: string) => String(s).split(a).join(b));
    def('reverse', (x: unknown) => (typeof x === 'string' ? x.split('').reverse().join('') : [...(x as unknown[])].reverse()));
    def('contains', (col: unknown, val: unknown) => this.hasMember(col, val));
    def('length', (x: unknown) => (Array.isArray(x) || typeof x === 'string' ? x.length : typeof x === 'object' && x ? Object.keys(x).length : 0));
    def('len', env.get('length'));
    def('push', (col: unknown, val: unknown) => this.callObjectMethod(col, 'push', [val], 0));
    def('append', (arr: unknown[], val: unknown) => { arr.push(val); return arr; });
    def('pop', (col: unknown) => this.callObjectMethod(col, 'pop', [], 0));
    def('remove', (col: unknown, val: unknown) => this.callObjectMethod(col, 'remove', [val], 0));
    def('sort', (arr: unknown[], desc = false) => this.smartSort(arr, Boolean(desc)));
    def('shuffle', (arr: unknown[]) => this.shuffleArray(arr));
    def('find', (col: unknown, pred: unknown) => this.callObjectMethod(col, 'find', [pred], 0));
    def('filter', async (arr: unknown[], fn: unknown) => {
      const out: unknown[] = [];
      for (const el of arr) if (this.isTruthy(await this.invokeCallableValue(fn, [el], 0))) out.push(el);
      return out;
    });
    def('map', async (arr: unknown[], fn: unknown) => {
      const out: unknown[] = [];
      for (const el of arr) out.push(await this.invokeCallableValue(fn, [el], 0));
      return out;
    });
    def('reduce', async (arr: unknown[], fn: unknown, init: unknown) => {
      let acc = init;
      for (const el of arr) acc = await this.invokeCallableValue(fn, [acc, el], 0);
      return acc;
    });
    def('unique', (arr: unknown[]) => [...new Set(arr)]);
    def('first', (arr: unknown[]) => arr[0] ?? null);
    def('last', (arr: unknown[]) => arr[arr.length - 1] ?? null);
    def('keys', (o: object) => Object.keys(o || {}));
    def('values', (o: object) => Object.values(o || {}));
    def('entries', (o: object) => Object.entries(o || {}));
    def('sum', (arr: number[]) => arr.reduce((a, b) => a + b, 0));
    def('avg', (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0));
    def('take', (arr: unknown[], n: number) => arr.slice(0, n));
    def('range', (start: number, end: number, inc = false) => {
      const out: number[] = [];
      for (let i = start; i < (inc ? end + 1 : end); i++) out.push(i);
      return out;
    });

    // Math & Conversions
    def('toInt', (x: unknown) => Number.parseInt(String(x), 10));
    def('int', env.get('toInt'));
    def('toFloat', (x: unknown) => Number.parseFloat(String(x)));
    def('float', env.get('toFloat'));
    def('toStr', (x: unknown) => formatVal(x));
    def('str', env.get('toStr'));
    def('toText', env.get('toStr'));
    def('toBool', (x: unknown) => Boolean(x));
    def('typeOf', inferRuntimeType);
    def('assert', (c: unknown, m = 'Assertion failed') => { if (!c) throw new Error('AssertionError: ' + m); return true; });
    def('abs', Math.abs);
    def('round', Math.round);
    def('floor', Math.floor);
    def('ceil', Math.ceil);
    def('sqrt', Math.sqrt);
    def('pow', Math.pow);
    def('min', (...xs: unknown[]) => (xs.length === 1 && Array.isArray(xs[0]) ? Math.min(...(xs[0] as number[])) : Math.min(...(xs as number[]))));
    def('max', (...xs: unknown[]) => (xs.length === 1 && Array.isArray(xs[0]) ? Math.max(...(xs[0] as number[])) : Math.max(...(xs as number[]))));
    def('clamp', (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi));
    def('random', (a?: number, b?: number) => {
      if (a === undefined && b === undefined) return Math.random();
      if (b === undefined) return Math.floor(Math.random() * ((a ?? 1) + 1));
      return Math.floor(Math.random() * (b - (a ?? 0) + 1)) + (a ?? 0);
    });
    def('randInt', env.get('random'));

    // Extra Utility Helpers
    def('slugify', (s: unknown) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    def('capitalize', (s: unknown) => { const st = String(s); return st ? st[0].toUpperCase() + st.slice(1) : ''; });
    def('truncate', (s: unknown, n = 40) => { const st = String(s); return st.length > n ? st.slice(0, n - 3) + '...' : st; });
    def('chunk', (arr: unknown[], sz = 2) => {
      const out: unknown[][] = [];
      for (let i = 0; i < arr.length; i += Math.max(1, sz)) out.push(arr.slice(i, i + Math.max(1, sz)));
      return out;
    });
    def('zip', (a: unknown[], b: unknown[]) => a.map((v, i) => [v, b[i] ?? null]));
    def('deepClone', (v: unknown) => JSON.parse(JSON.stringify(v)));
    def('formatCurrency', (n: number, sym = '$') => `${sym}${Number(n).toFixed(2)}`);
    def('percent', (p: number, t: number) => (t === 0 ? '0%' : `${((p / t) * 100).toFixed(1)}%`));

    // System & Filesystem (35-46)
    def('sleep', (ms = 100) => new Promise((resolve) => {
      const id = setTimeout(() => { this.activeTimeouts.delete(id); resolve(true); }, ms);
      this.activeTimeouts.add(id);
    }));
    def('time', () => {
      const d = new Date();
      return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    });
    def('date', () => new Date().toISOString().slice(0, 10));
    def('timer', (sec: number, cb?: unknown) => {
      const ms = sec > 60 ? sec : sec * 1000;
      if (cb) {
        const id = setTimeout(() => { this.activeTimeouts.delete(id); void this.invokeCallableValue(cb, [], 0); }, ms);
        this.activeTimeouts.add(id);
        return { cancel: () => { clearTimeout(id); this.activeTimeouts.delete(id); } };
      }
      return new Promise((r) => setTimeout(() => r(true), ms));
    });
    def('interval', (ms: number, cb?: unknown) => {
      if (!cb) return { stop: () => {} };
      const id = setInterval(() => { void this.invokeCallableValue(cb, [], 0); }, ms);
      this.activeIntervals.add(id);
      return { stop: () => { clearInterval(id); this.activeIntervals.delete(id); } };
    });
    def('stop', () => { this.cleanupTimers(); throw new ExitSignal('Stopped by stop()'); });
    def('exit', () => { this.cleanupTimers(); throw new ExitSignal('Exited by exit()'); });
    def('readFile', (p: unknown) => {
      const k = String(p);
      if (this.memoryVfs.has(k)) return this.memoryVfs.get(k);
      throw new Error(`FileNotFoundError: '${k}' does not exist`);
    });
    def('writeFile', (p: unknown, c: unknown = '') => {
      const k = String(p);
      const data = formatVal(c);
      this.memoryVfs.set(k, data);
      return true;
    });
    def('deleteFile', (p: unknown) => {
      const k = String(p);
      return this.memoryVfs.delete(k);
    });
    def('download', (name: unknown, content: unknown = '') => {
      this.emitLog(`[download] ${String(name)} (${formatVal(content).length} bytes)`);
      return true;
    });

    // Data Structures & Stack Library
    def('Stack', (init: unknown[] = []) => new EjsStack(init));
    def('Queue', (init: unknown[] = []) => new EjsQueue(init));
    def('Dict', (init: Record<string, unknown> = {}) => ({ ...init }));
    def('List', (...items: unknown[]) => (items.length === 1 && Array.isArray(items[0]) ? [...items[0]] : items));
    def('Set', (init: unknown[] = []) => new Set(init));
    def('stack', {
      array: (...items: unknown[]) => (items.length === 1 && Array.isArray(items[0]) ? [...items[0]] : items),
      list: (count = 0, fill: unknown = null) => Array.from({ length: count }, (_, i) => (typeof fill === 'function' ? fill(i) : fill)),
      dict: (a?: unknown, b?: unknown) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < Math.min(a.length, b.length); i++) obj[String(a[i])] = b[i];
          return obj;
        }
        return typeof a === 'object' && a ? { ...(a as object) } : {};
      },
      zip: (k: unknown[], v: unknown[]) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < Math.min(k.length, v.length); i++) obj[String(k[i])] = v[i];
        return obj;
      },
      merge: (...dicts: object[]) => Object.assign({}, ...dicts),
      range: (s: number, e: number, step = 1) => {
        const out: number[] = [];
        for (let i = s; step > 0 ? i < e : i > e; i += step) out.push(i);
        return out;
      },
      lifo: (init: unknown[] = []) => new EjsStack(init),
      fifo: (init: unknown[] = []) => new EjsQueue(init),
      set: (init: unknown[] = []) => new Set(init),
    });

    // Built-in DB (isolated sandbox memory), HTTP Server, Visual UI, Package Manager
    const loadTable = (t: string) => {
      if (this.memoryDb.has(t)) return this.memoryDb.get(t)!;
      const empty: Array<Record<string, unknown>> = [];
      this.memoryDb.set(t, empty);
      return empty;
    };
    const saveTable = (t: string, rows: Array<Record<string, unknown>>) => {
      this.memoryDb.set(t, rows);
    };
    def('db', {
      save: (table: string, rec: Record<string, unknown>) => {
        const rows = loadTable(String(table));
        const copy = { ...rec };
        if (copy.id === undefined) copy.id = rows.length + 1;
        rows.push(copy);
        saveTable(String(table), rows);
        return copy;
      },
      insert: (table: string, rec: Record<string, unknown>) => (env.get('db') as { save: (t: string, r: Record<string, unknown>) => unknown }).save(table, rec),
      all: (table: string) => loadTable(String(table)).map((r) => ({ ...r })),
      find: async (table: string, query?: unknown) => {
        const rows = loadTable(String(table));
        if (query === undefined) return rows.map((r) => ({ ...r }));
        if (typeof query === 'function' || (query && (query as EjsCallable).__isEjsFn)) {
          const out: Array<Record<string, unknown>> = [];
          for (const r of rows) {
            if (this.isTruthy(await this.invokeCallableValue(query, [r], 0))) out.push({ ...r });
          }
          return out;
        }
        if (typeof query === 'object' && query !== null) {
          const entries = Object.entries(query);
          return rows.filter((r) => entries.every(([k, v]) => r[k] === v)).map((r) => ({ ...r }));
        }
        return rows.filter((r) => r.id === query).map((r) => ({ ...r }));
      },
      update: (table: string, id: unknown, patch: Record<string, unknown>) => {
        const rows = loadTable(String(table));
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) return null;
        rows[idx] = { ...rows[idx], ...patch };
        saveTable(String(table), rows);
        return { ...rows[idx] };
      },
      delete: (table: string, id: unknown) => {
        const rows = loadTable(String(table));
        const next = rows.filter((r) => r.id !== id);
        saveTable(String(table), next);
        return rows.length !== next.length;
      },
      clear: (table: string) => { saveTable(String(table), []); return true; },
      count: (table: string) => loadTable(String(table)).length,
    });

    def('server', {
      get: (path: string, handler: unknown) => { this.routes.push({ method: 'GET', path: String(path), handler }); return true; },
      post: (path: string, handler: unknown) => { this.routes.push({ method: 'POST', path: String(path), handler }); return true; },
      route: (method: string, path: string, handler: unknown) => { this.routes.push({ method: String(method).toUpperCase(), path: String(path), handler }); return true; },
      request: async (method: string, path: string, body: unknown = null) => {
        const m = String(method).toUpperCase();
        const p = String(path);
        const found = this.routes.find((r) => r.method === m && r.path === p);
        if (!found) return { status: 404, body: { error: `Route ${m} ${p} not found` } };
        const result = await this.invokeCallableValue(found.handler, [{ method: m, path: p, body }], 0);
        return { status: 200, body: result };
      },
      routes: () => this.routes.map((r) => `${r.method} ${r.path}`),
      start: (port = 3000) => {
        const list = this.routes.map((r) => `${r.method} ${r.path}`);
        this.emitLog(`[server] EasyJS HTTP server listening on http://localhost:${port} (${list.join(', ') || 'no routes'})`);
        this.options.onServerStart?.(port, this.routes.map((r) => ({ method: r.method, path: r.path })));
        return { port, routes: list };
      },
      clear: () => { this.routes.length = 0; return true; },
    });

    def('ui', {
      html: (markup: unknown) => emitVisual({ kind: 'html', content: String(markup ?? '') }),
      card: (title: unknown, body: unknown, footer = '') =>
        emitVisual({ kind: 'card', title: formatVal(title), body: formatVal(body), footer: footer ? formatVal(footer) : '' }),
      table: (rows: Array<Record<string, unknown>> = [], columns?: string[]) => {
        const cols = Array.isArray(columns)
          ? columns
          : rows.length > 0 && typeof rows[0] === 'object'
            ? Object.keys(rows[0])
            : ['value'];
        return emitVisual({ kind: 'table', columns: cols, rows });
      },
      chart: (title: unknown, data: unknown[] | Record<string, number> = [], chartType = 'bar') => {
        const items = Array.isArray(data)
          ? data.map((d, i) =>
              typeof d === 'object' && d !== null
                ? { label: String((d as Record<string, unknown>).label ?? (d as Record<string, unknown>).name ?? `Item ${i + 1}`), value: Number((d as Record<string, unknown>).value ?? (d as Record<string, unknown>).y ?? 0) }
                : { label: `#${i + 1}`, value: Number(d) }
            )
          : Object.entries(data || {}).map(([k, v]) => ({ label: String(k), value: Number(v) }));
        return emitVisual({ kind: 'chart', title: formatVal(title), chartType: String(chartType), data: items });
      },
      clear: () => { this.visualOutputs.length = 0; return true; },
    });

    def('http', {
      get: (url: unknown) => (env.get('fetch') as (u: string, o?: RequestInit) => unknown)(String(url), { method: 'GET' }),
      post: (url: unknown, payload: unknown) => (env.get('fetch') as (u: string, o?: RequestInit) => unknown)(String(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      }),
    });

    def('pkg', {
      install: (name: string) => {
        const k = String(name);
        const registry: Record<string, Record<string, unknown>> = {
          validator: {
            isEmail: (s: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s)),
            isUrl: (s: unknown) => /^https?:\/\/.+/.test(String(s)),
            isNumeric: (s: unknown) => !Number.isNaN(Number(s)) && String(s).trim() !== '',
          },
          stats: {
            mean: (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0),
            median: (arr: number[]) => {
              if (!arr.length) return 0;
              const s = [...arr].sort((a, b) => a - b);
              const m = Math.floor(s.length / 2);
              return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
            },
          },
        };
        if (!registry[k]) throw new Error(`PackageError: Package '${k}' not found`);
        this.installedPkgs.set(k, registry[k]);
        this.emitLog(`[pkg] Installed ${k}`);
        return registry[k];
      },
      use: (name: string) => this.installedPkgs.get(String(name)) ?? (env.get('pkg') as { install: (n: string) => Record<string, unknown> }).install(name),
      list: () => ['validator', 'stats', 'csv', 'colors'],
      installed: () => Array.from(this.installedPkgs.keys()),
    });

    // Pointer & C++ memory builtins
    def('own', (v: unknown) => this.makeOwn(v));
    def('share', (v: unknown) => this.makeShared(v));
    def('drop', (p: unknown) => { this.dropPointer(p); return null; });
    def('make_unique', (v: unknown) => this.makeUnique(v));
    def('unique_ptr', (v: unknown) => this.makeUnique(v));
    def('make_shared', (v: unknown) => this.makeShared(v));
    def('shared_ptr', (v: unknown) => this.makeShared(v));
    def('weak_ptr', (p: unknown) => this.makeWeak(p));
    def('sizeof', (v: unknown) => this.evalSizeof(v));
    def('addressOf', (v: unknown, n = 'addr') => {
      let box = v;
      const addr = this.nextHexAddr();
      return {
        __ptrKind: 'ptr',
        name: String(n),
        addr,
        alive: true,
        moved: false,
        isConst: false,
        get: () => box,
        set: (nv: unknown) => { box = nv; return nv; },
      };
    });
    def('addr', env.get('addressOf'));
    def('browserLocation', () => this.getBrowserLocation());
    def('NULL', null);
    def('refCount', (p: unknown) => {
      const ptr = p as Record<string, unknown> | null;
      if (!ptr) return 0;
      if (ptr.__ptrKind === 'shared') return ptr.refCount;
      if (ptr.__ptrKind === 'weak') return (ptr.use_count as () => number)();
      return ptr.alive ? 1 : 0;
    });
  }
}

export async function runASTInterpreter(
  program: ProgramNode,
  options: InterpreterOptions = {}
): Promise<ExecutionResult> {
  return new ASTInterpreter(options).execute(program);
}
