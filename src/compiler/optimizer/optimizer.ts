import {
  BlockStatementNode,
  ExpressionNode,
  LiteralNode,
  ProgramNode,
  StatementNode,
} from '../ast/nodes.ts';

export interface OptimizationReport {
  foldedConstants: number;
  eliminatedBranches: number;
  removedDeadStatements: number;
  shakenFunctions: string[];
}

export interface OptimizeOptions {
  foldConstants?: boolean;
  eliminateDeadCode?: boolean;
  treeShake?: boolean;
}

export interface OptimizeResult {
  ast: ProgramNode;
  report: OptimizationReport;
}

export class ASTOptimizer {
  private readonly options: Required<OptimizeOptions>;
  private foldedConstants = 0;
  private eliminatedBranches = 0;
  private removedDeadStatements = 0;
  private shakenFunctions: string[] = [];

  constructor(options: OptimizeOptions = {}) {
    this.options = {
      foldConstants: options.foldConstants ?? true,
      eliminateDeadCode: options.eliminateDeadCode ?? true,
      treeShake: options.treeShake ?? true,
    };
  }

  public optimize(program: ProgramNode): OptimizeResult {
    let body = this.optimizeStatementList(program.body);

    if (this.options.treeShake) {
      body = this.treeShakeFunctions(body);
    }

    return {
      ast: {
        ...program,
        body,
      },
      report: {
        foldedConstants: this.foldedConstants,
        eliminatedBranches: this.eliminatedBranches,
        removedDeadStatements: this.removedDeadStatements,
        shakenFunctions: this.shakenFunctions,
      },
    };
  }

  private optimizeStatementList(statements: StatementNode[]): StatementNode[] {
    const out: StatementNode[] = [];
    let terminated = false;

    for (const rawStmt of statements) {
      if (this.options.eliminateDeadCode && terminated) {
        this.removedDeadStatements++;
        continue;
      }

      const stmt = this.optimizeStatement(rawStmt);

      if (this.options.eliminateDeadCode && stmt.kind === 'IfStatement') {
        const simplified = this.trySimplifyConstantIf(stmt);
        if (simplified !== null) {
          this.eliminatedBranches++;
          for (const s of simplified) {
            out.push(s);
            if (
              s.kind === 'ReturnStatement' ||
              s.kind === 'BreakStatement' ||
              s.kind === 'ContinueStatement' ||
              s.kind === 'ThrowStatement'
            ) {
              terminated = true;
              break;
            }
          }
          continue;
        }
      }

      if (
        this.options.eliminateDeadCode &&
        stmt.kind === 'WhileStatement' &&
        stmt.condition.kind === 'Literal' &&
        stmt.condition.literalType === 'bool' &&
        stmt.condition.value === false
      ) {
        this.eliminatedBranches++;
        continue;
      }

      if (
        this.options.eliminateDeadCode &&
        stmt.kind === 'RepeatStatement' &&
        stmt.count.kind === 'Literal' &&
        typeof stmt.count.value === 'number' &&
        stmt.count.value <= 0
      ) {
        this.eliminatedBranches++;
        continue;
      }

      out.push(stmt);

      if (
        stmt.kind === 'ReturnStatement' ||
        stmt.kind === 'BreakStatement' ||
        stmt.kind === 'ContinueStatement' ||
        stmt.kind === 'ThrowStatement'
      ) {
        terminated = true;
      }
    }

    return out;
  }

  private trySimplifyConstantIf(stmt: Extract<StatementNode, { kind: 'IfStatement' }>): StatementNode[] | null {
    if (stmt.condition.kind !== 'Literal' || stmt.condition.literalType !== 'bool') {
      return null;
    }

    const wrapIfScoped = (stmts: StatementNode[], line: number, column: number): StatementNode[] => {
      const hasDecl = stmts.some(
        (s) =>
          s.kind === 'VarDeclaration' ||
          s.kind === 'MultiVarDeclaration' ||
          s.kind === 'FunctionDeclaration' ||
          s.kind === 'ClassDeclaration' ||
          s.kind === 'StructDeclaration' ||
          s.kind === 'EnumDeclaration'
      );
      if (hasDecl) {
        return [{ kind: 'BlockStatement', statements: stmts, line, column }];
      }
      return stmts;
    };

    if (stmt.condition.value === true) {
      return wrapIfScoped(stmt.consequent.statements, stmt.line, stmt.column);
    }

    // Condition is false: check elif branches first
    for (let i = 0; i < stmt.elifBranches.length; i++) {
      const branch = stmt.elifBranches[i];
      if (branch.condition.kind === 'Literal' && branch.condition.literalType === 'bool') {
        if (branch.condition.value === true) {
          return wrapIfScoped(branch.consequent.statements, branch.line, branch.column);
        }
        continue;
      }
      // Cannot statically resolve remaining elif branches
      return [
        {
          kind: 'IfStatement',
          condition: branch.condition,
          consequent: branch.consequent,
          elifBranches: stmt.elifBranches.slice(i + 1),
          alternate: stmt.alternate,
          line: branch.line,
          column: branch.column,
        },
      ];
    }

    return stmt.alternate
      ? wrapIfScoped(stmt.alternate.statements, stmt.alternate.line, stmt.alternate.column)
      : [];
  }

