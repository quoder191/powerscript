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
  minify?: boolean;
  refFunctionParams?: Record<string, boolean[]>;
}

export interface SourceMapping {
  generatedLine: number;
  sourceLine: number;
  sourceColumn: number;
  kind: string;
}

export interface GenerateOutput {
  code: string;
  sourceMap: SourceMapping[];
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

const PRIMITIVE_ALLOC_TYPES = new Set([
  'int', 'float', 'number', 'double', 'long', 'short', 'char',
  'str', 'string', 'text', 'bool', 'boolean', 'any', 'ptr',
]);

export class Generator {
  private readonly indentSize: number;
  private readonly includeRuntime: boolean;
  private readonly asyncFunctions: Set<string>;
  private readonly interactiveAsync: boolean;
  private readonly minify: boolean;
  private readonly refFunctionParams: Record<string, boolean[]>;
  private readonly mappings: SourceMapping[] = [];
  private readonly scopeRefStack: Array<Map<string, boolean>> = [new Map()];
  private indentLevel = 0;
  private tempCounter = 0;

  constructor(options: GeneratorOptions = {}) {
    this.includeRuntime = options.includeRuntime ?? true;
    this.indentSize = options.indentSize ?? 2;
    this.asyncFunctions = new Set(options.asyncFunctions ?? []);
    this.interactiveAsync = options.interactiveAsync ?? false;
    this.minify = options.minify ?? false;
    this.refFunctionParams = options.refFunctionParams ?? {};
  }

  private pushRefScope(): void {
    this.scopeRefStack.push(new Map());
  }

  private popRefScope(): void {
    if (this.scopeRefStack.length > 1) {
      this.scopeRefStack.pop();
    }
  }

  private setScopeRef(name: string, isRef: boolean): void {
    this.scopeRefStack[this.scopeRefStack.length - 1].set(name, isRef);
  }

  private isRefVar(name: string): boolean {
    for (let i = this.scopeRefStack.length - 1; i >= 0; i--) {
      if (this.scopeRefStack[i].has(name)) {
        return Boolean(this.scopeRefStack[i].get(name));
      }
    }
    return false;
  }

  private hasSuperCall(block: BlockStatementNode): boolean {
    const checkExpr = (e?: ExpressionNode): boolean => {
      if (!e) return false;
      if (e.kind === 'CallExpression' && e.callee.kind === 'SuperExpression') return true;
      if (e.kind === 'AssignmentExpression') return checkExpr(e.value);
      if (e.kind === 'ConditionalExpression') return checkExpr(e.consequent) || checkExpr(e.alternate);
      return false;
    };
    const checkStmts = (stmts: StatementNode[]): boolean => {
      for (const s of stmts) {
        if (s.kind === 'ExpressionStatement' && checkExpr(s.expression)) return true;
        if (s.kind === 'VarDeclaration' && checkExpr(s.initializer)) return true;
        if (s.kind === 'BlockStatement' && checkStmts(s.statements)) return true;
      }
      return false;
    };
    return checkStmts(block.statements);
  }

  private emitAddrOf(target: ExpressionNode, labelName = 'ptr', isConst = false): string {
    if (target.kind === 'Identifier') {
      const n = target.name;
      if (this.isRefVar(n)) {
        return `__ejs.addrOf(() => ${n}.get(), (__v) => { ${n}.set(__v); }, ${JSON.stringify(n)}, ${isConst})`;
      }
      return `__ejs.addrOf(() => ${n}, (__v) => { ${n} = __v; }, ${JSON.stringify(n)}, ${isConst})`;
    }
    if (target.kind === 'MemberExpression') {
      const objVar = this.nextTemp('__obj');
      const objExpr = this.emitExpression(target.object);
      const prop = target.property;
      return `((${objVar}) => __ejs.addrOf(() => ${objVar}.${prop}, (__v) => { ${objVar}.${prop} = __v; }, ${JSON.stringify(`${labelName}.${prop}`)}, ${isConst}))(${objExpr})`;
    }
    if (target.kind === 'IndexExpression') {
      const objVar = this.nextTemp('__arr');
      const idxVar = this.nextTemp('__idx');
      const objExpr = this.emitExpression(target.object);
      const idxExpr = this.emitExpression(target.index);
      return `((${objVar}, ${idxVar}) => __ejs.addrOf(() => ${objVar}[${idxVar}], (__v) => { ${objVar}[${idxVar}] = __v; }, ${JSON.stringify(`${labelName}[]`)}, ${isConst}))(${objExpr}, ${idxExpr})`;
    }
    if (target.kind === 'PointerExpression' && target.op === 'deref') {
      return this.emitExpression(target.argument);
    }
    const valExpr = this.emitExpression(target);
    return `__ejs.addrOf(() => ${valExpr}, null, ${JSON.stringify(labelName)}, ${isConst})`;
  }

