/**
 * PowerScript / EasyJS Static Type Checker & Control-Flow Analyzer
 *
 * Performs:
 * - Pass 1: Signature registration for recursive functions, classes, structs, enums, traits
 * - Pass 2: Flow-sensitive type inference & narrowing (nullable T?, unions A | B)
 * - Complete function, method, constructor, and super() call validation (arity & arg types)
 * - Function return type checking & definite-return control-flow analysis
 * - Struct field validation & class member visibility (priv/prot/pub) checks
 * - Loop break/continue & unreachable-code control-flow diagnostics
 */

import type {
  BlockStatementNode,
  ClassDeclarationNode,
  ClassFieldNode,
  ClassMethodNode,
  ExpressionNode,
  FunctionDeclarationNode,
  ParamNode,
  ProgramNode,
  StatementNode,
  StructDeclarationNode,
  TypeAnnotationNode,
} from './ast/nodes.ts';
import type { CompilerDiagnostic } from './errors/compilerErrors.ts';
import type { TypeSafetyPolicy } from './security-policy.ts';

interface FunctionSignature {
  name: string;
  params: ParamNode[];
  returnType?: TypeAnnotationNode;
  inferredReturnType?: string;
}

interface ClassInfo {
  decl: ClassDeclarationNode;
  fields: Map<string, ClassFieldNode>;
  methods: Map<string, ClassMethodNode>;
  ctor?: ClassMethodNode;
}

interface StructInfo {
  decl: StructDeclarationNode;
  fields: Map<string, { typeAnnotation?: TypeAnnotationNode }>;
  methods: Map<string, ClassMethodNode>;
}

interface VarTypeEntry {
  annotation?: TypeAnnotationNode;
  inferred?: string;
  mutable: boolean;
  isConst: boolean;
  isPointer: boolean;
}

const STDLIB_RETURN_TYPES: Record<string, string> = {
  uppercase: 'string',
  upper: 'string',
  lowercase: 'string',
  lower: 'string',
  trim: 'string',
  replace: 'string',
  join: 'string',
  toStr: 'string',
  str: 'string',
  toText: 'string',
  date: 'string',
  time: 'string',
  readFile: 'string',
  input: 'string',
  ask: 'string',
  prompt: 'string',
  slugify: 'string',
  capitalize: 'string',
  truncate: 'string',
  formatCurrency: 'string',
  percent: 'string',
  length: 'int',
  len: 'int',
  toInt: 'int',
  int: 'int',
  inputInt: 'int',
  random: 'int',
  randInt: 'int',
  round: 'int',
  floor: 'int',
  ceil: 'int',
  refCount: 'int',
  toFloat: 'float',
  float: 'float',
  inputFloat: 'float',
  sqrt: 'number',
  abs: 'number',
  pow: 'number',
  min: 'number',
  max: 'number',
  clamp: 'number',
  sum: 'number',
  avg: 'number',
  contains: 'boolean',
  confirm: 'boolean',
  writeFile: 'boolean',
  deleteFile: 'boolean',
  assert: 'boolean',
  toBool: 'boolean',
  split: 'array',
  sort: 'array',
  shuffle: 'array',
  filter: 'array',
  unique: 'array',
  keys: 'array',
  values: 'array',
  entries: 'array',
  range: 'array',
  map: 'array',
  take: 'array',
  chunk: 'array',
  zip: 'array',
  Dict: 'dict',
  Stack: 'stack',
  Queue: 'queue',
  Set: 'set',
  button: 'GuiElement',
  text: 'GuiElement',
  heading: 'GuiElement',
  image: 'GuiElement',
  link: 'GuiElement',
  textarea: 'GuiElement',
  checkbox: 'GuiElement',
  radio: 'GuiElement',
  video: 'GuiElement',
  audio: 'GuiElement',
  select: 'GuiElement',
  option: 'GuiElement',
  container: 'GuiElement',
  line: 'GuiElement',
  row: 'GuiElement',
  column: 'GuiElement',
  grid: 'GuiElement',
  form: 'GuiElement',
  section: 'GuiElement',
  dom: 'GuiElement',
  byId: 'GuiElement',
  getById: 'GuiElement',
  selectId: 'GuiElement',
  addressOf: 'string',
  addr: 'string',
  browserLocation: 'dict',
};

export interface TypeCheckResult {
  success: boolean;
  diagnostics: CompilerDiagnostic[];
}

export class TypeChecker {
  private readonly policy: TypeSafetyPolicy;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly scopes: Array<Map<string, VarTypeEntry>> = [];
  private readonly functions = new Map<string, FunctionSignature>();
  private readonly classes = new Map<string, ClassInfo>();
  private readonly structs = new Map<string, StructInfo>();
  private readonly enums = new Set<string>();

  private loopDepth = 0;
  private currentClassName: string | null = null;
  private functionContextStack: Array<{
    name: string;
    returnType?: TypeAnnotationNode;
  }> = [];

  constructor(policy?: Partial<TypeSafetyPolicy>) {
    this.policy = {
      enabled: true,
      strictNullChecks: true,
      checkFunctionCalls: true,
      checkReturnTypes: true,
      checkControlFlow: true,
      checkMemberVisibility: true,
      ...(policy ?? {}),
    };
  }

