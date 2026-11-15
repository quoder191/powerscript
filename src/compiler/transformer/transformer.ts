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
  VarDeclarationNode,
} from '../ast/nodes.ts';
import { CompilerDiagnostic, TransformError } from '../errors/compilerErrors.ts';

export type PointerLifecycle = 'active' | 'moved' | 'dropped' | 'borrowed';

export interface SymbolRecord {
  name: string;
  kind: 'variable' | 'const' | 'function' | 'class' | 'struct' | 'enum' | 'trait' | 'param';
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

interface ScopeEntry {
  symbol: SymbolRecord;
  pointer?: PointerRecord;
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
  private readonly asyncFunctions = new Set<string>();
  private currentFunctionName: string | null = null;
  private topLevelAsync = false;

  public transform(program: ProgramNode): TransformResult {
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
    pointer?: Omit<PointerRecord, 'borrowCount'>
  ): ScopeEntry {
    const scope = this.scopes[this.scopes.length - 1];
    const fullSymbol: SymbolRecord = {
      ...symbol,
      scopeDepth: this.scopes.length - 1,
    };
    const fullPointer: PointerRecord | undefined = pointer
      ? { ...pointer, borrowCount: 0 }
      : undefined;

    const entry: ScopeEntry = { symbol: fullSymbol, pointer: fullPointer };
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

  private reportError(message: string, line: number, column: number, hint?: string): void {
    const err = new TransformError(message, line, column, hint);
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

      case 'LoopStatement':
        return {
          ...stmt,
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
          this.declareSymbol({
            name: expr.target.name,
            kind: 'variable',
            mutable: true,
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
      if (stmt.typeAnnotation.name === 'own') inferredPointerMode = 'own';
      else if (stmt.typeAnnotation.name === 'ref') inferredPointerMode = 'ref';
      else if (stmt.typeAnnotation.name === 'shared') inferredPointerMode = 'shared';
    }

    this.declareSymbol(
      {
        name: stmt.name,
        kind: stmt.mutable ? 'variable' : 'const',
        mutable: stmt.mutable,
        typeName: stmt.typeAnnotation?.name,
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
        : undefined
    );

    return {
      ...stmt,
      pointerMode: inferredPointerMode,
      initializer,
    };
  }

  private transformFunctionDecl(stmt: FunctionDeclarationNode): FunctionDeclarationNode {
    this.declareSymbol({
      name: stmt.name,
      kind: 'function',
      mutable: false,
      typeName: stmt.returnType?.name ?? 'void',
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
      this.declareSymbol({
        name: param.name,
        kind: 'param',
        mutable: true,
        typeName: param.typeAnnotation?.name,
        line: param.line,
        column: param.column,
      });
      return { ...param, defaultValue };
    });

    const body = this.transformBlock(stmt.body, false);
    this.popScope();
    this.currentFunctionName = prevFn;

    return { ...stmt, params, body };
  }

  private transformClassDecl(stmt: ClassDeclarationNode): ClassDeclarationNode {
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

    // Validate implemented traits
    const methodNames = new Set(stmt.methods.map((m) => m.name));
    for (const traitName of stmt.traits) {
      const trait = this.traits.get(traitName);
      if (!trait) {
        this.reportError(
          `Unknown trait '${traitName}' implemented by class '${stmt.name}'.`,
          stmt.line,
          stmt.column
        );
        continue;
      }
      for (const reqMethod of trait.methods) {
        if (!methodNames.has(reqMethod.name)) {
          this.reportError(
            `Class '${stmt.name}' does not implement required method '${reqMethod.name}()' from trait '${traitName}'.`,
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
        this.declareSymbol({
          name: param.name,
          kind: 'param',
          mutable: true,
          typeName: param.typeAnnotation?.name,
          line: param.line,
          column: param.column,
        });
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
        this.declareSymbol({
          name: param.name,
          kind: 'param',
          mutable: true,
          typeName: param.typeAnnotation?.name,
          line: param.line,
          column: param.column,
        });
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
        if (expr.target.kind === 'Identifier') {
          const entry = this.lookup(expr.target.name);
          if (entry && !entry.symbol.mutable && entry.symbol.kind === 'const') {
            this.reportError(
              `Cannot reassign constant '${expr.target.name}'.`,
              expr.line,
              expr.column,
              'Declare with `let` instead of `const` if reassignment is required.'
            );
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
          value: this.transformExpression(expr.value),
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
          if (INTERACTIVE_IO_FUNCTIONS.has(fnName) || this.asyncFunctions.has(fnName)) {
            if (this.currentFunctionName) {
              this.asyncFunctions.add(this.currentFunctionName);
            } else {
              this.topLevelAsync = true;
            }
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
          this.declareSymbol({
            name: p.name,
            kind: 'param',
            mutable: true,
            typeName: p.typeAnnotation?.name,
            line: p.line,
            column: p.column,
          });
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
}

export function transform(program: ProgramNode): TransformResult {
  return new Transformer().transform(program);
}