  public generate(program: ProgramNode): string {
    return this.generateWithSourceMap(program).code;
  }

  public generateWithSourceMap(program: ProgramNode): GenerateOutput {
    this.mappings.length = 0;
    const lines: string[] = [];
    let currentGenLine = 1;

    if (this.includeRuntime) {
      const prelude = buildRuntimePrelude().trimEnd();
      lines.push(prelude);
      currentGenLine += prelude.split('\n').length;
    }

    const bodyLines: string[] = [];
    if (this.includeRuntime) {
      bodyLines.push('{');
      currentGenLine++;
    }

    for (const stmt of program.body) {
      const emitted = this.emitStatement(stmt);
      const stmtLines = emitted.split('\n');
      this.mappings.push({
        generatedLine: currentGenLine,
        sourceLine: stmt.line,
        sourceColumn: stmt.column,
        kind: stmt.kind,
      });
      bodyLines.push(emitted);
      currentGenLine += stmtLines.length;
    }

    if (this.includeRuntime) {
      bodyLines.push('}');
    }

    if (program.body.length > 0) {
      lines.push(bodyLines.join('\n'));
    }

    let code = lines.join('\n').trimEnd() + '\n';
    if (this.minify) {
      code = this.minifyUserSection(code);
    }

    return {
      code,
      sourceMap: [...this.mappings],
    };
  }

