import {
  BlockStatementNode,
  ClassDeclarationNode,
  DeferStatementNode,
  EnumDeclarationNode,
  ExpressionNode,
  FunctionDeclarationNode,
  MatchArmNode,
  ParamNode,
  ProgramNode,
  StatementNode,
  StructDeclarationNode,
} from '../ast/nodes.ts';
import { buildRuntimePrelude } from '../stdlib/index.ts';

export interface GeneratorOptions {
  includeRuntime?: boolean;
  indentSize?: number;
  asyncFunctions?: string[];
  interactiveAsync?: boolean;
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

export class Generator {
  private readonly indentSize: number;
  private readonly includeRuntime: boolean;
  private readonly asyncFunctions: Set<string>;
  private readonly interactiveAsync: boolean;
  private indentLevel = 0;
  private tempCounter = 0;

  constructor(options: GeneratorOptions = {}) {
    this.includeRuntime = options.includeRuntime ?? true;
    this.indentSize = options.indentSize ?? 2;
    this.asyncFunctions = new Set(options.asyncFunctions ?? []);
    this.interactiveAsync = options.interactiveAsync ?? false;
  }

  public generate(program: ProgramNode): string {
    const lines: string[] = [];

    if (this.includeRuntime) {
      lines.push(buildRuntimePrelude().trimEnd());
    }

    const bodyCode = this.emitStatements(program.body);
    if (bodyCode.length > 0) {
      if (this.includeRuntime) {
        lines.push('{');
        lines.push(bodyCode);
        lines.push('}');
      } else {
        lines.push(bodyCode);
      }
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  private indent(): string {
    return ' '.repeat(this.indentLevel * this.indentSize);
  }

  private nextTemp(prefix = '__ejs_tmp'): string {
    return `${prefix}_${++this.tempCounter}`;
  }

  private defaultValueForType(typeName?: string): string {
    switch (typeName) {
      case 'int':
      case 'float':
      case 'number':
        return '0';
      case 'str':
      case 'string':
      case 'text':
        return '""';
      case 'bool':
      case 'boolean':
        return 'false';
      case 'array':
      case 'list':
        return '[]';
      case 'dict':
      case 'map':
        return '{}';
      case 'stack':
        return '__ejs.Stack()';
      case 'queue':
        return '__ejs.Queue()';
      case 'set':
        return '__ejs.Set()';
      default:
        return 'null';
    }
  }

  private emitStatements(statements: StatementNode[]): string {
    const hasDefer = statements.some((s) => s.kind === 'DeferStatement');
    if (!hasDefer) {
      return statements.map((s) => this.emitStatement(s)).join('\n');
    }

    const defers: DeferStatementNode[] = [];
    const regular: StatementNode[] = [];
    for (const s of statements) {
      if (s.kind === 'DeferStatement') defers.push(s);
      else regular.push(s);
    }

    const pad = this.indent();
    const out: string[] = [`${pad}try {`];
    this.indentLevel++;
    for (const r of regular) {
      out.push(this.emitStatement(r));
    }
    this.indentLevel--;
    out.push(`${pad}} finally {`);
    this.indentLevel++;
    for (let i = defers.length - 1; i >= 0; i--) {
      out.push(this.emitStatement(defers[i].statement));
    }
    this.indentLevel--;
    out.push(`${pad}}`);
    return out.join('\n');
  }

  private emitStatement(stmt: StatementNode): string {
    const pad = this.indent();

    switch (stmt.kind) {
      case 'VarDeclaration': {
        const keyword = stmt.mutable ? 'let' : 'const';
        if (!stmt.initializer) {
          if (stmt.typeAnnotation) {
            return `${pad}${keyword} ${stmt.name} = ${this.defaultValueForType(stmt.typeAnnotation.name)};`;
          }
          return `${pad}${keyword} ${stmt.name};`;
        }
        let initExpr = this.emitExpression(stmt.initializer);
        if (
          stmt.pointerMode === 'own' &&
          stmt.initializer.kind !== 'PointerExpression'
        ) {
          initExpr = `__ejs.own(${initExpr}, ${JSON.stringify(stmt.name)})`;
        } else if (
          stmt.pointerMode === 'shared' &&
          stmt.initializer.kind !== 'PointerExpression'
        ) {
          initExpr = `__ejs.share(${initExpr}, ${JSON.stringify(stmt.name)})`;
        } else if (
          stmt.pointerMode === 'ref' &&
          stmt.initializer.kind !== 'PointerExpression'
        ) {
          initExpr = `__ejs.borrow(${initExpr}, ${JSON.stringify(stmt.name)})`;
        } else if (stmt.initializer.kind === 'PointerExpression') {
          if (stmt.initializer.op === 'own') {
            initExpr = `__ejs.own(${this.emitExpression(stmt.initializer.argument)}, ${JSON.stringify(stmt.name)})`;
          } else if (stmt.initializer.op === 'move') {
            initExpr = `__ejs.move(${this.emitExpression(stmt.initializer.argument)}, ${JSON.stringify(stmt.name)})`;
          } else if (stmt.initializer.op === 'borrow') {
            initExpr = `__ejs.borrow(${this.emitExpression(stmt.initializer.argument)}, ${JSON.stringify(stmt.name)})`;
          } else if (stmt.initializer.op === 'shared') {
            initExpr = `__ejs.share(${this.emitExpression(stmt.initializer.argument)}, ${JSON.stringify(stmt.name)})`;
          }
        }
        return `${pad}${keyword} ${stmt.name} = ${initExpr};`;
      }

      case 'FunctionDeclaration':
        return this.emitFunctionDecl(stmt);

      case 'ClassDeclaration':
        return this.emitClassDecl(stmt);

      case 'StructDeclaration':
        return this.emitStructDecl(stmt);

      case 'EnumDeclaration':
        return this.emitEnumDecl(stmt);

      case 'TraitDeclaration':
        return `${pad}// trait ${stmt.name} (validated at compile time)`;

      case 'BlockStatement':
        return this.emitBlock(stmt);

      case 'IfStatement': {
        const lines: string[] = [];
        lines.push(`${pad}if (${this.emitExpression(stmt.condition)}) ${this.emitInlineBlock(stmt.consequent)}`);
        for (const elifBranch of stmt.elifBranches) {
          lines.push(`${pad}else if (${this.emitExpression(elifBranch.condition)}) ${this.emitInlineBlock(elifBranch.consequent)}`);
        }
        if (stmt.alternate) {
          lines.push(`${pad}else ${this.emitInlineBlock(stmt.alternate)}`);
        }
        return lines.join('\n');
      }

      case 'ForInStatement':
        return `${pad}for (const ${stmt.variable} of __ejs.iter(${this.emitExpression(stmt.iterable)})) ${this.emitInlineBlock(stmt.body)}`;

      case 'CForStatement': {
        const initStr = stmt.init
          ? this.emitStatement(stmt.init).trim().replace(/;$/, '')
          : '';
        const condStr = stmt.condition ? this.emitExpression(stmt.condition) : '';
        const updStr = stmt.update ? this.emitExpression(stmt.update) : '';
        return `${pad}for (${initStr}; ${condStr}; ${updStr}) ${this.emitInlineBlock(stmt.body)}`;
      }

      case 'WhileStatement':
        return `${pad}while (${this.emitExpression(stmt.condition)}) ${this.emitInlineBlock(stmt.body)}`;

      case 'LoopStatement':
        return `${pad}while (true) ${this.emitInlineBlock(stmt.body)}`;

      case 'ReturnStatement':
        return stmt.value
          ? `${pad}return ${this.emitExpression(stmt.value)};`
          : `${pad}return;`;

      case 'BreakStatement':
        return `${pad}break;`;

      case 'ContinueStatement':
        return `${pad}continue;`;

      case 'TryCatchStatement': {
        const catchBinding = stmt.catchVar ? `(${stmt.catchVar})` : '';
        return `${pad}try ${this.emitInlineBlock(stmt.tryBlock)} catch ${catchBinding} ${this.emitInlineBlock(stmt.catchBlock)}`;
      }

      case 'ThrowStatement':
        return `${pad}throw ${this.emitExpression(stmt.value)};`;

      case 'DeferStatement':
        return `${pad}${this.emitStatement(stmt.statement).trimStart()}`;

      case 'DropStatement':
        return `${pad}__ejs.drop(${this.emitExpression(stmt.target)});`;

      case 'ScopeStatement': {
        const label = stmt.name ? `${pad}// scope ${stmt.name}\n` : '';
        return `${label}${this.emitBlock(stmt.body)}`;
      }

      case 'ExpressionStatement':
        return `${pad}${this.emitExpression(stmt.expression)};`;
    }
  }

  private emitFunctionDecl(fn: FunctionDeclarationNode): string {
    const pad = this.indent();
    const params = this.emitParams(fn.params);
    const prefix = fn.isExported ? 'export ' : '';
    const asyncKw =
      this.interactiveAsync && this.asyncFunctions.has(fn.name) ? 'async ' : '';
    return `${pad}${prefix}${asyncKw}function ${fn.name}(${params}) ${this.emitInlineBlock(fn.body)}`;
  }

  private emitClassDecl(cls: ClassDeclarationNode): string {
    const pad = this.indent();
    const ext = cls.superClass ? ` extends ${cls.superClass}` : '';
    const lines: string[] = [`${pad}class ${cls.name}${ext} {`];
    this.indentLevel++;

    const innerPad = this.indent();
    for (const field of cls.fields) {
      const staticKw = field.isStatic ? 'static ' : '';
      const init = field.initializer ? ` = ${this.emitExpression(field.initializer)}` : '';
      lines.push(`${innerPad}${staticKw}${field.name}${init};`);
    }

    for (const method of cls.methods) {
      const staticKw = method.isStatic ? 'static ' : '';
      const methodName = method.isConstructor ? 'constructor' : method.name;
      const params = this.emitParams(method.params);
      lines.push(`${innerPad}${staticKw}${methodName}(${params}) ${this.emitInlineBlock(method.body)}`);
    }

    this.indentLevel--;
    lines.push(`${pad}}`);
    return lines.join('\n');
  }

  private emitStructDecl(st: StructDeclarationNode): string {
    const pad = this.indent();
    const lines: string[] = [`${pad}class ${st.name} {`];
    this.indentLevel++;
    const innerPad = this.indent();
    lines.push(`${innerPad}constructor(fields = {}) {`);
    this.indentLevel++;
    const ctorPad = this.indent();
    lines.push(`${ctorPad}this.__structName = ${JSON.stringify(st.name)};`);
    for (const field of st.fields) {
      const fallback = field.defaultValue ? this.emitExpression(field.defaultValue) : 'null';
      lines.push(`${ctorPad}this.${field.name} = fields.${field.name} !== undefined ? fields.${field.name} : ${fallback};`);
    }
    this.indentLevel--;
    lines.push(`${innerPad}}`);

    lines.push(`${innerPad}clone() {`);
    this.indentLevel++;
    const cloneFields = st.fields.map((f) => `${f.name}: this.${f.name}`).join(', ');
    lines.push(`${this.indent()}return new ${st.name}({ ${cloneFields} });`);
    this.indentLevel--;
    lines.push(`${innerPad}}`);

    lines.push(`${innerPad}toString() {`);
    this.indentLevel++;
    const repr = st.fields.map((f) => `${f.name}: \${this.${f.name}}`).join(', ');
    lines.push(`${this.indent()}return \`${st.name} { ${repr} }\`;`);
    this.indentLevel--;
    lines.push(`${innerPad}}`);

    for (const method of st.methods) {
      const params = this.emitParams(method.params);
      lines.push(`${innerPad}${method.name}(${params}) ${this.emitInlineBlock(method.body)}`);
    }

    this.indentLevel--;
    lines.push(`${pad}}`);
    return lines.join('\n');
  }

  private emitEnumDecl(en: EnumDeclarationNode): string {
    const pad = this.indent();
    const lines: string[] = [`${pad}const ${en.name} = Object.freeze({`];
    this.indentLevel++;
    const innerPad = this.indent();

    for (const variant of en.variants) {
      if (variant.fields.length === 0) {
        lines.push(
          `${innerPad}${variant.name}: Object.freeze({ __enumName: ${JSON.stringify(en.name)}, __enumTag: ${JSON.stringify(variant.name)}, __payload: {} }),`
        );
      } else {
        const argsList = variant.fields.join(', ');
        const payloadObj = variant.fields.map((f) => `${f}`).join(', ');
        lines.push(
          `${innerPad}${variant.name}: (${argsList}) => Object.freeze({ __enumName: ${JSON.stringify(en.name)}, __enumTag: ${JSON.stringify(variant.name)}, __payload: { ${payloadObj} } }),`
        );
      }
    }

    this.indentLevel--;
    lines.push(`${pad}});`);
    return lines.join('\n');
  }

  private emitBlock(block: BlockStatementNode): string {
    const pad = this.indent();
    if (block.statements.length === 0) return `${pad}{}`;
    this.indentLevel++;
    const body = this.emitStatements(block.statements);
    this.indentLevel--;
    return `${pad}{\n${body}\n${pad}}`;
  }

  private emitInlineBlock(block: BlockStatementNode): string {
    const pad = this.indent();
    if (block.statements.length === 0) return '{}';
    this.indentLevel++;
    const body = this.emitStatements(block.statements);
    this.indentLevel--;
    return `{\n${body}\n${pad}}`;
  }

  private emitParams(params: ParamNode[]): string {
    return params
      .map((p) =>
        p.defaultValue ? `${p.name} = ${this.emitExpression(p.defaultValue)}` : p.name
      )
      .join(', ');
  }

  private emitExpression(expr: ExpressionNode): string {
    switch (expr.kind) {
      case 'Identifier':
        return expr.name;

      case 'SelfExpression':
        return 'this';

      case 'SuperExpression':
        return 'super';

      case 'Literal':
        if (expr.literalType === 'str') return JSON.stringify(expr.value);
        if (expr.literalType === 'null') return 'null';
        return String(expr.value);

      case 'FString': {
        const chunks = expr.parts.map((part) => {
          if (part.kind === 'text') {
            return part.value
              .replace(/\\/g, '\\\\')
              .replace(/`/g, '\\`')
              .replace(/\$\{/g, '\\${');
          }
          return `\${${this.emitExpression(part.expression)}}`;
        });
        return `\`${chunks.join('')}\``;
      }

      case 'ArrayLiteral':
        return `[${expr.elements.map((e) => this.emitExpression(e)).join(', ')}]`;

      case 'MapLiteral': {
        if (expr.entries.length === 0) return '{}';
        const pairs = expr.entries.map((entry) => {
          if (entry.key.kind === 'Literal' && entry.key.literalType === 'str') {
            return `${JSON.stringify(entry.key.value)}: ${this.emitExpression(entry.value)}`;
          }
          return `[${this.emitExpression(entry.key)}]: ${this.emitExpression(entry.value)}`;
        });
        return `{ ${pairs.join(', ')} }`;
      }

      case 'BinaryExpression': {
        if (expr.operator === 'in') {
          return `__ejs.has(${this.emitExpression(expr.right)}, ${this.emitExpression(expr.left)})`;
        }
        if (expr.operator === 'not in') {
          return `(!__ejs.has(${this.emitExpression(expr.right)}, ${this.emitExpression(expr.left)}))`;
        }
        const op =
          expr.operator === '=='
            ? '==='
            : expr.operator === '!='
              ? '!=='
              : expr.operator === 'is'
                ? 'instanceof'
                : expr.operator;
        return `(${this.emitExpression(expr.left)} ${op} ${this.emitExpression(expr.right)})`;
      }

      case 'LogicalExpression': {
        const op =
          expr.operator === 'and'
            ? '&&'
            : expr.operator === 'or'
              ? '||'
              : '??';
        return `(${this.emitExpression(expr.left)} ${op} ${this.emitExpression(expr.right)})`;
      }

      case 'UnaryExpression':
        return `(${expr.operator}${this.emitExpression(expr.operand)})`;

      case 'UpdateExpression': {
        const target = this.emitExpression(expr.argument);
        return expr.prefix ? `${expr.operator}${target}` : `${target}${expr.operator}`;
      }

      case 'AssignmentExpression': {
        if (expr.target.kind === 'PointerExpression' && expr.target.op === 'deref') {
          const ptrExpr = this.emitExpression(expr.target.argument);
          const valExpr = this.emitExpression(expr.value);
          if (expr.operator === '=') {
            return `__ejs.setDeref(${ptrExpr}, ${valExpr})`;
          }
          const rawOp = expr.operator.slice(0, -1);
          return `__ejs.setDeref(${ptrExpr}, __ejs.deref(${ptrExpr}) ${rawOp} ${valExpr})`;
        }
        return `${this.emitExpression(expr.target)} ${expr.operator} ${this.emitExpression(expr.value)}`;
      }

      case 'CallExpression': {
        const argsList = expr.args.map((a) => this.emitExpression(a)).join(', ');

        if (expr.callee.kind === 'MemberExpression') {
          if (
            expr.callee.object.kind === 'SuperExpression' ||
            expr.callee.object.kind === 'SelfExpression'
          ) {
            return `${this.emitExpression(expr.callee)}(${argsList})`;
          }
          const objExpr = this.emitExpression(expr.callee.object);
          const methodLit = JSON.stringify(expr.callee.property);
          return `__ejs.call(${objExpr}, ${methodLit}, [${argsList}], ${expr.callee.optional})`;
        }

        if (expr.callee.kind === 'Identifier') {
          const fnName = expr.callee.name;
          const callStr = `${fnName}(${argsList})`;
          if (
            this.interactiveAsync &&
            (INTERACTIVE_IO_FUNCTIONS.has(fnName) || this.asyncFunctions.has(fnName))
          ) {
            return `(await ${callStr})`;
          }
          return callStr;
        }

        return `${this.emitExpression(expr.callee)}(${argsList})`;
      }

      case 'MemberExpression': {
        const sep = expr.optional ? '?.' : '.';
        return `${this.emitExpression(expr.object)}${sep}${expr.property}`;
      }

      case 'IndexExpression':
        return `${this.emitExpression(expr.object)}[${this.emitExpression(expr.index)}]`;

      case 'NewExpression':
        return `new ${expr.className}(${expr.args.map((a) => this.emitExpression(a)).join(', ')})`;

      case 'StructInitExpression': {
        const fields = expr.fields
          .map((f) => `${f.name}: ${this.emitExpression(f.value)}`)
          .join(', ');
        return `new ${expr.structName}({ ${fields} })`;
      }

      case 'LambdaExpression': {
        const params = this.emitParams(expr.params);
        if (expr.body.kind === 'BlockStatement') {
          return `(${params}) => ${this.emitInlineBlock(expr.body)}`;
        }
        return `(${params}) => ${this.emitExpression(expr.body)}`;
      }

      case 'RangeExpression':
        return `__ejs.range(${this.emitExpression(expr.start)}, ${this.emitExpression(expr.end)}, ${expr.inclusive})`;

      case 'PipeExpression':
        return `${this.emitExpression(expr.right)}(${this.emitExpression(expr.left)})`;

      case 'PointerExpression': {
        const arg = this.emitExpression(expr.argument);
        switch (expr.op) {
          case 'own':
            return `__ejs.own(${arg})`;
          case 'shared':
            return `__ejs.share(${arg})`;
          case 'borrow':
            return `__ejs.borrow(${arg})`;
          case 'move':
            return `__ejs.move(${arg})`;
          case 'deref':
            return `__ejs.deref(${arg})`;
        }
      }

      case 'MatchExpression':
        return this.emitMatchExpression(expr.subject, expr.arms);
    }
  }

  private emitMatchExpression(subject: ExpressionNode, arms: MatchArmNode[]): string {
    const subjVar = this.nextTemp('__match');
    const lines: string[] = [`((${subjVar}) => {`];

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      const prefix = i === 0 ? 'if' : 'else if';
      const armBody = this.emitMatchArmBody(arm);

      if (arm.pattern.kind === 'WildcardPattern') {
        if (i === 0) {
          lines.push(`  { ${armBody} }`);
        } else {
          lines.push(`  else { ${armBody} }`);
        }
      } else if (arm.pattern.kind === 'LiteralPattern') {
        const lit =
          typeof arm.pattern.value === 'string'
            ? JSON.stringify(arm.pattern.value)
            : String(arm.pattern.value);
        lines.push(`  ${prefix} (${subjVar} === ${lit}) { ${armBody} }`);
      } else if (arm.pattern.kind === 'RangePattern') {
        const cmp = arm.pattern.inclusive ? '<=' : '<';
        lines.push(
          `  ${prefix} (${subjVar} >= ${arm.pattern.start} && ${subjVar} ${cmp} ${arm.pattern.end}) { ${armBody} }`
        );
      } else if (arm.pattern.kind === 'EnumPattern') {
        const enumName = arm.pattern.enumName ? JSON.stringify(arm.pattern.enumName) : 'null';
        const variant = JSON.stringify(arm.pattern.variant);
        const bindings = arm.pattern.bindings;
        const unpack =
          bindings.length > 0
            ? `const [${bindings.join(', ')}] = Object.values(${subjVar}.__payload || {}); `
            : '';
        lines.push(`  ${prefix} (__ejs.matchEnum(${subjVar}, ${enumName}, ${variant})) { ${unpack}${armBody} }`);
      } else if (arm.pattern.kind === 'BindingPattern') {
        lines.push(`  ${prefix} (true) { const ${arm.pattern.name} = ${subjVar}; ${armBody} }`);
      }
    }

    lines.push(`})(${this.emitExpression(subject)})`);
    return lines.join('\n');
  }

  private emitMatchArmBody(arm: MatchArmNode): string {
    if (arm.body.kind === 'BlockStatement') {
      const stmts = arm.body.statements.map((s) => this.emitStatement(s).trim()).join(' ');
      return stmts;
    }
    return `return ${this.emitExpression(arm.body)};`;
  }
}

export function generate(program: ProgramNode, options?: GeneratorOptions): string {
  return new Generator(options).generate(program);
}