  private optimizeBlock(block: BlockStatementNode): BlockStatementNode {
    return {
      ...block,
      statements: this.optimizeStatementList(block.statements),
    };
  }

  private optimizeStatement(stmt: StatementNode): StatementNode {
    switch (stmt.kind) {
      case 'VarDeclaration':
        return {
          ...stmt,
          initializer: stmt.initializer ? this.optimizeExpression(stmt.initializer) : undefined,
        };

      case 'MultiVarDeclaration':
        return {
          ...stmt,
          declarations: stmt.declarations.map((d) => ({
            ...d,
            initializer: d.initializer ? this.optimizeExpression(d.initializer) : undefined,
          })),
        };

      case 'FunctionDeclaration':
        return {
          ...stmt,
          params: stmt.params.map((p) => ({
            ...p,
            defaultValue: p.defaultValue ? this.optimizeExpression(p.defaultValue) : undefined,
          })),
          body: this.optimizeBlock(stmt.body),
        };

      case 'ClassDeclaration':
        return {
          ...stmt,
          fields: stmt.fields.map((f) => ({
            ...f,
            initializer: f.initializer ? this.optimizeExpression(f.initializer) : undefined,
          })),
          methods: stmt.methods.map((m) => ({
            ...m,
            params: m.params.map((p) => ({
              ...p,
              defaultValue: p.defaultValue ? this.optimizeExpression(p.defaultValue) : undefined,
            })),
            body: this.optimizeBlock(m.body),
          })),
        };

      case 'StructDeclaration':
        return {
          ...stmt,
          fields: stmt.fields.map((f) => ({
            ...f,
            defaultValue: f.defaultValue ? this.optimizeExpression(f.defaultValue) : undefined,
          })),
          methods: stmt.methods.map((m) => ({
            ...m,
            body: this.optimizeBlock(m.body),
          })),
        };

      case 'BlockStatement':
        return this.optimizeBlock(stmt);

      case 'IfStatement':
        return {
          ...stmt,
          condition: this.optimizeExpression(stmt.condition),
          consequent: this.optimizeBlock(stmt.consequent),
          elifBranches: stmt.elifBranches.map((b) => ({
            ...b,
            condition: this.optimizeExpression(b.condition),
            consequent: this.optimizeBlock(b.consequent),
          })),
          alternate: stmt.alternate ? this.optimizeBlock(stmt.alternate) : undefined,
        };

      case 'ForInStatement':
        return {
          ...stmt,
          iterable: this.optimizeExpression(stmt.iterable),
          body: this.optimizeBlock(stmt.body),
        };

      case 'CForStatement':
        return {
          ...stmt,
          init: stmt.init ? this.optimizeStatement(stmt.init) : undefined,
          condition: stmt.condition ? this.optimizeExpression(stmt.condition) : undefined,
          update: stmt.update ? this.optimizeExpression(stmt.update) : undefined,
          body: this.optimizeBlock(stmt.body),
        };

      case 'WhileStatement':
      case 'DoWhileStatement':
        return {
          ...stmt,
          condition: this.optimizeExpression(stmt.condition),
          body: this.optimizeBlock(stmt.body),
        };

      case 'LoopStatement':
        return {
          ...stmt,
          body: this.optimizeBlock(stmt.body),
        };

      case 'RepeatStatement':
        return {
          ...stmt,
          count: this.optimizeExpression(stmt.count),
          body: this.optimizeBlock(stmt.body),
        };

      case 'ReturnStatement':
        return {
          ...stmt,
          value: stmt.value ? this.optimizeExpression(stmt.value) : undefined,
        };

      case 'TryCatchStatement':
        return {
          ...stmt,
          tryBlock: this.optimizeBlock(stmt.tryBlock),
          catchBlock: this.optimizeBlock(stmt.catchBlock),
        };

      case 'ThrowStatement':
        return {
          ...stmt,
          value: this.optimizeExpression(stmt.value),
        };

      case 'DeferStatement':
        return {
          ...stmt,
          statement: this.optimizeStatement(stmt.statement),
        };

      case 'DropStatement':
        return {
          ...stmt,
          target: this.optimizeExpression(stmt.target),
        };

      case 'ScopeStatement':
        return {
          ...stmt,
          body: this.optimizeBlock(stmt.body),
        };

      case 'ExpressionStatement':
        return {
          ...stmt,
          expression: this.optimizeExpression(stmt.expression),
        };

      case 'EnumDeclaration':
      case 'TraitDeclaration':
      case 'ImportStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'StyleStatement':
        return stmt;
    }
  }