  private minifyUserSection(fullCode: string): string {
    const marker = '// --- EasyJS Program ---';
    const minifyChunk = (src: string) =>
      src
        .replace(/\/\/[^\n]*/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s*([{}:;,()[\]=+\-*/<>!&|?]+)\s*/g, '$1')
        .replace(/\b(let|const|function|return|if|else|for|while|new|class|extends|async|await|throw|catch|of)\b/g, ' $1 ')
        .replace(/\s+/g, ' ')
        .trim();

    if (fullCode.includes(marker)) {
      const idx = fullCode.indexOf(marker);
      const head = fullCode.slice(0, idx + marker.length);
      const body = fullCode.slice(idx + marker.length);
      return `${head}\n${minifyChunk(body)}\n`;
    }
    return minifyChunk(fullCode) + '\n';
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
        if (stmt.pointerMode === 'cpp_ref') {
          const refInit = stmt.initializer
            ? this.emitAddrOf(stmt.initializer, stmt.name, Boolean(stmt.typeAnnotation?.isConst))
            : `__ejs.addrOf(() => null, null, ${JSON.stringify(stmt.name)}, ${Boolean(stmt.typeAnnotation?.isConst)})`;
          this.setScopeRef(stmt.name, true);
          return `${pad}const ${stmt.name} = ${refInit};`;
        }

        this.setScopeRef(stmt.name, false);

        if (!stmt.initializer) {
          if (stmt.pointerMode === 'ptr' || stmt.pointerMode === 'unique' || stmt.pointerMode === 'weak') {
            return `${pad}${keyword} ${stmt.name} = null;`;
          }
          if (stmt.typeAnnotation) {
            return `${pad}${keyword} ${stmt.name} = ${this.defaultValueForType(stmt.typeAnnotation.name)};`;
          }
          return `${pad}${keyword} ${stmt.name};`;
        }

        if (
          stmt.pointerMode === 'ptr' &&
          stmt.initializer.kind === 'PointerExpression' &&
          (stmt.initializer.op === 'addr' || stmt.initializer.op === 'borrow')
        ) {
          const ptrInit = this.emitAddrOf(
            stmt.initializer.argument,
            stmt.name,
            Boolean(stmt.typeAnnotation?.isConst)
          );
          return `${pad}${keyword} ${stmt.name} = ${ptrInit};`;
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
        } else if (stmt.pointerMode === 'ref') {
          if (
            stmt.initializer.kind === 'PointerExpression' &&
            (stmt.initializer.op === 'borrow' || stmt.initializer.op === 'addr')
          ) {
            initExpr = `__ejs.borrow(${this.emitExpression(stmt.initializer.argument)}, ${JSON.stringify(stmt.name)})`;
          } else if (stmt.initializer.kind !== 'PointerExpression') {
            initExpr = `__ejs.borrow(${initExpr}, ${JSON.stringify(stmt.name)})`;
          }
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

      case 'MultiVarDeclaration':
        return stmt.declarations.map((d) => this.emitStatement(d)).join('\n');

      case 'ImportStatement': {
        const modExpr = `__ejs.loadModule(${JSON.stringify(stmt.modulePath)})`;
        if (stmt.namedImports.length > 0) {
          return `${pad}const { ${stmt.namedImports.join(', ')} } = ${modExpr};`;
        }
        const bindName = stmt.alias ?? stmt.defaultImport ?? 'mod';
        return `${pad}const ${bindName} = ${modExpr};`;
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

      case 'ForInStatement': {
        this.pushRefScope();
        this.setScopeRef(stmt.variable, false);
        const out = `${pad}for (const ${stmt.variable} of __ejs.iter(${this.emitExpression(stmt.iterable)})) ${this.emitInlineBlock(stmt.body)}`;
        this.popRefScope();
        return out;
      }

      case 'CForStatement': {
        this.pushRefScope();
        const initStr = stmt.init
          ? this.emitStatement(stmt.init).trim().replace(/;$/, '')
          : '';
        const condStr = stmt.condition ? this.emitExpression(stmt.condition) : '';
        const updStr = stmt.update ? this.emitExpression(stmt.update) : '';
        const out = `${pad}for (${initStr}; ${condStr}; ${updStr}) ${this.emitInlineBlock(stmt.body)}`;
        this.popRefScope();
        return out;
      }

      case 'WhileStatement':
        return `${pad}while (${this.emitExpression(stmt.condition)}) ${this.emitInlineBlock(stmt.body)}`;

      case 'DoWhileStatement':
        return `${pad}do ${this.emitInlineBlock(stmt.body)} while (${this.emitExpression(stmt.condition)});`;

      case 'LoopStatement':
        return `${pad}while (true) ${this.emitInlineBlock(stmt.body)}`;

      case 'RepeatStatement': {
        const idxVar = this.nextTemp('__rep');
        return `${pad}for (let ${idxVar} = 0; ${idxVar} < (${this.emitExpression(stmt.count)}); ${idxVar}++) ${this.emitInlineBlock(stmt.body)}`;
      }

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
        const tryStr = this.emitInlineBlock(stmt.tryBlock);
        this.pushRefScope();
        if (stmt.catchVar) this.setScopeRef(stmt.catchVar, false);
        const catchStr = this.emitInlineBlock(stmt.catchBlock);
        this.popRefScope();
        return `${pad}try ${tryStr} catch ${catchBinding} ${catchStr}`;
      }

      case 'ThrowStatement':
        return `${pad}throw ${this.emitExpression(stmt.value)};`;

      case 'DeferStatement':
        return `${pad}${this.emitStatement(stmt.statement).trimStart()}`;

      case 'DropStatement':
        return `${pad}__ejs.drop(${this.emitExpression(stmt.target)}, ${Boolean(stmt.isArrayDelete)});`;

      case 'ScopeStatement': {
        const label = stmt.name ? `${pad}// scope ${stmt.name}\n` : '';
        return `${label}${this.emitBlock(stmt.body)}`;
      }

      case 'StyleStatement':
        return `${pad}__ejs.yourgui.css(${JSON.stringify(stmt.css)});`;

      case 'ExpressionStatement':
        return `${pad}${this.emitExpression(stmt.expression)};`;
    }
  }

  private emitFunctionDecl(fn: FunctionDeclarationNode): string {
    const pad = this.indent();
    this.pushRefScope();
    for (const p of fn.params) {
      this.setScopeRef(p.name, Boolean(p.typeAnnotation?.isReference));
    }
    const params = this.emitParams(fn.params);
    const prefix = fn.isExported ? 'export ' : '';
    const blockCode = this.emitInlineBlock(fn.body, false);
    this.popRefScope();
    const needsAsync =
      this.interactiveAsync && (this.asyncFunctions.has(fn.name) || blockCode.includes('(await '));
    const asyncKw = needsAsync ? 'async ' : '';
    return `${pad}${prefix}${asyncKw}function ${fn.name}(${params}) ${blockCode}`;
  }