  check(program: ProgramNode): TypeCheckResult {
    this.diagnostics.length = 0;
    this.scopes.length = 0;
    this.functions.clear();
    this.classes.clear();
    this.structs.clear();
    this.enums.clear();
    this.loopDepth = 0;
    this.currentClassName = null;
    this.functionContextStack = [];

    if (!this.policy.enabled) {
      return { success: true, diagnostics: [] };
    }

    // Pass 1: Pre-register all functions, classes, structs, enums (supports forward & recursive refs)
    for (const stmt of program.body) {
      this.registerTopLevelDeclaration(stmt);
    }

    // Pass 2: Validate statements & control flow
    this.pushScope();
    for (const stmt of program.body) {
      this.checkStatement(stmt);
    }
    this.popScope();

    return {
      success: !this.diagnostics.some((d) => d.severity === 'error'),
      diagnostics: [...this.diagnostics],
    };
  }

  private registerTopLevelDeclaration(stmt: StatementNode): void {
    if (stmt.kind === 'FunctionDeclaration') {
      this.functions.set(stmt.name, {
        name: stmt.name,
        params: stmt.params,
        returnType: stmt.returnType,
      });
    } else if (stmt.kind === 'ClassDeclaration') {
      const fields = new Map<string, ClassFieldNode>();
      const methods = new Map<string, ClassMethodNode>();
      let ctor: ClassMethodNode | undefined;
      for (const f of stmt.fields) fields.set(f.name, f);
      for (const m of stmt.methods) {
        if (m.isConstructor || m.name === 'init' || m.name === 'constructor') {
          ctor = m;
        }
        methods.set(m.name, m);
      }
      this.classes.set(stmt.name, { decl: stmt, fields, methods, ctor });
    } else if (stmt.kind === 'StructDeclaration') {
      const fields = new Map<string, { typeAnnotation?: TypeAnnotationNode }>();
      const methods = new Map<string, ClassMethodNode>();
      for (const f of stmt.fields) fields.set(f.name, { typeAnnotation: f.typeAnnotation });
      for (const m of stmt.methods) methods.set(m.name, m);
      this.structs.set(stmt.name, { decl: stmt, fields, methods });
    } else if (stmt.kind === 'EnumDeclaration') {
      this.enums.add(stmt.name);
    }
  }

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    if (this.scopes.length > 0) this.scopes.pop();
  }

  private cloneScopes(): Array<Map<string, VarTypeEntry>> {
    return this.scopes.map((s) => {
      const copy = new Map<string, VarTypeEntry>();
      for (const [k, v] of s.entries()) copy.set(k, { ...v });
      return copy;
    });
  }

  private restoreScopes(saved: Array<Map<string, VarTypeEntry>>): void {
    this.scopes.length = 0;
    for (const m of saved) this.scopes.push(m);
  }

  private declareVar(name: string, entry: VarTypeEntry): void {
    const top = this.scopes[this.scopes.length - 1];
    if (top) top.set(name, entry);
  }

  private lookupVar(name: string): VarTypeEntry | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v) return v;
    }
    return undefined;
  }

  private addDiagnostic(
    severity: 'error' | 'warning',
    title: string,
    message: string,
    line: number,
    column: number,
    hint?: string
  ): void {
    this.diagnostics.push({
      phase: 'transformer',
      severity,
      title,
      message,
      line,
      column,
      hint,
    });
  }

  private typeError(
    message: string,
    line: number,
    column: number,
    hint?: string
  ): void {
    this.addDiagnostic('error', 'Type Error', message, line, column, hint);
  }

  private controlFlowError(
    message: string,
    line: number,
    column: number,
    hint?: string
  ): void {
    this.addDiagnostic('error', 'Control-Flow Error', message, line, column, hint);
  }

  private normalizeTypeName(raw: string): string {
    switch (raw.trim()) {
      case 'str':
      case 'text':
      case 'string':
        return 'string';
      case 'bool':
      case 'boolean':
        return 'boolean';
      case 'list':
      case 'array':
        return 'array';
      case 'map':
      case 'dict':
        return 'dict';
      case 'none':
      case 'null':
        return 'null';
      default:
        return raw.trim();
    }
  }

  private formatAnnotation(t: TypeAnnotationNode): string {
    if (t.unionTypes && t.unionTypes.length > 0) {
      return t.unionTypes.map((u) => this.formatAnnotation(u)).join(' | ');
    }
    const base =
      t.generics.length > 0
        ? `${t.name}<${t.generics.map((g) => this.formatAnnotation(g)).join(', ')}>`
        : t.name;
    return t.nullable ? `${base}?` : base;
  }

  private isNumeric(t?: string): boolean {
    return t === 'int' || t === 'float' || t === 'number';
  }

  private isSubclassOf(subName: string, baseName: string): boolean {
    let cur = this.classes.get(subName)?.decl.superClass;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === baseName) return true;
      seen.add(cur);
      cur = this.classes.get(cur)?.decl.superClass;
    }
    return false;
  }

  private matchesAnnotation(expected: TypeAnnotationNode, actual: string): boolean {
    if (expected.unionTypes && expected.unionTypes.length > 0) {
      return expected.unionTypes.some((u) => this.matchesAnnotation(u, actual));
    }
    if (/^[A-Z]$/.test(expected.name)) return true; // Generic type param

    let actualClean = actual.trim();
    const actualIsNullable = actualClean.endsWith('?');
    if (actualIsNullable) {
      actualClean = actualClean.slice(0, -1);
    }

    const exp = this.normalizeTypeName(expected.name);
    const act = this.normalizeTypeName(actualClean);

    if (exp === 'any' || act === 'any' || exp === 'void') return true;
    if (actualIsNullable && !expected.nullable && this.policy.strictNullChecks && exp !== 'null') {
      return false;
    }
    if (act === 'null') {
      if (!this.policy.strictNullChecks) return true;
      return Boolean(expected.nullable) || exp === 'null' || exp === 'option';
    }
    if (exp === 'number') return act === 'int' || act === 'float' || act === 'number';
    if (exp === 'float') return act === 'float' || act === 'int' || act === 'number';
    if (exp === 'int') return act === 'int';
    if (exp === act) return true;
    if (this.isSubclassOf(act, exp)) return true;

    return false;
  }

  private isCompatibleTypeNames(expectedRaw: string, actualRaw: string): boolean {
    const exp = this.normalizeTypeName(expectedRaw.replace(/\?$/, ''));
    const act = this.normalizeTypeName(actualRaw.replace(/\?$/, ''));
    if (exp === 'any' || act === 'any') return true;
    if (act === 'null') return expectedRaw.endsWith('?') || exp === 'null';
    if (exp === 'number') return act === 'int' || act === 'float' || act === 'number';
    if (exp === 'float') return act === 'float' || act === 'int' || act === 'number';
    return exp === act || this.isSubclassOf(act, exp);
  }

  private resolveClassField(className: string, prop: string): { owner: string; field: ClassFieldNode } | null {
    let cur: string | undefined = className;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const info = this.classes.get(cur);
      if (!info) break;
      const f = info.fields.get(prop);
      if (f) return { owner: cur, field: f };
      cur = info.decl.superClass;
    }
    return null;
  }

  private resolveClassMethod(className: string, prop: string): { owner: string; method: ClassMethodNode } | null {
    let cur: string | undefined = className;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const info = this.classes.get(cur);
      if (!info) break;
      const m = info.methods.get(prop);
      if (m) return { owner: cur, method: m };
      cur = info.decl.superClass;
    }
    return null;
  }

  private findSuperConstructor(className: string): ClassMethodNode | undefined {
    let cur = this.classes.get(className)?.decl.superClass;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const info = this.classes.get(cur);
      if (!info) break;
      if (info.ctor) return info.ctor;
      cur = info.decl.superClass;
    }
    return undefined;
  }

  private validateCallArguments(
    calleeLabel: string,
    params: ParamNode[],
    args: ExpressionNode[],
    line: number,
    column: number
  ): void {
    if (!this.policy.checkFunctionCalls) return;

    const minArgs = params.filter((p) => !p.defaultValue).length;
    const maxArgs = params.length;

    if (args.length < minArgs || args.length > maxArgs) {
      const expectedText = minArgs === maxArgs ? `${minArgs}` : `${minArgs}..${maxArgs}`;
      this.typeError(
        `Call to '${calleeLabel}' expected ${expectedText} argument(s), but received ${args.length}.`,
        line,
        column,
        minArgs > args.length
          ? `Provide missing argument(s): ${params.slice(args.length).map((p) => p.name).join(', ')}.`
          : `Remove ${args.length - maxArgs} extra argument(s).`
      );
      return;
    }

    for (let i = 0; i < args.length; i++) {
      const param = params[i];
      const arg = args[i];
      if (!param.typeAnnotation) continue;
      // Pointer / ref params receive address/variable bindings
      if (param.typeAnnotation.isPointer || param.typeAnnotation.isReference) continue;
      if (['own', 'ref', 'shared', 'unique_ptr', 'shared_ptr', 'weak_ptr'].includes(param.typeAnnotation.name)) {
        continue;
      }

      const actualType = this.inferExprType(arg);
      if (actualType && !this.matchesAnnotation(param.typeAnnotation, actualType)) {
        this.typeError(
          `Argument '${param.name}' of '${calleeLabel}' expects '${this.formatAnnotation(param.typeAnnotation)}', but received '${actualType}'.`,
          arg.line,
          arg.column
        );
      }
    }
  }

  private applyConditionNarrowing(cond: ExpressionNode, whenTrue: boolean): void {
    // Narrow `x != null` or `x == null`
    if (cond.kind === 'BinaryExpression') {
      const isNeq = cond.operator === '!=';
      const isEq = cond.operator === '==';
      if ((isNeq || isEq) && cond.left.kind === 'Identifier' && cond.right.kind === 'Literal' && cond.right.literalType === 'null') {
        const v = this.lookupVar(cond.left.name);
        if (v?.annotation?.nullable) {
          const nonNull = (whenTrue && isNeq) || (!whenTrue && isEq);
          if (nonNull) {
            this.declareVar(cond.left.name, {
              ...v,
              annotation: { ...v.annotation, nullable: false },
              inferred: this.normalizeTypeName(v.annotation.name),
            });
          } else {
            this.declareVar(cond.left.name, {
              ...v,
              inferred: 'null',
            });
          }
        }
      }
      if (cond.operator === 'is' && whenTrue && cond.left.kind === 'Identifier' && cond.right.kind === 'Identifier') {
        const v = this.lookupVar(cond.left.name);
        if (v) {
          this.declareVar(cond.left.name, {
            ...v,
            inferred: this.normalizeTypeName(cond.right.name),
          });
        }
      }
    }
  }

  /**
   * Returns true if every control-flow path in the statement definitely exits
   * via `return` or `throw`.
   */
  private definitelyReturns(stmt: StatementNode): boolean {
    switch (stmt.kind) {
      case 'ReturnStatement':
      case 'ThrowStatement':
        return true;

      case 'BlockStatement':
      case 'ScopeStatement': {
        const stmts = stmt.kind === 'ScopeStatement' ? stmt.body.statements : stmt.statements;
        return stmts.some((s) => this.definitelyReturns(s));
      }

      case 'IfStatement': {
        if (!stmt.alternate) return false;
        if (!this.definitelyReturns(stmt.consequent)) return false;
        for (const elif of stmt.elifBranches) {
          if (!this.definitelyReturns(elif.consequent)) return false;
        }
        return this.definitelyReturns(stmt.alternate);
      }

      case 'TryCatchStatement':
        return (
          this.definitelyReturns(stmt.tryBlock) &&
          this.definitelyReturns(stmt.catchBlock)
        );

      default:
        return false;
    }
  }

  private checkBlock(block: BlockStatementNode, createScope = true): void {
    if (createScope) this.pushScope();
    let terminated = false;
    for (const stmt of block.statements) {
      if (terminated) {
        this.addDiagnostic(
          'warning',
          'Unreachable Code',
          'Unreachable statement after return, throw, break, or continue.',
          stmt.line,
          stmt.column
        );
        // Only warn once per block tail
        terminated = false;
      }
      this.checkStatement(stmt);
      if (
        stmt.kind === 'ReturnStatement' ||
        stmt.kind === 'ThrowStatement' ||
        stmt.kind === 'BreakStatement' ||
        stmt.kind === 'ContinueStatement'
      ) {
        terminated = true;
      }
    }
    if (createScope) this.popScope();
  }

  private checkStatement(stmt: StatementNode): void {
    switch (stmt.kind) {
      case 'VarDeclaration': {
        if (stmt.initializer) {
          this.checkExpression(stmt.initializer);
        }
        const isPointer = Boolean(
          stmt.pointerMode ||
            stmt.typeAnnotation?.isPointer ||
            stmt.typeAnnotation?.isReference
        );
        const inferred = stmt.initializer ? this.inferExprType(stmt.initializer) : undefined;

        if (!stmt.mutable && !stmt.initializer) {
          this.typeError(
            `Constant '${stmt.name}' must be initialized upon declaration.`,
            stmt.line,
            stmt.column
          );
        }

        if (stmt.typeAnnotation && inferred && !isPointer) {
          if (!this.matchesAnnotation(stmt.typeAnnotation, inferred)) {
            this.typeError(
              `Cannot initialize '${stmt.name}' of type '${this.formatAnnotation(stmt.typeAnnotation)}' with value of type '${inferred}'.`,
              stmt.line,
              stmt.column,
              inferred === 'null'
                ? `Use nullable type '${stmt.typeAnnotation.name}?' if null is intended.`
                : undefined
            );
          }
        }

        const declaredInferred = stmt.typeAnnotation
          ? stmt.typeAnnotation.nullable
            ? inferred === 'null'
              ? 'null'
              : `${this.normalizeTypeName(stmt.typeAnnotation.name)}?`
            : stmt.typeAnnotation.unionTypes?.length
              ? undefined
              : this.normalizeTypeName(stmt.typeAnnotation.name)
          : inferred;

        this.declareVar(stmt.name, {
          annotation: stmt.typeAnnotation,
          inferred: declaredInferred,
          mutable: stmt.mutable,
          isConst: !stmt.mutable && !isPointer,
          isPointer,
        });
        break;
      }

      case 'MultiVarDeclaration':
        for (const d of stmt.declarations) this.checkStatement(d);
        break;

      case 'FunctionDeclaration': {
        this.declareVar(stmt.name, {
          inferred: 'function',
          mutable: false,
          isConst: true,
          isPointer: false,
        });
        this.checkCallable(stmt.name, stmt.params, stmt.returnType, stmt.body, stmt.line, stmt.column);
        break;
      }

      case 'ClassDeclaration': {
        const prevClass = this.currentClassName;
        this.currentClassName = stmt.name;

        for (const f of stmt.fields) {
          if (f.initializer) {
            this.checkExpression(f.initializer);
            if (f.typeAnnotation) {
              const t = this.inferExprType(f.initializer);
              if (t && !this.matchesAnnotation(f.typeAnnotation, t)) {
                this.typeError(
                  `Field '${stmt.name}.${f.name}' of type '${this.formatAnnotation(f.typeAnnotation)}' cannot be initialized with '${t}'.`,
                  f.line,
                  f.column
                );
              }
            }
          }
        }

        for (const m of stmt.methods) {
          this.checkCallable(`${stmt.name}.${m.name}`, m.params, m.returnType, m.body, m.line, m.column);
        }

        this.currentClassName = prevClass;
        break;
      }

      case 'StructDeclaration': {
        for (const f of stmt.fields) {
          if (f.defaultValue) {
            this.checkExpression(f.defaultValue);
            if (f.typeAnnotation) {
              const t = this.inferExprType(f.defaultValue);
              if (t && !this.matchesAnnotation(f.typeAnnotation, t)) {
                this.typeError(
                  `Struct field '${stmt.name}.${f.name}' of type '${this.formatAnnotation(f.typeAnnotation)}' cannot default to '${t}'.`,
                  f.line,
                  f.column
                );
              }
            }
          }
        }
        for (const m of stmt.methods) {
          this.checkCallable(`${stmt.name}.${m.name}`, m.params, m.returnType, m.body, m.line, m.column);
        }
        break;
      }

      case 'IfStatement': {
        this.checkExpression(stmt.condition);
        const baseScopes = this.cloneScopes();

        this.pushScope();
        this.applyConditionNarrowing(stmt.condition, true);
        this.checkBlock(stmt.consequent, false);
        this.popScope();

        for (const elif of stmt.elifBranches) {
          this.restoreScopes(baseScopes);
          this.checkExpression(elif.condition);
          this.pushScope();
          this.applyConditionNarrowing(elif.condition, true);
          this.checkBlock(elif.consequent, false);
          this.popScope();
        }

        if (stmt.alternate) {
          this.restoreScopes(baseScopes);
          this.pushScope();
          this.applyConditionNarrowing(stmt.condition, false);
          this.checkBlock(stmt.alternate, false);
          this.popScope();
        }

        this.restoreScopes(baseScopes);

        // If `if (x == null) { return ... }`, narrow `x` as non-null for remaining statements
        if (this.definitelyReturns(stmt.consequent) && !stmt.alternate) {
          this.applyConditionNarrowing(stmt.condition, false);
        }
        break;
      }

      case 'ForInStatement': {
        this.checkExpression(stmt.iterable);
        this.pushScope();
        let elemType: string | undefined;
        if (stmt.iterable.kind === 'RangeExpression') {
          elemType = 'int';
        } else if (stmt.iterable.kind === 'ArrayLiteral' && stmt.iterable.elements.length > 0) {
          elemType = this.inferExprType(stmt.iterable.elements[0]);
        }
        this.declareVar(stmt.variable, {
          inferred: elemType,
          mutable: false,
          isConst: false,
          isPointer: false,
        });
        this.loopDepth += 1;
        this.checkBlock(stmt.body, false);
        this.loopDepth -= 1;
        this.popScope();
        break;
      }

      case 'CForStatement': {
        this.pushScope();
        if (stmt.init) this.checkStatement(stmt.init);
        if (stmt.condition) this.checkExpression(stmt.condition);
        if (stmt.update) this.checkExpression(stmt.update);
        this.loopDepth += 1;
        this.checkBlock(stmt.body, false);
        this.loopDepth -= 1;
        this.popScope();
        break;
      }

      case 'WhileStatement':
        this.checkExpression(stmt.condition);
        this.loopDepth += 1;
        this.checkBlock(stmt.body);
        this.loopDepth -= 1;
        break;

      case 'DoWhileStatement':
        this.loopDepth += 1;
        this.checkBlock(stmt.body);
        this.loopDepth -= 1;
        this.checkExpression(stmt.condition);
        break;

      case 'LoopStatement':
        this.loopDepth += 1;
        this.checkBlock(stmt.body);
        this.loopDepth -= 1;
        break;

      case 'RepeatStatement':
        this.checkExpression(stmt.count);
        this.loopDepth += 1;
        this.checkBlock(stmt.body);
        this.loopDepth -= 1;
        break;

      case 'BreakStatement':
        if (this.policy.checkControlFlow && this.loopDepth === 0) {
          this.controlFlowError(
            `'break' statement can only be used inside a loop.`,
            stmt.line,
            stmt.column
          );
        }
        break;

      case 'ContinueStatement':
        if (this.policy.checkControlFlow && this.loopDepth === 0) {
          this.controlFlowError(
            `'continue' statement can only be used inside a loop.`,
            stmt.line,
            stmt.column
          );
        }
        break;

      case 'ReturnStatement': {
        if (this.policy.checkControlFlow && this.functionContextStack.length === 0) {
          this.controlFlowError(
            `'return' statement cannot be used outside of a function.`,
            stmt.line,
            stmt.column
          );
          break;
        }
        if (stmt.value) {
          this.checkExpression(stmt.value);
        }
        const fnCtx = this.functionContextStack[this.functionContextStack.length - 1];
        if (this.policy.checkReturnTypes && fnCtx?.returnType) {
          const retNorm = this.normalizeTypeName(fnCtx.returnType.name);
          if (retNorm === 'void' && stmt.value) {
            this.typeError(
              `Function '${fnCtx.name}' has return type 'void' and cannot return a value.`,
              stmt.line,
              stmt.column
            );
          } else if (retNorm !== 'void' && !stmt.value) {
            this.typeError(
              `Function '${fnCtx.name}' must return a value of type '${this.formatAnnotation(fnCtx.returnType)}'.`,
              stmt.line,
              stmt.column
            );
          } else if (stmt.value && retNorm !== 'void') {
            const actualRet = this.inferExprType(stmt.value);
            if (actualRet && !this.matchesAnnotation(fnCtx.returnType, actualRet)) {
              this.typeError(
                `Return value of type '${actualRet}' is not assignable to declared return type '${this.formatAnnotation(fnCtx.returnType)}' in '${fnCtx.name}'.`,
                stmt.line,
                stmt.column
              );
            }
          }
        }
        break;
      }

      case 'TryCatchStatement':
        this.checkBlock(stmt.tryBlock);
        this.pushScope();
        if (stmt.catchVar) {
          this.declareVar(stmt.catchVar, {
            inferred: 'any',
            mutable: false,
            isConst: false,
            isPointer: false,
          });
        }
        this.checkBlock(stmt.catchBlock, false);
        this.popScope();
        break;

      case 'ThrowStatement':
        this.checkExpression(stmt.value);
        break;

      case 'DeferStatement':
        this.checkStatement(stmt.statement);
        break;

      case 'DropStatement':
        this.checkExpression(stmt.target);
        break;

      case 'BlockStatement':
        this.checkBlock(stmt);
        break;

      case 'ScopeStatement':
        this.checkBlock(stmt.body);
        break;

      case 'ExpressionStatement':
        this.checkExpression(stmt.expression);
        break;

      case 'ImportStatement':
        if (stmt.defaultImport) {
          this.declareVar(stmt.defaultImport, { inferred: 'module', mutable: false, isConst: true, isPointer: false });
        }
        if (stmt.alias) {
          this.declareVar(stmt.alias, { inferred: 'module', mutable: false, isConst: true, isPointer: false });
        }
        for (const n of stmt.namedImports) {
          this.declareVar(n, { inferred: 'any', mutable: false, isConst: false, isPointer: false });
        }
        break;

      case 'EnumDeclaration':
      case 'TraitDeclaration':
      case 'StyleStatement':
        break;
    }
  }

  private checkCallable(
    name: string,
    params: ParamNode[],
    returnType: TypeAnnotationNode | undefined,
    body: BlockStatementNode | ExpressionNode,
    line: number,
    column: number
  ): void {
    this.functionContextStack.push({ name, returnType });
    this.pushScope();
    for (const p of params) {
      if (p.defaultValue) {
        this.checkExpression(p.defaultValue);
        if (p.typeAnnotation) {
          const dt = this.inferExprType(p.defaultValue);
          if (dt && !this.matchesAnnotation(p.typeAnnotation, dt)) {
            this.typeError(
              `Default value of type '${dt}' for parameter '${p.name}' does not match '${this.formatAnnotation(p.typeAnnotation)}'.`,
              p.line,
              p.column
            );
          }
        }
      }
      this.declareVar(p.name, {
        annotation: p.typeAnnotation,
        inferred: p.typeAnnotation
          ? p.typeAnnotation.nullable
            ? `${this.normalizeTypeName(p.typeAnnotation.name)}?`
            : p.typeAnnotation.unionTypes?.length
              ? undefined
              : this.normalizeTypeName(p.typeAnnotation.name)
          : undefined,
        mutable: true,
        isConst: false,
        isPointer: Boolean(p.typeAnnotation?.isPointer || p.typeAnnotation?.isReference),
      });
    }

    if (body.kind === 'BlockStatement') {
      this.checkBlock(body, false);
      if (
        this.policy.checkControlFlow &&
        this.policy.checkReturnTypes &&
        returnType &&
        this.normalizeTypeName(returnType.name) !== 'void' &&
        this.normalizeTypeName(returnType.name) !== 'any'
      ) {
        if (!this.definitelyReturns(body)) {
          this.controlFlowError(
            `Function '${name}' declares return type '${this.formatAnnotation(returnType)}', but not all control-flow paths return a value.`,
            line,
            column,
            'Ensure every branch returns a value or throws.'
          );
        }
      }
    } else {
      this.checkExpression(body);
    }

    this.popScope();
    this.functionContextStack.pop();
  }

  private checkExpression(expr: ExpressionNode): void {
    switch (expr.kind) {
      case 'AssignmentExpression': {
        this.checkExpression(expr.value);
        if (expr.target.kind === 'Identifier') {
          const entry = this.lookupVar(expr.target.name);
          if (entry?.annotation && expr.operator === '=') {
            const actual = this.inferExprType(expr.value);
            if (actual && !this.matchesAnnotation(entry.annotation, actual)) {
              this.typeError(
                `Cannot assign '${actual}' to variable '${expr.target.name}' of type '${this.formatAnnotation(entry.annotation)}'.`,
                expr.line,
                expr.column
              );
            }
          } else if (entry && expr.operator !== '=' && ['+=', '-=', '*=', '/='].includes(expr.operator)) {
            const targetType = entry.inferred;
            const rhsType = this.inferExprType(expr.value);
            if (
              expr.operator !== '+=' &&
              targetType &&
              rhsType &&
              (!this.isNumeric(targetType) || !this.isNumeric(rhsType))
            ) {
              this.typeError(
                `Operator '${expr.operator}' cannot be applied to types '${targetType}' and '${rhsType}'.`,
                expr.line,
                expr.column
              );
            }
          }
        } else {
          this.checkExpression(expr.target);
          if (expr.target.kind === 'MemberExpression' && expr.operator === '=') {
            const objType =
              expr.target.object.kind === 'SelfExpression'
                ? this.currentClassName
                : this.inferExprType(expr.target.object);
            if (objType) {
              const resolved = this.resolveClassField(objType, expr.target.property);
              if (resolved?.field.typeAnnotation) {
                const rhsType = this.inferExprType(expr.value);
                if (rhsType && !this.matchesAnnotation(resolved.field.typeAnnotation, rhsType)) {
                  this.typeError(
                    `Cannot assign '${rhsType}' to field '${resolved.owner}.${expr.target.property}' of type '${this.formatAnnotation(resolved.field.typeAnnotation)}'.`,
                    expr.line,
                    expr.column
                  );
                }
              }
            }
          }
        }
        return;
      }

      case 'BinaryExpression': {
        this.checkExpression(expr.left);
        this.checkExpression(expr.right);
        const lt = this.inferExprType(expr.left);
        const rt = this.inferExprType(expr.right);
        if (['-', '*', '/', '%', '**'].includes(expr.operator) && lt && rt) {
          if (
            lt !== 'any' &&
            rt !== 'any' &&
            lt !== 'ptr' &&
            rt !== 'ptr' &&
            (!this.isNumeric(lt) || !this.isNumeric(rt))
          ) {
            this.typeError(
              `Arithmetic operator '${expr.operator}' cannot be applied to types '${lt}' and '${rt}'.`,
              expr.line,
              expr.column
            );
          }
        }
        return;
      }

      case 'CallExpression': {
        for (const a of expr.args) this.checkExpression(a);

        // `super(...)` constructor call validation
        if (expr.callee.kind === 'SuperExpression' && this.currentClassName) {
          const superCtor = this.findSuperConstructor(this.currentClassName);
          if (superCtor) {
            this.validateCallArguments(
              `${this.classes.get(this.currentClassName)?.decl.superClass ?? 'super'}.init`,
              superCtor.params,
              expr.args,
              expr.line,
              expr.column
            );
          }
          return;
        }

        // User-defined function call validation (unless shadowed by local variable)
        if (expr.callee.kind === 'Identifier') {
          const fnSig = this.functions.get(expr.callee.name);
          const localVar = this.lookupVar(expr.callee.name);
          if (fnSig && (!localVar || localVar.inferred === 'function')) {
            this.validateCallArguments(fnSig.name, fnSig.params, expr.args, expr.line, expr.column);
          }
          return;
        }

        // Method call on typed class/struct instance
        if (expr.callee.kind === 'MemberExpression') {
          this.checkExpression(expr.callee.object);
          const objType =
            expr.callee.object.kind === 'SelfExpression'
              ? this.currentClassName
              : this.inferExprType(expr.callee.object);
          if (objType && this.classes.has(objType)) {
            const resolved = this.resolveClassMethod(objType, expr.callee.property);
            if (resolved) {
              if (
                this.policy.checkMemberVisibility &&
                resolved.method.visibility === 'priv' &&
                this.currentClassName !== resolved.owner
              ) {
                this.typeError(
                  `Method '${resolved.owner}.${expr.callee.property}()' is private and cannot be accessed outside '${resolved.owner}'.`,
                  expr.line,
                  expr.column
                );
              }
              this.validateCallArguments(
                `${objType}.${resolved.method.name}`,
                resolved.method.params,
                expr.args,
                expr.line,
                expr.column
              );
            }
          }
          return;
        }

        this.checkExpression(expr.callee);
        return;
      }

      case 'NewExpression': {
        for (const a of expr.args) this.checkExpression(a);
        if (expr.countExpr) {
          this.checkExpression(expr.countExpr);
          const ct = this.inferExprType(expr.countExpr);
          if (ct && ct !== 'any' && !this.isNumeric(ct)) {
            this.typeError(
              `Array allocation size must be numeric, received '${ct}'.`,
              expr.countExpr.line,
              expr.countExpr.column
            );
          }
          return;
        }
        const cls = this.classes.get(expr.className);
        if (cls) {
          const ctor = cls.ctor ?? this.findSuperConstructor(expr.className);
          if (ctor) {
            this.validateCallArguments(
              `new ${expr.className}`,
              ctor.params,
              expr.args,
              expr.line,
              expr.column
            );
          }
        }
        return;
      }

      case 'StructInitExpression': {
        const st = this.structs.get(expr.structName);
        for (const f of expr.fields) {
          this.checkExpression(f.value);
          if (st) {
            const def = st.fields.get(f.name);
            if (!def) {
              this.typeError(
                `Unknown field '${f.name}' on struct '${expr.structName}'.`,
                expr.line,
                expr.column
              );
            } else if (def.typeAnnotation) {
              const vt = this.inferExprType(f.value);
              if (vt && !this.matchesAnnotation(def.typeAnnotation, vt)) {
                this.typeError(
                  `Field '${expr.structName}.${f.name}' expects '${this.formatAnnotation(def.typeAnnotation)}', but received '${vt}'.`,
                  expr.line,
                  expr.column
                );
              }
            }
          }
        }
        return;
      }

      case 'MemberExpression': {
        this.checkExpression(expr.object);
        const objType =
          expr.object.kind === 'SelfExpression'
            ? this.currentClassName
            : this.inferExprType(expr.object);
        if (objType && this.classes.has(objType)) {
          const resolvedField = this.resolveClassField(objType, expr.property);
          if (
            resolvedField &&
            this.policy.checkMemberVisibility &&
            resolvedField.field.visibility === 'priv' &&
            this.currentClassName !== resolvedField.owner
          ) {
            this.typeError(
              `Field '${resolvedField.owner}.${expr.property}' is private and cannot be accessed outside '${resolvedField.owner}'.`,
              expr.line,
              expr.column
            );
          }
        }
        return;
      }

      case 'LambdaExpression':
        this.checkCallable('<lambda>', expr.params, undefined, expr.body, expr.line, expr.column);
        return;

      case 'LogicalExpression':
      case 'PipeExpression':
        this.checkExpression(expr.left);
        this.checkExpression(expr.right);
        return;

      case 'UnaryExpression':
        this.checkExpression(expr.operand);
        return;

      case 'UpdateExpression':
        this.checkExpression(expr.argument);
        return;

      case 'ConditionalExpression':
        this.checkExpression(expr.condition);
        this.checkExpression(expr.consequent);
        this.checkExpression(expr.alternate);
        return;

      case 'IndexExpression':
        this.checkExpression(expr.object);
        this.checkExpression(expr.index);
        return;

      case 'PointerExpression':
        this.checkExpression(expr.argument);
        return;

      case 'ArrayLiteral':
        for (const el of expr.elements) this.checkExpression(el);
        return;

      case 'MapLiteral':
        for (const e of expr.entries) {
          this.checkExpression(e.key);
          this.checkExpression(e.value);
        }
        return;

      case 'FString':
        for (const p of expr.parts) {
          if (p.kind === 'expr') this.checkExpression(p.expression);
        }
        return;

      case 'RangeExpression':
        this.checkExpression(expr.start);
        this.checkExpression(expr.end);
        return;

      case 'MatchExpression':
        this.checkExpression(expr.subject);
        for (const arm of expr.arms) {
          this.pushScope();
          if (arm.pattern.kind === 'BindingPattern') {
            this.declareVar(arm.pattern.name, {
              inferred: this.inferExprType(expr.subject),
              mutable: false,
              isConst: false,
              isPointer: false,
            });
          } else if (arm.pattern.kind === 'EnumPattern') {
            for (const b of arm.pattern.bindings) {
              this.declareVar(b, { mutable: false, isConst: false, isPointer: false });
            }
          }
          if (arm.body.kind === 'BlockStatement') {
            this.checkBlock(arm.body, false);
          } else {
            this.checkExpression(arm.body);
          }
          this.popScope();
        }
        return;

      case 'Identifier':
      case 'Literal':
      case 'SelfExpression':
      case 'SuperExpression':
        return;
    }
  }

  private inferExprType(expr: ExpressionNode): string | undefined {
    switch (expr.kind) {
      case 'Literal':
        if (expr.literalType === 'int') return 'int';
        if (expr.literalType === 'float') return 'float';
        if (expr.literalType === 'str') return 'string';
        if (expr.literalType === 'bool') return 'boolean';
        if (expr.literalType === 'null') return 'null';
        return undefined;

      case 'FString':
        return 'string';

      case 'ArrayLiteral':
      case 'RangeExpression':
        return 'array';

      case 'MapLiteral':
        return 'dict';

      case 'NewExpression':
        return expr.countExpr ? 'ptr' : expr.className;

      case 'StructInitExpression':
        return expr.structName;

      case 'LambdaExpression':
        return 'function';

      case 'SelfExpression':
        return this.currentClassName ?? undefined;

      case 'Identifier': {
        const found = this.lookupVar(expr.name);
        if (!found) return undefined;
        if (found.inferred) return found.inferred;
        if (found.annotation && !found.annotation.nullable && !found.annotation.unionTypes?.length) {
          return this.normalizeTypeName(found.annotation.name);
        }
        return undefined;
      }

      case 'UnaryExpression':
        if (expr.operator === '!') return 'boolean';
        if (expr.operator === '-') return this.inferExprType(expr.operand);
        return undefined;

      case 'BinaryExpression': {
        if (['==', '!=', '<', '<=', '>', '>=', 'in', 'not in', 'is'].includes(expr.operator)) {
          return 'boolean';
        }
        const lt = this.inferExprType(expr.left);
        const rt = this.inferExprType(expr.right);
        if (expr.operator === '+') {
          if (lt === 'string' || rt === 'string') return 'string';
          if (this.isNumeric(lt) && this.isNumeric(rt)) {
            return lt === 'int' && rt === 'int' ? 'int' : 'number';
          }
          return undefined;
        }
        if (['-', '*', '/', '%', '**'].includes(expr.operator)) {
          if (expr.operator === '/') return 'number';
          if (lt === 'int' && rt === 'int') return 'int';
          if (this.isNumeric(lt) && this.isNumeric(rt)) return 'number';
        }
        return undefined;
      }

      case 'LogicalExpression':
        if (expr.operator === 'and' || expr.operator === 'or') {
          return 'boolean';
        }
        if (expr.operator === '??') {
          const lt = this.inferExprType(expr.left);
          const rt = this.inferExprType(expr.right);
          if (lt && lt !== 'null') return lt;
          return rt;
        }
        return undefined;

      case 'ConditionalExpression': {
        const ct = this.inferExprType(expr.consequent);
        const at = this.inferExprType(expr.alternate);
        if (ct && at && ct === at) return ct;
        if (this.isNumeric(ct) && this.isNumeric(at)) return 'number';
        return undefined;
      }

      case 'MemberExpression': {
        if (expr.object.kind === 'Identifier' && this.enums.has(expr.object.name)) {
          return expr.object.name;
        }
        const objType =
          expr.object.kind === 'SelfExpression'
            ? this.currentClassName
            : this.inferExprType(expr.object);
        if (objType && this.classes.has(objType)) {
          const resolved = this.resolveClassField(objType, expr.property);
          if (resolved?.field.typeAnnotation && !resolved.field.typeAnnotation.nullable) {
            return this.normalizeTypeName(resolved.field.typeAnnotation.name);
          }
        }
        if (objType && this.structs.has(objType)) {
          const st = this.structs.get(objType);
          const f = st?.fields.get(expr.property);
          if (f?.typeAnnotation && !f.typeAnnotation.nullable) {
            return this.normalizeTypeName(f.typeAnnotation.name);
          }
        }
        if ((objType === 'string' || objType === 'array') && expr.property === 'length') {
          return 'int';
        }
        return undefined;
      }

      case 'CallExpression': {
        if (expr.callee.kind === 'Identifier') {
          const fn = expr.callee.name;
          if (STDLIB_RETURN_TYPES[fn]) return STDLIB_RETURN_TYPES[fn];
          const sig = this.functions.get(fn);
          if (sig?.returnType && !sig.returnType.nullable && !sig.returnType.unionTypes?.length) {
            return this.normalizeTypeName(sig.returnType.name);
          }
        } else if (expr.callee.kind === 'MemberExpression') {
          if (expr.callee.object.kind === 'Identifier' && this.enums.has(expr.callee.object.name)) {
            return expr.callee.object.name;
          }
          const objType =
            expr.callee.object.kind === 'SelfExpression'
              ? this.currentClassName
              : this.inferExprType(expr.callee.object);
          if (objType && this.classes.has(objType)) {
            const resolved = this.resolveClassMethod(objType, expr.callee.property);
            if (resolved?.method.returnType && !resolved.method.returnType.nullable) {
              return this.normalizeTypeName(resolved.method.returnType.name);
            }
          }
          if (objType === 'string') {
            if (['upper', 'uppercase', 'lower', 'lowercase', 'trim', 'replace'].includes(expr.callee.property)) {
              return 'string';
            }
          }
        }
        return undefined;
      }

      case 'MatchExpression': {
        let unified: string | undefined;
        for (const arm of expr.arms) {
          if (arm.body.kind === 'BlockStatement') return undefined;
          const armType = this.inferExprType(arm.body);
          if (!armType) return undefined;
          if (!unified) unified = armType;
          else if (unified !== armType) {
            if (this.isNumeric(unified) && this.isNumeric(armType)) unified = 'number';
            else if (!this.isCompatibleTypeNames(unified, armType)) return undefined;
          }
        }
        return unified;
      }

      default:
        return undefined;
    }
  }
}