  private optimizeExpression(expr: ExpressionNode): ExpressionNode {
    switch (expr.kind) {
      case 'BinaryExpression': {
        const left = this.optimizeExpression(expr.left);
        const right = this.optimizeExpression(expr.right);
        if (this.options.foldConstants && left.kind === 'Literal' && right.kind === 'Literal') {
          const folded = this.foldBinaryLiterals(expr.operator, left, right, expr.line, expr.column);
          if (folded) {
            this.foldedConstants++;
            return folded;
          }
        }
        return { ...expr, left, right };
      }

      case 'LogicalExpression': {
        const left = this.optimizeExpression(expr.left);
        const right = this.optimizeExpression(expr.right);
        if (
          this.options.foldConstants &&
          left.kind === 'Literal' &&
          left.literalType === 'bool' &&
          right.kind === 'Literal' &&
          right.literalType === 'bool'
        ) {
          this.foldedConstants++;
          return {
            kind: 'Literal',
            literalType: 'bool',
            value:
              expr.operator === 'and'
                ? Boolean(left.value) && Boolean(right.value)
                : Boolean(left.value) || Boolean(right.value),
            line: expr.line,
            column: expr.column,
          };
        }
        if (
          this.options.foldConstants &&
          expr.operator === '??' &&
          left.kind === 'Literal'
        ) {
          this.foldedConstants++;
          return left.value === null ? right : left;
        }
        return { ...expr, left, right };
      }

      case 'UnaryExpression': {
        const operand = this.optimizeExpression(expr.operand);
        if (this.options.foldConstants && operand.kind === 'Literal') {
          if (expr.operator === '-' && typeof operand.value === 'number') {
            this.foldedConstants++;
            return {
              kind: 'Literal',
              literalType: operand.literalType === 'float' ? 'float' : 'int',
              value: -operand.value,
              line: expr.line,
              column: expr.column,
            };
          }
          if (expr.operator === '!' && operand.literalType === 'bool') {
            this.foldedConstants++;
            return {
              kind: 'Literal',
              literalType: 'bool',
              value: !operand.value,
              line: expr.line,
              column: expr.column,
            };
          }
        }
        return { ...expr, operand };
      }

      case 'ConditionalExpression': {
        const condition = this.optimizeExpression(expr.condition);
        const consequent = this.optimizeExpression(expr.consequent);
        const alternate = this.optimizeExpression(expr.alternate);
        if (
          this.options.foldConstants &&
          condition.kind === 'Literal' &&
          condition.literalType === 'bool'
        ) {
          this.foldedConstants++;
          return condition.value ? consequent : alternate;
        }
        return { ...expr, condition, consequent, alternate };
      }

      case 'AssignmentExpression':
        return {
          ...expr,
          target: this.optimizeExpression(expr.target),
          value: this.optimizeExpression(expr.value),
        };

      case 'UpdateExpression':
        return {
          ...expr,
          argument: this.optimizeExpression(expr.argument),
        };

      case 'CallExpression':
        return {
          ...expr,
          callee: this.optimizeExpression(expr.callee),
          args: expr.args.map((a) => this.optimizeExpression(a)),
        };

      case 'MemberExpression':
        return {
          ...expr,
          object: this.optimizeExpression(expr.object),
        };

      case 'IndexExpression':
        return {
          ...expr,
          object: this.optimizeExpression(expr.object),
          index: this.optimizeExpression(expr.index),
        };

      case 'NewExpression':
        return {
          ...expr,
          args: expr.args.map((a) => this.optimizeExpression(a)),
          countExpr: expr.countExpr ? this.optimizeExpression(expr.countExpr) : undefined,
        };

      case 'StructInitExpression':
        return {
          ...expr,
          fields: expr.fields.map((f) => ({ ...f, value: this.optimizeExpression(f.value) })),
        };

      case 'ArrayLiteral':
        return {
          ...expr,
          elements: expr.elements.map((e) => this.optimizeExpression(e)),
        };

      case 'MapLiteral':
        return {
          ...expr,
          entries: expr.entries.map((entry) => ({
            key: this.optimizeExpression(entry.key),
            value: this.optimizeExpression(entry.value),
          })),
        };

      case 'FString':
        return {
          ...expr,
          parts: expr.parts.map((part) =>
            part.kind === 'expr'
              ? { kind: 'expr', expression: this.optimizeExpression(part.expression) }
              : part
          ),
        };

      case 'LambdaExpression':
        return {
          ...expr,
          body:
            expr.body.kind === 'BlockStatement'
              ? this.optimizeBlock(expr.body)
              : this.optimizeExpression(expr.body),
        };

      case 'RangeExpression':
        return {
          ...expr,
          start: this.optimizeExpression(expr.start),
          end: this.optimizeExpression(expr.end),
        };

      case 'PipeExpression':
        return {
          ...expr,
          left: this.optimizeExpression(expr.left),
          right: this.optimizeExpression(expr.right),
        };

      case 'PointerExpression':
        return {
          ...expr,
          argument: this.optimizeExpression(expr.argument),
        };

      case 'MatchExpression':
        return {
          ...expr,
          subject: this.optimizeExpression(expr.subject),
          arms: expr.arms.map((arm) => ({
            ...arm,
            body:
              arm.body.kind === 'BlockStatement'
                ? this.optimizeBlock(arm.body)
                : this.optimizeExpression(arm.body),
          })),
        };

      case 'Identifier':
      case 'Literal':
      case 'SelfExpression':
      case 'SuperExpression':
        return expr;
    }
  }