  private emitClassDecl(cls: ClassDeclarationNode): string {
    const pad = this.indent();
    const ext = cls.superClass ? ` extends ${cls.superClass}` : '';
    const lines: string[] = [`${pad}class ${cls.name}${ext} {`];
    this.indentLevel++;

    const innerPad = this.indent();
    for (const field of cls.fields) {
      if (!field.initializer && !field.isStatic) continue;
      const staticKw = field.isStatic ? 'static ' : '';
      const init = field.initializer ? ` = ${this.emitExpression(field.initializer)}` : '';
      lines.push(`${innerPad}${staticKw}${field.name}${init};`);
    }

    for (const method of cls.methods) {
      this.pushRefScope();
      for (const p of method.params) {
        this.setScopeRef(p.name, Boolean(p.typeAnnotation?.isReference));
      }
      const staticKw = method.isStatic ? 'static ' : '';
      const methodName = method.isConstructor ? 'constructor' : method.name;
      const params = this.emitParams(method.params);
      let blockCode = this.emitInlineBlock(method.body, false);
      if (method.isConstructor && cls.superClass && !this.hasSuperCall(method.body)) {
        if (blockCode === '{}') {
          blockCode = '{ super(); }';
        } else {
          blockCode = blockCode.replace(/^\{\n?/, `{\n${innerPad}  super();\n`);
        }
      }
      this.popRefScope();
      const asyncKw =
        this.interactiveAsync && !method.isConstructor && blockCode.includes('(await ')
          ? 'async '
          : '';
      lines.push(`${innerPad}${staticKw}${asyncKw}${methodName}(${params}) ${blockCode}`);
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
      this.pushRefScope();
      for (const p of method.params) {
        this.setScopeRef(p.name, Boolean(p.typeAnnotation?.isReference));
      }
      const params = this.emitParams(method.params);
      const blockCode = this.emitInlineBlock(method.body, false);
      this.popRefScope();
      lines.push(`${innerPad}${method.name}(${params}) ${blockCode}`);
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

  private emitBlock(block: BlockStatementNode, createScope = true): string {
    const pad = this.indent();
    if (block.statements.length === 0) return `${pad}{}`;
    if (createScope) this.pushRefScope();
    this.indentLevel++;
    const body = this.emitStatements(block.statements);
    this.indentLevel--;
    if (createScope) this.popRefScope();
    return `${pad}{\n${body}\n${pad}}`;
  }

  private emitInlineBlock(block: BlockStatementNode, createScope = true): string {
    const pad = this.indent();
    if (block.statements.length === 0) return '{}';
    if (createScope) this.pushRefScope();
    this.indentLevel++;
    const body = this.emitStatements(block.statements);
    this.indentLevel--;
    if (createScope) this.popRefScope();
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
        return this.isRefVar(expr.name) ? `${expr.name}.get()` : expr.name;

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
        if (expr.operator === '+') {
          return `__ejs.ptrAdd(${this.emitExpression(expr.left)}, ${this.emitExpression(expr.right)})`;
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

      case 'ConditionalExpression':
        return `(${this.emitExpression(expr.condition)} ? ${this.emitExpression(expr.consequent)} : ${this.emitExpression(expr.alternate)})`;

      case 'UnaryExpression':
        return `(${expr.operator}${this.emitExpression(expr.operand)})`;

      case 'UpdateExpression': {
        if (expr.argument.kind === 'Identifier' && this.isRefVar(expr.argument.name)) {
          const n = expr.argument.name;
          const delta = expr.operator === '++' ? '+ 1' : '- 1';
          if (expr.prefix) {
            return `${n}.set(${n}.get() ${delta})`;
          }
          const tmp = this.nextTemp('__old');
          return `((${tmp}) => (${n}.set(${tmp} ${delta}), ${tmp}))(${n}.get())`;
        }
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
        if (expr.target.kind === 'Identifier' && this.isRefVar(expr.target.name)) {
          const n = expr.target.name;
          const valExpr = this.emitExpression(expr.value);
          if (expr.operator === '=') {
            return `${n}.set(${valExpr})`;
          }
          const rawOp = expr.operator.slice(0, -1);
          return `${n}.set(${n}.get() ${rawOp} ${valExpr})`;
        }
        return `${this.emitExpression(expr.target)} ${expr.operator} ${this.emitExpression(expr.value)}`;
      }

      case 'CallExpression': {
        const refMask =
          expr.callee.kind === 'Identifier' ? this.refFunctionParams[expr.callee.name] : undefined;
        const argsList = expr.args
          .map((a, idx) =>
            refMask?.[idx] ? this.emitAddrOf(a, `arg${idx}`, false) : this.emitExpression(a)
          )
          .join(', ');

        if (expr.callee.kind === 'MemberExpression') {
          if (
            expr.callee.object.kind === 'SuperExpression' ||
            expr.callee.object.kind === 'SelfExpression'
          ) {
            return `${this.emitExpression(expr.callee)}(${argsList})`;
          }
          const objExpr = this.emitExpression(expr.callee.object);
          const methodLit = JSON.stringify(expr.callee.property);
          const callStr = `__ejs.call(${objExpr}, ${methodLit}, [${argsList}], ${expr.callee.optional})`;
          if (
            this.interactiveAsync &&
            expr.callee.object.kind === 'Identifier' &&
            ((expr.callee.object.name === 'server' && expr.callee.property === 'request') ||
              (expr.callee.object.name === 'http' &&
                (expr.callee.property === 'get' || expr.callee.property === 'post')))
          ) {
            return `(await ${callStr})`;
          }
          return callStr;
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

      case 'NewExpression': {
        if (expr.countExpr) {
          return `__ejs.allocArray(${this.emitExpression(expr.countExpr)}, ${JSON.stringify(expr.className)})`;
        }
        if (PRIMITIVE_ALLOC_TYPES.has(expr.className)) {
          const valArg = expr.args.length > 0 ? this.emitExpression(expr.args[0]) : this.defaultValueForType(expr.className);
          return `__ejs.allocSingle(${valArg}, ${JSON.stringify(expr.className)})`;
        }
        return `new ${expr.className}(${expr.args.map((a) => this.emitExpression(a)).join(', ')})`;
      }

      case 'StructInitExpression': {
        const fields = expr.fields
          .map((f) => `${f.name}: ${this.emitExpression(f.value)}`)
          .join(', ');
        return `new ${expr.structName}({ ${fields} })`;
      }

      case 'LambdaExpression': {
        this.pushRefScope();
        for (const p of expr.params) {
          this.setScopeRef(p.name, Boolean(p.typeAnnotation?.isReference));
        }
        const params = this.emitParams(expr.params);
        let bodyStr =
          expr.body.kind === 'BlockStatement'
            ? this.emitInlineBlock(expr.body, false)
            : this.emitExpression(expr.body);
        this.popRefScope();
        if (expr.body.kind === 'MapLiteral') {
          bodyStr = `(${bodyStr})`;
        }
        const asyncKw = this.interactiveAsync && bodyStr.includes('(await ') ? 'async ' : '';
        return `${asyncKw}(${params}) => ${bodyStr}`;
      }

      case 'RangeExpression':
        return `__ejs.range(${this.emitExpression(expr.start)}, ${this.emitExpression(expr.end)}, ${expr.inclusive})`;

      case 'PipeExpression':
        return `${this.emitExpression(expr.right)}(${this.emitExpression(expr.left)})`;

      case 'PointerExpression': {
        switch (expr.op) {
          case 'own':
            return `__ejs.own(${this.emitExpression(expr.argument)})`;
          case 'shared':
            return `__ejs.share(${this.emitExpression(expr.argument)})`;
          case 'borrow':
            return `__ejs.borrow(${this.emitExpression(expr.argument)})`;
          case 'move':
            return `__ejs.move(${this.emitExpression(expr.argument)})`;
          case 'deref':
            return `__ejs.deref(${this.emitExpression(expr.argument)})`;
          case 'addr':
            return this.emitAddrOf(expr.argument, 'ptr', false);
          case 'sizeof':
            return expr.sizeofTypeName
              ? `__ejs.sizeof(${JSON.stringify(expr.sizeofTypeName)})`
              : `__ejs.sizeof(${this.emitExpression(expr.argument)})`;
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

export function generateWithSourceMap(
  program: ProgramNode,
  options?: GeneratorOptions
): GenerateOutput {
  return new Generator(options).generateWithSourceMap(program);
}

