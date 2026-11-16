import {
  BlockStatementNode,
  ClassDeclarationNode,
  EnumDeclarationNode,
  ExpressionNode,
  FunctionDeclarationNode,
  PointerMode,
  ProgramNode,
  StatementNode,
  StructDeclarationNode,
  TraitDeclarationNode,
  TypeAnnotationNode,
  VarDeclarationNode,
} from '../ast/nodes.ts';
import { CompilerDiagnostic, TransformError } from '../errors/compilerErrors.ts';
import {
  YOURGUI_ELEMENT_NAMES,
  YOURGUI_EVENT_HELPER_NAMES,
} from '../stdlib/yourgui/index.ts';

export type PointerLifecycle = 'active' | 'moved' | 'dropped' | 'borrowed';

export interface SymbolRecord {
  name: string;
  kind: 'variable' | 'const' | 'function' | 'class' | 'struct' | 'enum' | 'trait' | 'param' | 'module';
  mutable: boolean;
  typeName?: string;
  pointerMode?: PointerMode;
  line: number;
  column: number;
  scopeDepth: number;
}

export interface PointerRecord {
  name: string;
  mode: PointerMode;
  state: PointerLifecycle;
  borrowCount: number;
  line: number;
  column: number;
  lastEventLine?: number;
}

export interface TransformResult {
  ast: ProgramNode;
  diagnostics: CompilerDiagnostic[];
  symbols: SymbolRecord[];
  pointers: PointerRecord[];
  asyncFunctions: string[];
  topLevelAsync: boolean;
  refFunctionParams: Record<string, boolean[]>;
}

const INTERACTIVE_IO_FUNCTIONS = new Set([
  'input',
  'ask',
  'prompt',
  'inputInt',
  'inputFloat',
  'confirm',
  'alert',
  'sleep',
  'fetch',
  'listen',
  'copy',
]);

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
  onClick: 'GuiElement',
  onInput: 'GuiElement',
  onChange: 'GuiElement',
  onSubmit: 'GuiElement',
  click: 'GuiElement',
  section: 'GuiElement',
  dom: 'GuiElement',
  byId: 'GuiElement',
  getById: 'GuiElement',
  selectId: 'GuiElement',
  render: 'GuiElement',
  mount: 'GuiElement',
  unique_ptr: 'ptr',
  make_unique: 'ptr',
  shared_ptr: 'ptr',
  make_shared: 'ptr',
  weak_ptr: 'ptr',
  addressOf: 'string',
  addr: 'string',
  browserLocation: 'dict',
};

interface ScopeEntry {
  symbol: SymbolRecord;
  typeAnnotation?: TypeAnnotationNode;
  pointer?: PointerRecord;
  isConstPointee?: boolean;
}

export class Transformer {
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly allSymbols: SymbolRecord[] = [];
  private readonly allPointers: PointerRecord[] = [];
  private readonly scopes: Array<Map<string, ScopeEntry>> = [new Map()];
  private readonly traits = new Map<string, TraitDeclarationNode>();
  private readonly classes = new Map<string, ClassDeclarationNode>();
  private readonly structs = new Map<string, StructDeclarationNode>();
  private readonly enums = new Map<string, EnumDeclarationNode>();
  private readonly functionReturnTypes = new Map<string, string>();
  private readonly refFunctionParams = new Map<string, boolean[]>();
  private readonly asyncFunctions = new Set<string>();
  private currentFunctionName: string | null = null;
  private topLevelAsync = false;
  private isYourGuiProgram = false;

  public transform(program: ProgramNode): TransformResult {
    this.isYourGuiProgram = this.detectYourGuiProgram(program);

    // Pre-register top-level type declarations for forward references & trait validation
    for (const stmt of program.body) {
      if (stmt.kind === 'TraitDeclaration') {
        this.traits.set(stmt.name, stmt);
      } else if (stmt.kind === 'ClassDeclaration') {
        this.classes.set(stmt.name, stmt);
      } else if (stmt.kind === 'StructDeclaration') {
        this.structs.set(stmt.name, stmt);
      } else if (stmt.kind === 'EnumDeclaration') {
        this.enums.set(stmt.name, stmt);
      } else if (stmt.kind === 'FunctionDeclaration') {
        if (stmt.returnType) {
          this.functionReturnTypes.set(stmt.name, this.normalizeTypeName(stmt.returnType.name));
        }
        if (stmt.params.some((p) => Boolean(p.typeAnnotation?.isReference))) {
          this.refFunctionParams.set(
            stmt.name,
            stmt.params.map((p) => Boolean(p.typeAnnotation?.isReference))
          );
        }
      }
    }

    const transformedBody = program.body.map((stmt) => this.transformStatement(stmt));

    return {
      ast: {
        ...program,
        body: transformedBody,
      },
      diagnostics: this.diagnostics,
      symbols: this.allSymbols,
      pointers: this.allPointers,
      asyncFunctions: Array.from(this.asyncFunctions),
      topLevelAsync: this.topLevelAsync,
      refFunctionParams: Object.fromEntries(this.refFunctionParams.entries()),
    };
  }

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  private declareSymbol(
    symbol: Omit<SymbolRecord, 'scopeDepth'>,
    pointer?: Omit<PointerRecord, 'borrowCount'>,
    typeAnnotation?: TypeAnnotationNode,
    isConstPointee = false
  ): ScopeEntry {
    const scope = this.scopes[this.scopes.length - 1];
    const fullSymbol: SymbolRecord = {
      ...symbol,
      scopeDepth: this.scopes.length - 1,
    };
    const fullPointer: PointerRecord | undefined = pointer
      ? { ...pointer, borrowCount: 0 }
      : undefined;

    const entry: ScopeEntry = { symbol: fullSymbol, typeAnnotation, pointer: fullPointer, isConstPointee };
    scope.set(symbol.name, entry);
    this.allSymbols.push(fullSymbol);
    if (fullPointer) {
      this.allPointers.push(fullPointer);
    }
    return entry;
  }