  private foldBinaryLiterals(
    op: string,
    left: LiteralNode,
    right: LiteralNode,
    line: number,
    column: number
  ): LiteralNode | null {
    if (typeof left.value === 'number' && typeof right.value === 'number') {
      let result: number | boolean | null = null;
      switch (op) {
        case '+': result = left.value + right.value; break;
        case '-': result = left.value - right.value; break;
        case '*': result = left.value * right.value; break;
        case '/':
          if (right.value === 0) return null;
          result = left.value / right.value;
          break;
        case '%':
          if (right.value === 0) return null;
          result = left.value % right.value;
          break;
        case '**': result = left.value ** right.value; break;
        case '==': result = left.value === right.value; break;
        case '!=': result = left.value !== right.value; break;
        case '<': result = left.value < right.value; break;
        case '<=': result = left.value <= right.value; break;
        case '>': result = left.value > right.value; break;
        case '>=': result = left.value >= right.value; break;
      }
      if (typeof result === 'number') {
        return {
          kind: 'Literal',
          literalType: Number.isInteger(result) ? 'int' : 'float',
          value: result,
          line,
          column,
        };
      }
      if (typeof result === 'boolean') {
        return { kind: 'Literal', literalType: 'bool', value: result, line, column };
      }
    }

    if (typeof left.value === 'string' && typeof right.value === 'string') {
      if (op === '+') {
        return {
          kind: 'Literal',
          literalType: 'str',
          value: left.value + right.value,
          line,
          column,
        };
      }
      if (op === '==') {
        return { kind: 'Literal', literalType: 'bool', value: left.value === right.value, line, column };
      }
      if (op === '!=') {
        return { kind: 'Literal', literalType: 'bool', value: left.value !== right.value, line, column };
      }
    }

    if (typeof left.value === 'boolean' && typeof right.value === 'boolean') {
      if (op === '==') {
        return { kind: 'Literal', literalType: 'bool', value: left.value === right.value, line, column };
      }
      if (op === '!=') {
        return { kind: 'Literal', literalType: 'bool', value: left.value !== right.value, line, column };
      }
    }

    return null;
  }

  private treeShakeFunctions(body: StatementNode[]): StatementNode[] {
    // Collect all declared non-exported top-level functions (excluding `main`)
    const candidates = new Set<string>();
    for (const stmt of body) {
      if (stmt.kind === 'FunctionDeclaration' && !stmt.isExported && stmt.name !== 'main') {
        candidates.add(stmt.name);
      }
    }
    if (candidates.size === 0) return body;

    // Collect references iteratively until fixed point
    const referenced = new Set<string>();
    const nonFunctionRefs = new Set<string>();
    for (const stmt of body) {
      if (stmt.kind !== 'FunctionDeclaration') {
        this.collectIdentifierRefsInStmt(stmt, nonFunctionRefs);
      } else if (stmt.isExported || stmt.name === 'main') {
        this.collectIdentifierRefsInStmt(stmt.body, nonFunctionRefs);
      }
    }

    for (const ref of nonFunctionRefs) referenced.add(ref);

    // Propagate through reachable functions
    const fnMap = new Map<string, Extract<StatementNode, { kind: 'FunctionDeclaration' }>>();
    for (const stmt of body) {
      if (stmt.kind === 'FunctionDeclaration') {
        fnMap.set(stmt.name, stmt);
      }
    }

    const queue = Array.from(referenced);
    while (queue.length > 0) {
      const fnName = queue.pop()!;
      const fnNode = fnMap.get(fnName);
      if (!fnNode) continue;
      const innerRefs = new Set<string>();
      this.collectIdentifierRefsInStmt(fnNode.body, innerRefs);
      for (const inner of innerRefs) {
        if (!referenced.has(inner)) {
          referenced.add(inner);
          queue.push(inner);
        }
      }
    }

    const shaken: string[] = [];
    const filtered = body.filter((stmt) => {
      if (stmt.kind === 'FunctionDeclaration' && candidates.has(stmt.name) && !referenced.has(stmt.name)) {
        shaken.push(stmt.name);
        return false;
      }
      return true;
    });

    this.shakenFunctions = shaken;
    return filtered;
  }

  private collectIdentifierRefsInStmt(stmt: StatementNode, out: Set<string>): void {
    switch (stmt.kind) {
      case 'VarDeclaration':
        if (stmt.initializer) this.collectIdentifierRefsInExpr(stmt.initializer, out);
        break;
      case 'MultiVarDeclaration':
        for (const d of stmt.declarations) {
          if (d.initializer) this.collectIdentifierRefsInExpr(d.initializer, out);
        }
        break;
      case 'FunctionDeclaration':
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'ClassDeclaration':
        for (const f of stmt.fields) {
          if (f.initializer) this.collectIdentifierRefsInExpr(f.initializer, out);
        }
        for (const m of stmt.methods) this.collectIdentifierRefsInStmt(m.body, out);
        break;
      case 'StructDeclaration':
        for (const f of stmt.fields) {
          if (f.defaultValue) this.collectIdentifierRefsInExpr(f.defaultValue, out);
        }
        for (const m of stmt.methods) this.collectIdentifierRefsInStmt(m.body, out);
        break;
      case 'BlockStatement':
        for (const s of stmt.statements) this.collectIdentifierRefsInStmt(s, out);
        break;
      case 'IfStatement':
        this.collectIdentifierRefsInExpr(stmt.condition, out);
        this.collectIdentifierRefsInStmt(stmt.consequent, out);
        for (const b of stmt.elifBranches) {
          this.collectIdentifierRefsInExpr(b.condition, out);
          this.collectIdentifierRefsInStmt(b.consequent, out);
        }
        if (stmt.alternate) this.collectIdentifierRefsInStmt(stmt.alternate, out);
        break;
      case 'ForInStatement':
        this.collectIdentifierRefsInExpr(stmt.iterable, out);
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'CForStatement':
        if (stmt.init) this.collectIdentifierRefsInStmt(stmt.init, out);
        if (stmt.condition) this.collectIdentifierRefsInExpr(stmt.condition, out);
        if (stmt.update) this.collectIdentifierRefsInExpr(stmt.update, out);
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.collectIdentifierRefsInExpr(stmt.condition, out);
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'LoopStatement':
      case 'ScopeStatement':
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'RepeatStatement':
        this.collectIdentifierRefsInExpr(stmt.count, out);
        this.collectIdentifierRefsInStmt(stmt.body, out);
        break;
      case 'ReturnStatement':
        if (stmt.value) this.collectIdentifierRefsInExpr(stmt.value, out);
        break;
      case 'TryCatchStatement':
        this.collectIdentifierRefsInStmt(stmt.tryBlock, out);
        this.collectIdentifierRefsInStmt(stmt.catchBlock, out);
        break;
      case 'ThrowStatement':
        this.collectIdentifierRefsInExpr(stmt.value, out);
        break;
      case 'DeferStatement':
        this.collectIdentifierRefsInStmt(stmt.statement, out);
        break;
      case 'DropStatement':
        this.collectIdentifierRefsInExpr(stmt.target, out);
        break;
      case 'ExpressionStatement':
        this.collectIdentifierRefsInExpr(stmt.expression, out);
        break;
      default:
        break;
    }
  }