  private lookup(name: string): ScopeEntry | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i].get(name);
      if (found) return found;
    }
    return undefined;
  }

  private reportError(
    message: string,
    line: number,
    column: number,
    hint?: string,
    title?: string
  ): void {
    const err = new TransformError(message, line, column, hint, title);
    this.diagnostics.push(err.toDiagnostic('error'));
  }

  private reportWarning(message: string, line: number, column: number, hint?: string): void {
    const err = new TransformError(message, line, column, hint);
    this.diagnostics.push(err.toDiagnostic('warning'));
  }

  private transformStatement(stmt: StatementNode): StatementNode {
    switch (stmt.kind) {
      case 'VarDeclaration':
        return this.transformVarDecl(stmt);

      case 'MultiVarDeclaration':
        return {
          ...stmt,
          declarations: stmt.declarations.map((d) => this.transformVarDecl(d)),
        };

      case 'ImportStatement': {
        if (stmt.defaultImport) {
          this.declareSymbol({
            name: stmt.defaultImport,
            kind: 'module',
            mutable: false,
            typeName: 'module',
            line: stmt.line,
            column: stmt.column,
          });
        }
        if (stmt.alias) {
          this.declareSymbol({
            name: stmt.alias,
            kind: 'module',
            mutable: false,
            typeName: 'module',
            line: stmt.line,
            column: stmt.column,
          });
        }
        for (const named of stmt.namedImports) {
          this.declareSymbol({
            name: named,
            kind: 'variable',
            mutable: false,
            typeName: STDLIB_RETURN_TYPES[named] ? 'function' : 'any',
            line: stmt.line,
            column: stmt.column,
          });
        }
        return stmt;
      }

      case 'FunctionDeclaration':
        return this.transformFunctionDecl(stmt);

      case 'ClassDeclaration':
        return this.transformClassDecl(stmt);

      case 'StructDeclaration':
        return this.transformStructDecl(stmt);

      case 'EnumDeclaration':
        this.declareSymbol({
          name: stmt.name,
          kind: 'enum',
          mutable: false,
          typeName: 'enum',
          line: stmt.line,
          column: stmt.column,
        });
        return stmt;

      case 'TraitDeclaration':
        this.declareSymbol({
          name: stmt.name,
          kind: 'trait',
          mutable: false,
          typeName: 'trait',
          line: stmt.line,
          column: stmt.column,
        });
        return stmt;

      case 'BlockStatement':
        return this.transformBlock(stmt);

      case 'IfStatement':
        return {
          ...stmt,
          condition: this.transformExpression(stmt.condition),
          consequent: this.transformBlock(stmt.consequent),
          elifBranches: stmt.elifBranches.map((branch) => ({
            ...branch,
            condition: this.transformExpression(branch.condition),
            consequent: this.transformBlock(branch.consequent),
          })),
          alternate: stmt.alternate ? this.transformBlock(stmt.alternate) : undefined,
        };

      case 'ForInStatement': {
        const iterable = this.transformExpression(stmt.iterable);
        this.pushScope();
        this.declareSymbol({
          name: stmt.variable,
          kind: 'variable',
          mutable: false,
          line: stmt.line,
          column: stmt.column,
        });
        const body = this.transformBlock(stmt.body, false);
        this.popScope();
        return { ...stmt, iterable, body };
      }

      case 'CForStatement': {
        this.pushScope();
        const init = stmt.init ? this.transformStatement(stmt.init) : undefined;
        const condition = stmt.condition ? this.transformExpression(stmt.condition) : undefined;
        const update = stmt.update ? this.transformExpression(stmt.update) : undefined;
        const body = this.transformBlock(stmt.body, false);
        this.popScope();
        return { ...stmt, init, condition, update, body };
      }

      case 'WhileStatement':
        return {
          ...stmt,
          condition: this.transformExpression(stmt.condition),
          body: this.transformBlock(stmt.body),
        };

      case 'DoWhileStatement':
        return {
          ...stmt,
          body: this.transformBlock(stmt.body),
          condition: this.transformExpression(stmt.condition),
        };

      case 'LoopStatement':
        return {
          ...stmt,
          body: this.transformBlock(stmt.body),
        };

      case 'RepeatStatement':
        return {
          ...stmt,
          count: this.transformExpression(stmt.count),
          body: this.transformBlock(stmt.body),
        };

      case 'ReturnStatement':
        return {
          ...stmt,
          value: stmt.value ? this.transformExpression(stmt.value) : undefined,
        };

      case 'TryCatchStatement': {
        const tryBlock = this.transformBlock(stmt.tryBlock);
        this.pushScope();
        if (stmt.catchVar) {
          this.declareSymbol({
            name: stmt.catchVar,
            kind: 'variable',
            mutable: false,
            line: stmt.line,
            column: stmt.column,
          });
        }
        const catchBlock = this.transformBlock(stmt.catchBlock, false);
        this.popScope();
        return { ...stmt, tryBlock, catchBlock };
      }

      case 'ThrowStatement':
        return {
          ...stmt,
          value: this.transformExpression(stmt.value),
        };

      case 'DeferStatement':
        return {
          ...stmt,
          statement: this.transformStatement(stmt.statement),
        };

      case 'DropStatement': {
        const target = this.transformExpression(stmt.target);
        if (target.kind === 'Identifier') {
          const entry = this.lookup(target.name);
          if (entry?.pointer) {
            if (entry.pointer.state === 'dropped') {
              this.reportError(
                `Double drop on pointer '${target.name}'.`,
                stmt.line,
                stmt.column,
                'A pointer can only be dropped once.'
              );
            } else if (entry.pointer.state === 'moved') {
              this.reportWarning(
                `Dropping '${target.name}' after ownership was already moved.`,
                stmt.line,
                stmt.column
              );
            } else {
              entry.pointer.state = 'dropped';
              entry.pointer.lastEventLine = stmt.line;
            }
          }
        }
        return { ...stmt, target };
      }

      case 'ScopeStatement':
        return {
          ...stmt,
          body: this.transformBlock(stmt.body, true),
        };

      case 'ExpressionStatement': {
        const expr = stmt.expression;
        // Auto-declare bare assignments like `items = [1, 2, 3]` in the current scope
        if (
          expr.kind === 'AssignmentExpression' &&
          expr.operator === '=' &&
          expr.target.kind === 'Identifier' &&
          !this.lookup(expr.target.name)
        ) {
          const initializer = this.transformExpression(expr.value);
          const inferredType = this.inferExpressionType(initializer);
          this.declareSymbol({
            name: expr.target.name,
            kind: 'variable',
            mutable: true,
            typeName: inferredType,
            line: expr.line,
            column: expr.column,
          });
          return {
            kind: 'VarDeclaration',
            mutable: true,
            name: expr.target.name,
            initializer,
            line: stmt.line,
            column: stmt.column,
          };
        }
        return {
          ...stmt,
          expression: this.transformExpression(expr),
        };
      }

      case 'StyleStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        return stmt;
    }
  }

  private transformVarDecl(stmt: VarDeclarationNode): VarDeclarationNode {
    const initializer = stmt.initializer ? this.transformExpression(stmt.initializer) : undefined;

    let inferredPointerMode = stmt.pointerMode;
    if (!inferredPointerMode && initializer?.kind === 'PointerExpression') {
      if (initializer.op === 'own' || initializer.op === 'move') {
        inferredPointerMode = 'own';
      } else if (initializer.op === 'shared') {
        inferredPointerMode = 'shared';
      } else if (initializer.op === 'borrow') {
        inferredPointerMode = 'ref';
      }
    }

    if (!inferredPointerMode && stmt.typeAnnotation) {
      if (stmt.typeAnnotation.isReference) inferredPointerMode = 'cpp_ref';
      else if (stmt.typeAnnotation.isPointer) inferredPointerMode = 'ptr';
      else if (stmt.typeAnnotation.name === 'unique_ptr') inferredPointerMode = 'unique';
      else if (stmt.typeAnnotation.name === 'shared_ptr') inferredPointerMode = 'shared';
      else if (stmt.typeAnnotation.name === 'weak_ptr') inferredPointerMode = 'weak';
      else if (stmt.typeAnnotation.name === 'own') inferredPointerMode = 'own';
      else if (stmt.typeAnnotation.name === 'ref') inferredPointerMode = 'ref';
      else if (stmt.typeAnnotation.name === 'shared') inferredPointerMode = 'shared';
    }

    if (
      !inferredPointerMode &&
      initializer?.kind === 'CallExpression' &&
      initializer.callee.kind === 'Identifier'
    ) {
      if (initializer.callee.name === 'make_unique' || initializer.callee.name === 'unique_ptr') {
        inferredPointerMode = 'unique';
      } else if (initializer.callee.name === 'make_shared' || initializer.callee.name === 'shared_ptr') {
        inferredPointerMode = 'shared';
      } else if (initializer.callee.name === 'weak_ptr') {
        inferredPointerMode = 'weak';
      }
    }

    if (inferredPointerMode === 'cpp_ref' && !initializer) {
      this.reportError(
        `Reference '${stmt.name}' must be initialized when declared.`,
        stmt.line,
        stmt.column,
        `Initialize '${stmt.name}' to a variable, e.g. \`int& ${stmt.name} = target\`.`
      );
    }

    const actualType = initializer ? this.inferExpressionType(initializer) : undefined;
    if (stmt.typeAnnotation && actualType && !inferredPointerMode) {
      this.checkTypeCompatibility(
        stmt.typeAnnotation,
        actualType,
        stmt.name,
        stmt.line,
        stmt.column
      );
    }

    const resolvedTypeName = stmt.typeAnnotation
      ? this.formatTypeAnnotation(stmt.typeAnnotation)
      : actualType;

    this.declareSymbol(
      {
        name: stmt.name,
        kind: stmt.mutable ? 'variable' : 'const',
        mutable: stmt.mutable,
        typeName: resolvedTypeName,
        pointerMode: inferredPointerMode,
        line: stmt.line,
        column: stmt.column,
      },
      inferredPointerMode
        ? {
            name: stmt.name,
            mode: inferredPointerMode,
            state: 'active',
            line: stmt.line,
            column: stmt.column,
            lastEventLine: stmt.line,
          }
        : undefined,
      stmt.typeAnnotation,
      Boolean(stmt.typeAnnotation?.isConst)
    );

    return {
      ...stmt,
      pointerMode: inferredPointerMode,
      initializer,
    };
  }

  private transformFunctionDecl(stmt: FunctionDeclarationNode): FunctionDeclarationNode {
    if (stmt.params.some((p) => Boolean(p.typeAnnotation?.isReference))) {
      this.refFunctionParams.set(
        stmt.name,
        stmt.params.map((p) => Boolean(p.typeAnnotation?.isReference))
      );
    }
    this.declareSymbol({
      name: stmt.name,
      kind: 'function',
      mutable: false,
      typeName: stmt.returnType ? this.formatTypeAnnotation(stmt.returnType) : 'void',
      line: stmt.line,
      column: stmt.column,
    });

    const prevFn = this.currentFunctionName;
    this.currentFunctionName = stmt.name;

    this.pushScope();
    const params = stmt.params.map((param) => {
      const defaultValue = param.defaultValue
        ? this.transformExpression(param.defaultValue)
        : undefined;
      this.declareSymbol(
        {
          name: param.name,
          kind: 'param',
          mutable: true,
          typeName: param.typeAnnotation ? this.formatTypeAnnotation(param.typeAnnotation) : undefined,
          line: param.line,
          column: param.column,
        },
        undefined,
        param.typeAnnotation
      );
      return { ...param, defaultValue };
    });

    const body = this.transformBlock(stmt.body, false);
    this.popScope();
    this.currentFunctionName = prevFn;

    return { ...stmt, params, body };
  }

  private transformClassDecl(stmt: ClassDeclarationNode): ClassDeclarationNode {
    this.classes.set(stmt.name, stmt);
    this.declareSymbol({
      name: stmt.name,
      kind: 'class',
      mutable: false,
      typeName: stmt.name,
      line: stmt.line,
      column: stmt.column,
    });

    if (stmt.superClass && !this.classes.has(stmt.superClass)) {
      this.reportWarning(
        `Parent class '${stmt.superClass}' is not declared in this module.`,
        stmt.line,
        stmt.column
      );
    }

    // Validate implemented traits / interfaces
    const methodNames = new Set(stmt.methods.map((m) => m.name));
    for (const traitName of stmt.traits) {
      const trait = this.traits.get(traitName);
      if (!trait) {
        this.reportError(
          `Unknown trait/interface '${traitName}' implemented by class '${stmt.name}'.`,
          stmt.line,
          stmt.column
        );
        continue;
      }
      for (const reqMethod of trait.methods) {
        if (!methodNames.has(reqMethod.name)) {
          this.reportError(
            `Class '${stmt.name}' does not implement required method '${reqMethod.name}()' from '${traitName}'.`,
            stmt.line,
            stmt.column,
            `Add \`pub fn ${reqMethod.name}(...) { ... }\` to class '${stmt.name}'.`
          );
        }
      }
    }

    const fields = stmt.fields.map((field) => ({
      ...field,
      initializer: field.initializer ? this.transformExpression(field.initializer) : undefined,
    }));

    const methods = stmt.methods.map((method) => {
      this.pushScope();
      const params = method.params.map((param) => {
        const defaultValue = param.defaultValue
          ? this.transformExpression(param.defaultValue)
          : undefined;
        this.declareSymbol(
          {
            name: param.name,
            kind: 'param',
            mutable: true,
            typeName: param.typeAnnotation
              ? this.formatTypeAnnotation(param.typeAnnotation)
              : undefined,
            line: param.line,
            column: param.column,
          },
          undefined,
          param.typeAnnotation
        );
        return { ...param, defaultValue };
      });
      const body = this.transformBlock(method.body, false);
      this.popScope();
      return { ...method, params, body };
    });

    return { ...stmt, fields, methods };
  }

  private transformStructDecl(stmt: StructDeclarationNode): StructDeclarationNode {
    this.declareSymbol({
      name: stmt.name,
      kind: 'struct',
      mutable: false,
      typeName: stmt.name,
      line: stmt.line,
      column: stmt.column,
    });

    const fields = stmt.fields.map((f) => ({
      ...f,
      defaultValue: f.defaultValue ? this.transformExpression(f.defaultValue) : undefined,
    }));

    const methods = stmt.methods.map((m) => {
      this.pushScope();
      for (const param of m.params) {
        this.declareSymbol(
          {
            name: param.name,
            kind: 'param',
            mutable: true,
            typeName: param.typeAnnotation
              ? this.formatTypeAnnotation(param.typeAnnotation)
              : undefined,
            line: param.line,
            column: param.column,
          },
          undefined,
          param.typeAnnotation
        );
      }
      const body = this.transformBlock(m.body, false);
      this.popScope();
      return { ...m, body };
    });

    return { ...stmt, fields, methods };
  }

  private transformBlock(block: BlockStatementNode, createScope = true): BlockStatementNode {
    if (createScope) this.pushScope();
    const statements = block.statements.map((s) => this.transformStatement(s));
    if (createScope) this.popScope();
    return { ...block, statements };
  }

  private transformExpression(expr: ExpressionNode): ExpressionNode {
    switch (expr.kind) {
      case 'Identifier': {
        const entry = this.lookup(expr.name);
        if (entry?.pointer) {
          if (entry.pointer.state === 'moved') {
            this.reportError(
              `Use of moved pointer '${expr.name}'.`,
              expr.line,
              expr.column,
              'Ownership was transferred via `move`; use the new owner or `shared` instead.'
            );
          } else if (entry.pointer.state === 'dropped') {
            this.reportError(
              `Use of dropped pointer '${expr.name}'.`,
              expr.line,
              expr.column,
              'Cannot access memory after calling `drop`.'
            );
          }
        }
        return expr;
      }

      case 'PointerExpression': {
        if (expr.op === 'move') {
          if (expr.argument.kind === 'Identifier') {
            const entry = this.lookup(expr.argument.name);
            if (entry?.pointer) {
              if (entry.pointer.state === 'moved') {
                this.reportError(
                  `Cannot move '${expr.argument.name}' twice.`,
                  expr.line,
                  expr.column
                );
              } else if (entry.pointer.state === 'dropped') {
                this.reportError(
                  `Cannot move dropped pointer '${expr.argument.name}'.`,
                  expr.line,
                  expr.column
                );
              } else {
                entry.pointer.state = 'moved';
                entry.pointer.lastEventLine = expr.line;
              }
            }
          }
          return expr;
        }

        if (expr.op === 'borrow') {
          if (expr.argument.kind === 'Identifier') {
            const entry = this.lookup(expr.argument.name);
            if (entry?.pointer) {
              if (entry.pointer.state === 'moved' || entry.pointer.state === 'dropped') {
                this.reportError(
                  `Cannot borrow '${expr.argument.name}' because it was ${entry.pointer.state}.`,
                  expr.line,
                  expr.column
                );
              } else {
                entry.pointer.borrowCount += 1;
                entry.pointer.lastEventLine = expr.line;
              }
            }
          }
          return expr;
        }

        return {
          ...expr,
          argument: this.transformExpression(expr.argument),
        };
      }

      case 'AssignmentExpression': {
        const transformedValue = this.transformExpression(expr.value);
        if (expr.target.kind === 'PointerExpression' && expr.target.op === 'deref') {
          if (expr.target.argument.kind === 'Identifier') {
            const entry = this.lookup(expr.target.argument.name);
            if (entry?.isConstPointee) {
              this.reportError(
                `Cannot modify value through const pointer '${expr.target.argument.name}'.`,
                expr.line,
                expr.column,
                'Declare without `const` pointee qualifier if mutation is intended.'
              );
            }
          }
        }
        if (expr.target.kind === 'Identifier') {
          const entry = this.lookup(expr.target.name);
          if (entry && !entry.symbol.mutable && entry.symbol.kind === 'const') {
            this.reportError(
              `Cannot reassign constant '${expr.target.name}'.`,
              expr.line,
              expr.column,
              'Declare with `var` or `let` instead of `const` if reassignment is required.'
            );
          } else if (entry && entry.symbol.pointerMode === 'ptr' && !entry.symbol.mutable && expr.operator === '=') {
            this.reportError(
              `Cannot reassign const pointer '${expr.target.name}'.`,
              expr.line,
              expr.column
            );
          } else if (entry?.isConstPointee && entry.symbol.pointerMode === 'cpp_ref') {
            this.reportError(
              `Cannot modify const reference '${expr.target.name}'.`,
              expr.line,
              expr.column
            );
          } else if (entry?.typeAnnotation && expr.operator === '=') {
            const actualType = this.inferExpressionType(transformedValue);
            if (actualType) {
              this.checkTypeCompatibility(
                entry.typeAnnotation,
                actualType,
                expr.target.name,
                expr.line,
                expr.column
              );
            }
          }
        }
        return {
          ...expr,
          target:
            expr.target.kind === 'PointerExpression' && expr.target.op === 'deref'
              ? { ...expr.target, argument: this.transformExpression(expr.target.argument) }
              : expr.target.kind === 'Identifier'
                ? expr.target
                : this.transformExpression(expr.target),
          value: transformedValue,
        };
      }

      // Desugar pipeline operator `a |> f(b)` -> `f(a, b)`
      case 'PipeExpression': {
        const left = this.transformExpression(expr.left);
        const right = this.transformExpression(expr.right);
        if (right.kind === 'CallExpression') {
          return {
            kind: 'CallExpression',
            callee: right.callee,
            args: [left, ...right.args],
            line: expr.line,
            column: expr.column,
          };
        }
        return {
          kind: 'CallExpression',
          callee: right,
          args: [left],
          line: expr.line,
          column: expr.column,
        };
      }

      case 'ConditionalExpression':
        return {
          ...expr,
          condition: this.transformExpression(expr.condition),
          consequent: this.transformExpression(expr.consequent),
          alternate: this.transformExpression(expr.alternate),
        };

      case 'BinaryExpression':
        return {
          ...expr,
          left: this.transformExpression(expr.left),
          right: this.transformExpression(expr.right),
        };

      case 'LogicalExpression':
        return {
          ...expr,
          left: this.transformExpression(expr.left),
          right: this.transformExpression(expr.right),
        };

      case 'UnaryExpression':
        return {
          ...expr,
          operand: this.transformExpression(expr.operand),
        };

      case 'UpdateExpression':
        return {
          ...expr,
          argument:
            expr.argument.kind === 'Identifier'
              ? expr.argument
              : this.transformExpression(expr.argument),
        };

      case 'CallExpression': {
        if (expr.callee.kind === 'Identifier') {
          const fnName = expr.callee.name;
          if (this.classes.has(fnName)) {
            return {
              kind: 'NewExpression',
              className: fnName,
              args: expr.args.map((a) => this.transformExpression(a)),
              line: expr.line,
              column: expr.column,
            };
          }
          // Disambiguate bare input("Enter your name") inside yourgui websites -> yourgui.input(...)
          if (fnName === 'input' && this.isYourGuiProgram && !this.lookup('input')) {
            return {
              ...expr,
              callee: {
                kind: 'MemberExpression',
                object: {
                  kind: 'Identifier',
                  name: 'yourgui',
                  line: expr.line,
                  column: expr.column,
                },
                property: 'input',
                optional: false,
                line: expr.line,
                column: expr.column,
              },
              args: expr.args.map((a) => this.transformExpression(a)),
            };
          }
          if (INTERACTIVE_IO_FUNCTIONS.has(fnName) || this.asyncFunctions.has(fnName)) {
            if (this.currentFunctionName) {
              this.asyncFunctions.add(this.currentFunctionName);
            } else {
              this.topLevelAsync = true;
            }
          }
        } else if (
          expr.callee.kind === 'MemberExpression' &&
          expr.callee.object.kind === 'Identifier' &&
          ((expr.callee.object.name === 'server' && expr.callee.property === 'request') ||
            (expr.callee.object.name === 'http' &&
              (expr.callee.property === 'get' || expr.callee.property === 'post')))
        ) {
          if (this.currentFunctionName) {
            this.asyncFunctions.add(this.currentFunctionName);
          } else {
            this.topLevelAsync = true;
          }
        }
        return {
          ...expr,
          callee: this.transformExpression(expr.callee),
          args: expr.args.map((a) => this.transformExpression(a)),
        };
      }

      case 'MemberExpression':
        return {
          ...expr,
          object: this.transformExpression(expr.object),
        };

      case 'IndexExpression':
        return {
          ...expr,
          object: this.transformExpression(expr.object),
          index: this.transformExpression(expr.index),
        };

      case 'NewExpression':
        return {
          ...expr,
          args: expr.args.map((a) => this.transformExpression(a)),
          countExpr: expr.countExpr ? this.transformExpression(expr.countExpr) : undefined,
        };

      case 'StructInitExpression':
        return {
          ...expr,
          fields: expr.fields.map((f) => ({
            ...f,
            value: this.transformExpression(f.value),
          })),
        };

      case 'ArrayLiteral':
        return {
          ...expr,
          elements: expr.elements.map((e) => this.transformExpression(e)),
        };

      case 'MapLiteral':
        return {
          ...expr,
          entries: expr.entries.map((entry) => ({
            key: this.transformExpression(entry.key),
            value: this.transformExpression(entry.value),
          })),
        };

      case 'FString':
        return {
          ...expr,
          parts: expr.parts.map((part) =>
            part.kind === 'expr'
              ? { kind: 'expr', expression: this.transformExpression(part.expression) }
              : part
          ),
        };

      case 'LambdaExpression': {
        this.pushScope();
        for (const p of expr.params) {
          this.declareSymbol(
            {
              name: p.name,
              kind: 'param',
              mutable: true,
              typeName: p.typeAnnotation ? this.formatTypeAnnotation(p.typeAnnotation) : undefined,
              line: p.line,
              column: p.column,
            },
            undefined,
            p.typeAnnotation
          );
        }
        const body =
          expr.body.kind === 'BlockStatement'
            ? this.transformBlock(expr.body, false)
            : this.transformExpression(expr.body);
        this.popScope();
        return { ...expr, body };
      }

      case 'RangeExpression':
        return {
          ...expr,
          start: this.transformExpression(expr.start),
          end: this.transformExpression(expr.end),
        };

      case 'MatchExpression': {
        const subject = this.transformExpression(expr.subject);
        const arms = expr.arms.map((arm) => {
          this.pushScope();
          if (arm.pattern.kind === 'EnumPattern') {
            for (const b of arm.pattern.bindings) {
              this.declareSymbol({
                name: b,
                kind: 'variable',
                mutable: false,
                line: arm.line,
                column: arm.column,
              });
            }
          } else if (arm.pattern.kind === 'BindingPattern') {
            this.declareSymbol({
              name: arm.pattern.name,
              kind: 'variable',
              mutable: false,
              line: arm.line,
              column: arm.column,
            });
          }
          const body =
            arm.body.kind === 'BlockStatement'
              ? this.transformBlock(arm.body, false)
              : this.transformExpression(arm.body);
          this.popScope();
          return { ...arm, body };
        });
        return { ...expr, subject, arms };
      }

      case 'Literal':
      case 'SelfExpression':
      case 'SuperExpression':
        return expr;
    }
  }

  // ==========================================================================
  // Static Type Inference & Validation
  // ==========================================================================

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

  private formatTypeAnnotation(t: TypeAnnotationNode): string {
    if (t.unionTypes && t.unionTypes.length > 0) {
      return t.unionTypes.map((u) => this.formatTypeAnnotation(u)).join(' | ');
    }
    const base = t.generics.length > 0
      ? `${t.name}<${t.generics.map((g) => this.formatTypeAnnotation(g)).join(', ')}>`
      : t.name;
    return t.nullable ? `${base}?` : base;
  }

  private inferExpressionType(expr: ExpressionNode): string | undefined {
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
        return expr.className;

      case 'StructInitExpression':
        return expr.structName;

      case 'LambdaExpression':
        return 'function';

      case 'Identifier': {
        const found = this.lookup(expr.name);
        if (!found?.symbol.typeName) return undefined;
        // Strip `?` and generics for base inference if simple
        const raw = found.symbol.typeName.replace(/\?$/, '');
        if (raw.includes('|')) return undefined;
        const base = raw.split('<')[0];
        return this.normalizeTypeName(base);
      }

      case 'UnaryExpression':
        if (expr.operator === '!') return 'boolean';
        if (expr.operator === '-') return this.inferExpressionType(expr.operand);
        return undefined;

      case 'BinaryExpression': {
        if (
          ['==', '!=', '<', '<=', '>', '>=', 'in', 'not in', 'is'].includes(expr.operator)
        ) {
          return 'boolean';
        }
        const lt = this.inferExpressionType(expr.left);
        const rt = this.inferExpressionType(expr.right);
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
          const lt = this.inferExpressionType(expr.left);
          const rt = this.inferExpressionType(expr.right);
          if (lt === 'boolean' && rt === 'boolean') return 'boolean';
        }
        return undefined;

      case 'ConditionalExpression': {
        const ct = this.inferExpressionType(expr.consequent);
        const at = this.inferExpressionType(expr.alternate);
        if (ct && at && ct === at) return ct;
        if (this.isNumeric(ct) && this.isNumeric(at)) return 'number';
        return undefined;
      }

      case 'CallExpression': {
        if (expr.callee.kind === 'Identifier') {
          const fn = expr.callee.name;
          if (STDLIB_RETURN_TYPES[fn]) return STDLIB_RETURN_TYPES[fn];
          if (this.functionReturnTypes.has(fn)) return this.functionReturnTypes.get(fn);
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  private isNumeric(t?: string): boolean {
    return t === 'int' || t === 'float' || t === 'number';
  }

  private matchesSingleAnnotation(expected: TypeAnnotationNode, actual: string): boolean {
    const exp = this.normalizeTypeName(expected.name);
    const act = this.normalizeTypeName(actual);

    if (exp === 'any' || act === 'any') return true;
    if (act === 'null') return expected.nullable || exp === 'null' || exp === 'option';

    if (exp === 'number') return act === 'int' || act === 'float' || act === 'number';
    if (exp === 'float') return act === 'float' || act === 'int' || act === 'number';
    if (exp === 'int') return act === 'int';

    return exp === act;
  }

  private checkTypeCompatibility(
    expected: TypeAnnotationNode,
    actual: string,
    targetName: string,
    line: number,
    column: number
  ): void {
    // Allow generic type params (single uppercase letter like `T`)
    if (/^[A-Z]$/.test(expected.name)) return;

    if (expected.unionTypes && expected.unionTypes.length > 0) {
      const ok = expected.unionTypes.some((u) => this.matchesSingleAnnotation(u, actual));
      if (!ok) {
        this.reportError(
          `Cannot assign '${actual}' to variable '${targetName}' of type '${this.formatTypeAnnotation(expected)}'.`,
          line,
          column,
          `Update the value or widen '${targetName}' using a union type like '${this.formatTypeAnnotation(expected)} | ${actual}'.`,
          'Type Error'
        );
      }
      return;
    }

    if (!this.matchesSingleAnnotation(expected, actual)) {
      const hint =
        actual === 'null'
          ? `Use optional type '${expected.name}?' if null values are allowed.`
          : `Expected a value of type '${this.formatTypeAnnotation(expected)}', but received '${actual}'.`;
      this.reportError(
        `Cannot assign '${actual}' to variable '${targetName}' of type '${this.formatTypeAnnotation(expected)}'.`,
        line,
        column,
        hint,
        'Type Error'
      );
    }
  }

  private detectYourGuiProgram(program: ProgramNode): boolean {
    const visitExpr = (expr: ExpressionNode): boolean => {
      switch (expr.kind) {
        case 'Identifier':
          return expr.name === 'yourgui';
        case 'CallExpression': {
          if (expr.callee.kind === 'Identifier') {
            const name = expr.callee.name;
            if (
              (YOURGUI_ELEMENT_NAMES.has(name) && name !== 'input') ||
              YOURGUI_EVENT_HELPER_NAMES.has(name)
            ) {
              return true;
            }
          }
          if (visitExpr(expr.callee)) return true;
          return expr.args.some(visitExpr);
        }
        case 'MemberExpression':
          return visitExpr(expr.object);
        case 'AssignmentExpression':
          return visitExpr(expr.target) || visitExpr(expr.value);
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'PipeExpression':
          return visitExpr(expr.left) || visitExpr(expr.right);
        case 'UnaryExpression':
          return visitExpr(expr.operand);
        case 'ConditionalExpression':
          return visitExpr(expr.condition) || visitExpr(expr.consequent) || visitExpr(expr.alternate);
        case 'ArrayLiteral':
          return expr.elements.some(visitExpr);
        case 'MapLiteral':
          return expr.entries.some((e) => visitExpr(e.key) || visitExpr(e.value));
        case 'LambdaExpression':
          return expr.body.kind === 'BlockStatement' ? visitStmt(expr.body) : visitExpr(expr.body);
        default:
          return false;
      }
    };

    const visitStmt = (stmt: StatementNode): boolean => {
      switch (stmt.kind) {
        case 'StyleStatement':
          return true;
        case 'ImportStatement':
          return stmt.modulePath === 'stdlib/yourgui' || stmt.modulePath === 'yourgui';
        case 'VarDeclaration':
          return stmt.initializer ? visitExpr(stmt.initializer) : false;
        case 'MultiVarDeclaration':
          return stmt.declarations.some((d) => (d.initializer ? visitExpr(d.initializer) : false));
        case 'FunctionDeclaration':
          return visitStmt(stmt.body);
        case 'BlockStatement':
          return stmt.statements.some(visitStmt);
        case 'ScopeStatement':
          return visitStmt(stmt.body);
        case 'IfStatement':
          return (
            visitExpr(stmt.condition) ||
            visitStmt(stmt.consequent) ||
            stmt.elifBranches.some((b) => visitExpr(b.condition) || visitStmt(b.consequent)) ||
            (stmt.alternate ? visitStmt(stmt.alternate) : false)
          );
        case 'ForInStatement':
          return visitExpr(stmt.iterable) || visitStmt(stmt.body);
        case 'CForStatement':
          return (
            (stmt.init ? visitStmt(stmt.init) : false) ||
            (stmt.condition ? visitExpr(stmt.condition) : false) ||
            (stmt.update ? visitExpr(stmt.update) : false) ||
            visitStmt(stmt.body)
          );
        case 'TryCatchStatement':
          return visitStmt(stmt.tryBlock) || visitStmt(stmt.catchBlock);
        case 'WhileStatement':
        case 'DoWhileStatement':
          return visitExpr(stmt.condition) || visitStmt(stmt.body);
        case 'LoopStatement':
          return visitStmt(stmt.body);
        case 'RepeatStatement':
          return visitExpr(stmt.count) || visitStmt(stmt.body);
        case 'ExpressionStatement':
          return visitExpr(stmt.expression);
        case 'ReturnStatement':
          return stmt.value ? visitExpr(stmt.value) : false;
        default:
          return false;
      }
    };

    return program.body.some(visitStmt);
  }
}

export function transform(program: ProgramNode): TransformResult {
  return new Transformer().transform(program);
}