  private collectIdentifierRefsInExpr(expr: ExpressionNode, out: Set<string>): void {
    switch (expr.kind) {
      case 'Identifier':
        out.add(expr.name);
        break;
      case 'FString':
        for (const p of expr.parts) {
          if (p.kind === 'expr') this.collectIdentifierRefsInExpr(p.expression, out);
        }
        break;
      case 'ArrayLiteral':
        for (const e of expr.elements) this.collectIdentifierRefsInExpr(e, out);
        break;
      case 'MapLiteral':
        for (const e of expr.entries) {
          this.collectIdentifierRefsInExpr(e.key, out);
          this.collectIdentifierRefsInExpr(e.value, out);
        }
        break;
      case 'BinaryExpression':
      case 'LogicalExpression':
      case 'PipeExpression':
        this.collectIdentifierRefsInExpr(expr.left, out);
        this.collectIdentifierRefsInExpr(expr.right, out);
        break;
      case 'UnaryExpression':
        this.collectIdentifierRefsInExpr(expr.operand, out);
        break;
      case 'UpdateExpression':
        this.collectIdentifierRefsInExpr(expr.argument, out);
        break;
      case 'ConditionalExpression':
        this.collectIdentifierRefsInExpr(expr.condition, out);
        this.collectIdentifierRefsInExpr(expr.consequent, out);
        this.collectIdentifierRefsInExpr(expr.alternate, out);
        break;
      case 'AssignmentExpression':
        this.collectIdentifierRefsInExpr(expr.target, out);
        this.collectIdentifierRefsInExpr(expr.value, out);
        break;
      case 'CallExpression':
        this.collectIdentifierRefsInExpr(expr.callee, out);
        for (const a of expr.args) this.collectIdentifierRefsInExpr(a, out);
        break;
      case 'MemberExpression':
        this.collectIdentifierRefsInExpr(expr.object, out);
        break;
      case 'IndexExpression':
        this.collectIdentifierRefsInExpr(expr.object, out);
        this.collectIdentifierRefsInExpr(expr.index, out);
        break;
      case 'NewExpression':
        if (expr.countExpr) this.collectIdentifierRefsInExpr(expr.countExpr, out);
        for (const a of expr.args) this.collectIdentifierRefsInExpr(a, out);
        break;
      case 'StructInitExpression':
        for (const f of expr.fields) this.collectIdentifierRefsInExpr(f.value, out);
        break;
      case 'LambdaExpression':
        if (expr.body.kind === 'BlockStatement') this.collectIdentifierRefsInStmt(expr.body, out);
        else this.collectIdentifierRefsInExpr(expr.body, out);
        break;
      case 'RangeExpression':
        this.collectIdentifierRefsInExpr(expr.start, out);
        this.collectIdentifierRefsInExpr(expr.end, out);
        break;
      case 'MatchExpression':
        this.collectIdentifierRefsInExpr(expr.subject, out);
        for (const arm of expr.arms) {
          if (arm.body.kind === 'BlockStatement') this.collectIdentifierRefsInStmt(arm.body, out);
          else this.collectIdentifierRefsInExpr(arm.body, out);
        }
        break;
      case 'PointerExpression':
        this.collectIdentifierRefsInExpr(expr.argument, out);
        break;
      default:
        break;
    }
  }
}

export function optimizeAST(program: ProgramNode, options?: OptimizeOptions): OptimizeResult {
  return new ASTOptimizer(options).optimize(program);
}
