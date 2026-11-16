import {
  BlockStatementNode,
  ClassDeclarationNode,
  ClassFieldNode,
  ClassMethodNode,
  ElifBranch,
  EnumDeclarationNode,
  EnumVariantNode,
  FunctionDeclarationNode,
  ImportStatementNode,
  MultiVarDeclarationNode,
  PointerMode,
  RepeatStatementNode,
  StatementNode,
  StructDeclarationNode,
  StructFieldNode,
  TraitDeclarationNode,
  TraitMethodSignatureNode,
  TypeAnnotationNode,
  VarDeclarationNode,
  Visibility,
} from '../ast/nodes.ts';
import { BUILTIN_TYPES } from '../lexer/keywords.ts';
import { TokenType } from '../lexer/tokens.ts';
import type { Parser } from './parser.ts';

export function parseDeclaration(p: Parser): StatementNode | null {
  p.skipSeparators();
  if (p.isAtEnd() || p.check(TokenType.Dedent) || p.check(TokenType.RightBrace)) return null;

  if (p.match(TokenType.Import)) {
    return parseImportStatement(p);
  }

  const isExported = p.match(TokenType.Export);

  if (p.match(TokenType.Class)) {
    return parseClassDeclaration(p);
  }
  if (p.match(TokenType.Struct)) {
    return parseStructDeclaration(p);
  }
  if (p.match(TokenType.Enum)) {
    return parseEnumDeclaration(p);
  }
  if (p.match(TokenType.Trait)) {
    return parseTraitDeclaration(p);
  }
  if (p.match(TokenType.Fn)) {
    return parseFunctionDeclaration(p, isExported);
  }
  if (p.match(TokenType.Let, TokenType.Var)) {
    return parseVarOrMultiVarDeclaration(p, true);
  }
  if (looksLikeCppTypedDecl(p)) {
    return parseTypeFirstVarDeclaration(p);
  }

  if (p.match(TokenType.Const)) {
    return parseVarOrMultiVarDeclaration(p, false);
  }

  // Type-first variable declaration: e.g. `int x = 10`, `string name = "Alex"`, `dict d = {}`
  if (
    p.check(TokenType.Identifier) &&
    BUILTIN_TYPES.has(p.peek().lexeme) &&
    (p.checkNext(TokenType.Identifier) || p.checkNext(TokenType.Less))
  ) {
    return parseTypeFirstVarDeclaration(p);
  }

  // Pointer-prefixed declarations: `own x = 42`, `ref r = &x`, `shared s = ...`
  if (
    (p.check(TokenType.Own) || p.check(TokenType.Ref) || p.check(TokenType.Shared)) &&
    p.checkNext(TokenType.Identifier)
  ) {
    const modeToken = p.advance();
    const pointerMode = modeToken.lexeme as PointerMode;
    return parseVarDeclaration(p, pointerMode !== 'ref', pointerMode, modeToken.line, modeToken.column);
  }

  return parseStatement(p);
}

export function parseStatement(p: Parser): StatementNode {
  if (p.match(TokenType.If)) return parseIfStatement(p);
  if (p.match(TokenType.For)) return parseForInStatement(p);
  if (p.match(TokenType.While)) return parseWhileStatement(p);
  if (
    p.check(TokenType.Identifier) &&
    p.peek().lexeme === 'do' &&
    (p.peekTokenAt(1).type === TokenType.LeftBrace ||
      p.peekTokenAt(1).type === TokenType.Colon ||
      p.peekTokenAt(1).type === TokenType.Newline)
  ) {
    return parseDoWhileStatement(p);
  }
  if (p.match(TokenType.Loop)) return parseLoopStatement(p);
  if (p.match(TokenType.Repeat)) return parseRepeatStatement(p);
  if (p.match(TokenType.Return)) return parseReturnStatement(p);
  if (p.match(TokenType.Break)) {
    const tok = p.previous();
    p.consumeStatementEnd();
    return { kind: 'BreakStatement', line: tok.line, column: tok.column };
  }
  if (p.match(TokenType.Continue)) {
    const tok = p.previous();
    p.consumeStatementEnd();
    return { kind: 'ContinueStatement', line: tok.line, column: tok.column };
  }
  if (p.match(TokenType.Try)) return parseTryCatchStatement(p);
  if (p.match(TokenType.Throw)) return parseThrowStatement(p);
  if (p.match(TokenType.Defer)) return parseDeferStatement(p);
  if (p.match(TokenType.Drop)) return parseDropStatement(p);
  if (p.check(TokenType.Identifier) && p.peek().lexeme === 'delete') return parseDeleteStatement(p);
  if (p.match(TokenType.Scope)) return parseScopeStatement(p);
  if (p.match(TokenType.Style)) {
    const styleTok = p.previous();
    const blockTok = p.consume(TokenType.StyleBlock, "Expected '{ ... }' CSS block after 'style'.");
    p.consumeStatementEnd();
    return {
      kind: 'StyleStatement',
      css: String(blockTok.literal ?? ''),
      line: styleTok.line,
      column: styleTok.column,
    };
  }
  if (p.check(TokenType.LeftBrace)) return parseBlockStatement(p, 'block');

  const expr = p.parseExpr();
  p.consumeStatementEnd();
  return {
    kind: 'ExpressionStatement',
    expression: expr,
    line: expr.line,
    column: expr.column,
  };
}

export function parseBlockStatement(
  p: Parser,
  contextLabel = 'statement'
): BlockStatementNode {
  if (
    p.check(TokenType.Newline) &&
    (p.peekNonNewline(0).type === TokenType.LeftBrace || p.peekNonNewline(0).type === TokenType.Colon)
  ) {
    p.skipNewlines();
  }

  if (p.match(TokenType.LeftBrace)) {
    const openBrace = p.previous();
    const statements: StatementNode[] = [];
    p.skipSeparators();

    while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
      const startPos = p.getPosition();
      const stmt = parseDeclaration(p);
      if (stmt) {
        statements.push(stmt);
      } else if (p.getPosition() === startPos && !p.isAtEnd()) {
        if (p.check(TokenType.Dedent)) {
          p.advance();
        } else {
          throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' inside block.`);
        }
      }
      p.skipSeparators();
    }

    p.consume(TokenType.RightBrace, "Expected '}' to close block.");
    return {
      kind: 'BlockStatement',
      statements,
      line: openBrace.line,
      column: openBrace.column,
    };
  }

  if (p.match(TokenType.Colon)) {
    const colonTok = p.previous();
    const statements: StatementNode[] = [];

    // Single-line indented or inline block: `if age > 18: print("Adult")`
    if (
      !p.check(TokenType.Newline) &&
      !p.check(TokenType.EOF) &&
      !p.check(TokenType.Dedent) &&
      !p.check(TokenType.RightBrace)
    ) {
      const single = parseDeclaration(p);
      if (single) statements.push(single);
      return {
        kind: 'BlockStatement',
        statements,
        line: colonTok.line,
        column: colonTok.column,
      };
    }

    p.skipSeparators();
    p.consume(
      TokenType.Indent,
      `Expected indented block after ':' for ${contextLabel}.`,
      'Indent the block lines with 2 or 4 spaces after the colon.'
    );
    p.skipSeparators();

    while (!p.check(TokenType.Dedent) && !p.isAtEnd()) {
      const startPos = p.getPosition();
      const stmt = parseDeclaration(p);
      if (stmt) {
        statements.push(stmt);
      } else if (p.getPosition() === startPos && !p.isAtEnd()) {
        throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' inside indented block.`);
      }
      p.skipSeparators();
    }

    p.match(TokenType.Dedent);
    return {
      kind: 'BlockStatement',
      statements,
      line: colonTok.line,
      column: colonTok.column,
    };
  }

  const bad = p.peek();
  const prev = p.previous();
  const caretTok =
    bad.type === TokenType.Newline || bad.type === TokenType.EOF
      ? {
          ...prev,
          column: prev.column + Math.max(1, prev.lexeme.length),
        }
      : bad;
  throw p.error(
    caretTok,
    `You forgot ':' after ${contextLabel}.`,
    "Add ':' for an indented block or '{ ... }' for a braced block."
  );
}

function parseImportStatement(p: Parser): ImportStatementNode {
  const start = p.previous();
  let defaultImport: string | undefined;
  const namedImports: string[] = [];
  let alias: string | undefined;
  let modulePath = '';

  if (p.match(TokenType.LeftBrace)) {
    p.skipNewlines();
    if (!p.check(TokenType.RightBrace)) {
      do {
        p.skipNewlines();
        if (p.check(TokenType.RightBrace)) break;
        namedImports.push(p.consume(TokenType.Identifier, 'Expected imported symbol name.').lexeme);
        p.skipNewlines();
      } while (p.match(TokenType.Comma));
    }
    p.consume(TokenType.RightBrace, "Expected '}' after import list.");
    p.consume(TokenType.From, "Expected 'from' after import list.");
    const pathTok = p.consume(TokenType.StringLiteral, 'Expected module path string.');
    modulePath = String(pathTok.literal ?? '');
  } else if (p.check(TokenType.StringLiteral)) {
    const pathTok = p.advance();
    modulePath = String(pathTok.literal ?? '');
    if (p.match(TokenType.As)) {
      alias = p.consume(TokenType.Identifier, "Expected alias name after 'as'.").lexeme;
    } else {
      const segs = modulePath.split('/');
      defaultImport = segs[segs.length - 1] || modulePath;
    }
  } else {
    const nameTok = p.consume(TokenType.Identifier, 'Expected module or symbol name after import.');
    defaultImport = nameTok.lexeme;
    if (p.match(TokenType.From)) {
      const pathTok = p.consume(TokenType.StringLiteral, "Expected module path string after 'from'.");
      modulePath = String(pathTok.literal ?? '');
    } else {
      modulePath = `stdlib/${defaultImport}`;
    }
  }

  p.consumeStatementEnd();
  return {
    kind: 'ImportStatement',
    modulePath,
    defaultImport,
    namedImports,
    alias,
    line: start.line,
    column: start.column,
  };
}

function parseVarOrMultiVarDeclaration(
  p: Parser,
  mutable: boolean
): VarDeclarationNode | MultiVarDeclarationNode {
  const start = p.previous();
  const first = parseSingleVarClause(p, mutable, undefined, start.line, start.column);

  if (!p.check(TokenType.Comma)) {
    p.consumeStatementEnd();
    return first;
  }

  const declarations: VarDeclarationNode[] = [first];
  while (p.match(TokenType.Comma)) {
    p.skipNewlines();
    const nextTok = p.peek();
    declarations.push(parseSingleVarClause(p, mutable, undefined, nextTok.line, nextTok.column));
  }
  p.consumeStatementEnd();

  return {
    kind: 'MultiVarDeclaration',
    mutable,
    declarations,
    line: start.line,
    column: start.column,
  };
}

function parseSingleVarClause(
  p: Parser,
  mutable: boolean,
  pointerMode?: PointerMode,
  overrideLine?: number,
  overrideCol?: number
): VarDeclarationNode {
  const nameToken = p.consume(TokenType.Identifier, 'Expected variable name.');

  let typeAnnotation: TypeAnnotationNode | undefined;
  if (p.match(TokenType.Colon)) {
    typeAnnotation = p.parseTypeAnnotation();
  }

  let initializer = undefined;
  if (p.match(TokenType.Assign)) {
    p.skipNewlines();
    initializer = p.parseExpr();
  } else if (!mutable) {
    throw p.error(nameToken, `Constant '${nameToken.lexeme}' must be initialized.`);
  }

  return {
    kind: 'VarDeclaration',
    mutable,
    pointerMode,
    name: nameToken.lexeme,
    typeAnnotation,
    initializer,
    line: overrideLine ?? nameToken.line,
    column: overrideCol ?? nameToken.column,
  };
}

function parseVarDeclaration(
  p: Parser,
  mutable: boolean,
  pointerMode?: PointerMode,
  overrideLine?: number,
  overrideCol?: number
): VarDeclarationNode {
  const start = p.previous();
  const decl = parseSingleVarClause(
    p,
    mutable,
    pointerMode,
    overrideLine ?? start.line,
    overrideCol ?? start.column
  );
  p.consumeStatementEnd();
  return decl;
}

const CPP_EXTRA_TYPES = new Set([
  'auto',
  'double',
  'char',
  'long',
  'short',
  'unsigned',
  'unique_ptr',
  'shared_ptr',
  'weak_ptr',
]);

function looksLikeCppTypedDecl(p: Parser): boolean {
  let k = 0;
  let hasLeadingConst = false;
  if (p.peekTokenAt(k).type === TokenType.Const) {
    hasLeadingConst = true;
    k++;
  }
  let hasStd = false;
  if (
    p.peekTokenAt(k).type === TokenType.Identifier &&
    p.peekTokenAt(k).lexeme === 'std' &&
    p.peekTokenAt(k + 1).type === TokenType.DoubleColon
  ) {
    hasStd = true;
    k += 2;
  }

  const baseTok = p.peekTokenAt(k);
  const isBaseTypeTok =
    baseTok.type === TokenType.Identifier ||
    baseTok.type === TokenType.Own ||
    baseTok.type === TokenType.Ref ||
    baseTok.type === TokenType.Shared;
  if (!isBaseTypeTok) return false;
  k++;

  let hasGenerics = false;
  if (p.peekTokenAt(k).type === TokenType.Less) {
    let depth = 1;
    let scan = k + 1;
    while (scan < 40 && depth > 0) {
      const t = p.peekTokenAt(scan).type;
      if (t === TokenType.EOF || t === TokenType.Newline || t === TokenType.Semicolon) return false;
      if (t === TokenType.Less) depth++;
      else if (t === TokenType.Greater) depth--;
      scan++;
    }
    if (depth !== 0) return false;
    hasGenerics = true;
    k = scan;
  }

  let stars = 0;
  while (
    p.peekTokenAt(k).type === TokenType.Star ||
    p.peekTokenAt(k).type === TokenType.Power
  ) {
    stars += p.peekTokenAt(k).type === TokenType.Power ? 2 : 1;
    k++;
  }
  let isRef = false;
  if (stars === 0 && p.peekTokenAt(k).type === TokenType.Ampersand) {
    isRef = true;
    k++;
  }
  if (stars > 0 && p.peekTokenAt(k).type === TokenType.Const) {
    k++;
  }

  const nameTok = p.peekTokenAt(k);
  if (nameTok.type !== TokenType.Identifier) return false;
  const afterName = p.peekTokenAt(k + 1).type;

  const isKnownType =
    BUILTIN_TYPES.has(baseTok.lexeme) || CPP_EXTRA_TYPES.has(baseTok.lexeme) || hasStd || hasGenerics;

  if (stars > 0 || isRef || hasGenerics || hasLeadingConst || CPP_EXTRA_TYPES.has(baseTok.lexeme)) {
    if (isKnownType) return true;
    return afterName === TokenType.Assign || afterName === TokenType.LeftParen || afterName === TokenType.LeftBracket;
  }
  return false;
}

function parseTypeFirstVarDeclaration(p: Parser): VarDeclarationNode {
  const typeAnnotation = p.parseTypeAnnotation();
  const nameToken = p.consume(TokenType.Identifier, 'Expected variable name after type.');

  let pointerMode: PointerMode | undefined;
  if (typeAnnotation.isReference) pointerMode = 'cpp_ref';
  else if (typeAnnotation.isPointer) pointerMode = 'ptr';
  else if (typeAnnotation.name === 'unique_ptr') pointerMode = 'unique';
  else if (typeAnnotation.name === 'shared_ptr') pointerMode = 'shared';
  else if (typeAnnotation.name === 'weak_ptr') pointerMode = 'weak';
  else if (typeAnnotation.name === 'own') pointerMode = 'own';
  else if (typeAnnotation.name === 'ref') pointerMode = 'ref';

  let initializer = undefined;
  if (p.match(TokenType.Assign)) {
    p.skipNewlines();
    initializer = p.parseExpr();
  } else if (p.match(TokenType.LeftParen)) {
    const args: ReturnType<Parser['parseExpr']>[] = [];
    p.skipNewlines();
    if (!p.check(TokenType.RightParen)) {
      do {
        p.skipNewlines();
        if (p.check(TokenType.RightParen)) break;
        args.push(p.parseExpr());
        p.skipNewlines();
      } while (p.match(TokenType.Comma));
    }
    p.consume(TokenType.RightParen, "Expected ')' after constructor arguments.");
    const ctorName =
      typeAnnotation.name === 'unique_ptr' ||
      typeAnnotation.name === 'shared_ptr' ||
      typeAnnotation.name === 'weak_ptr'
        ? typeAnnotation.name
        : pointerMode === 'ptr'
          ? 'own'
          : typeAnnotation.name;
    initializer = {
      kind: 'CallExpression' as const,
      callee: {
        kind: 'Identifier' as const,
        name: ctorName,
        line: typeAnnotation.line,
        column: typeAnnotation.column,
      },
      args,
      line: typeAnnotation.line,
      column: typeAnnotation.column,
    };
  }

  p.consumeStatementEnd();
  return {
    kind: 'VarDeclaration',
    mutable: !typeAnnotation.isConstPointer,
    pointerMode,
    name: nameToken.lexeme,
    typeAnnotation,
    initializer,
    line: typeAnnotation.line,
    column: typeAnnotation.column,
  };
}

function parseFunctionDeclaration(p: Parser, isExported: boolean): FunctionDeclarationNode {
  const start = p.previous();
  const nameToken = p.consume(TokenType.Identifier, 'Expected function name.');
  const genericParams = p.parseGenericParams();
  p.consume(TokenType.LeftParen, "Expected '(' after function name.");
  const params = p.parseParamList();

  let returnType: TypeAnnotationNode | undefined;
  if (p.match(TokenType.Arrow)) {
    returnType = p.parseTypeAnnotation();
  }

  let body: BlockStatementNode;
  if (p.match(TokenType.FatArrow)) {
    const arrow = p.previous();
    p.skipNewlines();
    if (p.check(TokenType.LeftBrace) || p.check(TokenType.Colon)) {
      body = parseBlockStatement(p, `function '${nameToken.lexeme}' arrow body`);
    } else {
      const expr = p.parseExpr();
      p.consumeStatementEnd();
      body = {
        kind: 'BlockStatement',
        statements: [
          {
            kind: 'ReturnStatement',
            value: expr,
            line: arrow.line,
            column: arrow.column,
          },
        ],
        line: arrow.line,
        column: arrow.column,
      };
    }
  } else {
    p.skipNewlines();
    body = parseBlockStatement(p, `function '${nameToken.lexeme}' signature`);
  }

  return {
    kind: 'FunctionDeclaration',
    name: nameToken.lexeme,
    genericParams,
    params,
    returnType,
    body,
    isExported,
    line: start.line,
    column: start.column,
  };
}

function parseClassDeclaration(p: Parser): ClassDeclarationNode {
  const start = p.previous();
  const nameToken = p.consume(TokenType.Identifier, 'Expected class name.');
  const genericParams = p.parseGenericParams();

  let superClass: string | undefined;
  if (p.match(TokenType.Extends)) {
    superClass = p.consume(TokenType.Identifier, "Expected parent class name after 'extends'.").lexeme;
  }

  const traits: string[] = [];
  if (p.match(TokenType.Implements)) {
    do {
      traits.push(p.consume(TokenType.Identifier, 'Expected trait name.').lexeme);
    } while (p.match(TokenType.Comma));
  }

  p.skipNewlines();
  let colonIndented = false;
  if (p.match(TokenType.Colon)) {
    p.skipSeparators();
    p.consume(
      TokenType.Indent,
      `Expected indented body after ':' for class '${nameToken.lexeme}'.`
    );
    p.skipSeparators();
    colonIndented = true;
  } else {
    p.consume(TokenType.LeftBrace, "Expected '{' or ':' before class body.");
    p.skipSeparators();
  }

  const fields: ClassFieldNode[] = [];
  const methods: ClassMethodNode[] = [];

  while (!(colonIndented ? p.check(TokenType.Dedent) : p.check(TokenType.RightBrace)) && !p.isAtEnd()) {
    const loopStartPos = p.getPosition();
    const memberStart = p.peek();
    let visibility: Visibility = 'pub';
    let isOverride = false;
    let isStatic = false;
    while (true) {
      if (p.match(TokenType.Pub)) visibility = 'pub';
      else if (p.match(TokenType.Priv)) visibility = 'priv';
      else if (p.match(TokenType.Prot)) visibility = 'prot';
      else if (p.match(TokenType.Override)) isOverride = true;
      else if (p.match(TokenType.Static)) isStatic = true;
      else break;
    }

    if (
      p.match(TokenType.Init) ||
      (p.check(TokenType.Identifier) &&
        p.peek().lexeme === nameToken.lexeme &&
        p.checkNext(TokenType.LeftParen))
    ) {
      if (p.previous().type !== TokenType.Init && p.peek().lexeme === nameToken.lexeme) {
        p.advance();
      }
      p.consume(TokenType.LeftParen, "Expected '(' after constructor.");
      const params = p.parseParamList();
      p.skipNewlines();
      const body = parseBlockStatement(p, 'constructor');
      methods.push({
        kind: 'ClassMethod',
        visibility,
        isStatic: false,
        isOverride: false,
        isConstructor: true,
        name: 'init',
        params,
        body,
        line: memberStart.line,
        column: memberStart.column,
      });
    } else if (p.match(TokenType.Fn)) {
      const mName = p.match(TokenType.Init)
        ? p.previous()
        : p.consume(TokenType.Identifier, 'Expected method name.');
      const isCtor = mName.type === TokenType.Init;
      p.consume(TokenType.LeftParen, "Expected '(' after method name.");
      const params = p.parseParamList();
      let returnType: TypeAnnotationNode | undefined;
      if (p.match(TokenType.Arrow)) {
        returnType = p.parseTypeAnnotation();
      }

      let body: BlockStatementNode;
      if (p.match(TokenType.FatArrow)) {
        const arrow = p.previous();
        p.skipNewlines();
        if (p.check(TokenType.LeftBrace) || p.check(TokenType.Colon)) {
          body = parseBlockStatement(p, `method '${mName.lexeme}' arrow body`);
        } else {
          const expr = p.parseExpr();
          p.consumeStatementEnd();
          body = {
            kind: 'BlockStatement',
            statements: [
              { kind: 'ReturnStatement', value: expr, line: arrow.line, column: arrow.column },
            ],
            line: arrow.line,
            column: arrow.column,
          };
        }
      } else {
        p.skipNewlines();
        body = parseBlockStatement(p, `method '${mName.lexeme}'`);
      }

      methods.push({
        kind: 'ClassMethod',
        visibility,
        isStatic,
        isOverride,
        isConstructor: isCtor,
        name: isCtor ? 'init' : mName.lexeme,
        params,
        returnType,
        body,
        line: memberStart.line,
        column: memberStart.column,
      });
    } else if (looksLikeCppTypedDecl(p)) {
      const decl = parseTypeFirstVarDeclaration(p);
      fields.push({
        kind: 'ClassField',
        visibility,
        isStatic,
        name: decl.name,
        typeAnnotation: decl.typeAnnotation,
        initializer: decl.initializer,
        line: memberStart.line,
        column: memberStart.column,
      });
    } else {
      // Field declaration (optional `let` / `var` / `const`, or type-first `int x = 0`)
      p.match(TokenType.Let, TokenType.Var, TokenType.Const);
      let typeAnnotation: TypeAnnotationNode | undefined;
      let fName;
      if (
        p.check(TokenType.Identifier) &&
        BUILTIN_TYPES.has(p.peek().lexeme) &&
        p.checkNext(TokenType.Identifier)
      ) {
        typeAnnotation = p.parseTypeAnnotation();
        fName = p.consume(TokenType.Identifier, 'Expected class field name after type.');
      } else {
        fName = p.consume(TokenType.Identifier, 'Expected class field or method declaration.');
        if (p.match(TokenType.Colon)) {
          typeAnnotation = p.parseTypeAnnotation();
        }
      }
      let initializer = undefined;
      if (p.match(TokenType.Assign)) {
        initializer = p.parseExpr();
      }
      p.consumeStatementEnd();
      fields.push({
        kind: 'ClassField',
        visibility,
        isStatic,
        name: fName.lexeme,
        typeAnnotation,
        initializer,
        line: memberStart.line,
        column: memberStart.column,
      });
    }

    if (p.getPosition() === loopStartPos && !p.isAtEnd()) {
      throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in class '${nameToken.lexeme}'.`);
    }
    p.skipSeparators();
  }

  if (colonIndented) {
    p.match(TokenType.Dedent);
  } else {
    p.consume(TokenType.RightBrace, "Expected '}' after class body.");
  }
  return {
    kind: 'ClassDeclaration',
    name: nameToken.lexeme,
    genericParams,
    superClass,
    traits,
    fields,
    methods,
    line: start.line,
    column: start.column,
  };
}

function parseStructDeclaration(p: Parser): StructDeclarationNode {
  const start = p.previous();
  const nameToken = p.consume(TokenType.Identifier, 'Expected struct name.');
  const genericParams = p.parseGenericParams();
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' before struct body.");
  p.skipSeparators();

  const fields: StructFieldNode[] = [];
  const methods: ClassMethodNode[] = [];

  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const loopStartPos = p.getPosition();
    const memberStart = p.peek();
    if (p.match(TokenType.Fn)) {
      const mName = p.consume(TokenType.Identifier, 'Expected struct method name.');
      p.consume(TokenType.LeftParen, "Expected '(' after method name.");
      const params = p.parseParamList();
      let returnType: TypeAnnotationNode | undefined;
      if (p.match(TokenType.Arrow)) {
        returnType = p.parseTypeAnnotation();
      }
      p.skipNewlines();
      const body = parseBlockStatement(p, `method '${mName.lexeme}'`);
      methods.push({
        kind: 'ClassMethod',
        visibility: 'pub',
        isStatic: false,
        isOverride: false,
        isConstructor: false,
        name: mName.lexeme,
        params,
        returnType,
        body,
        line: memberStart.line,
        column: memberStart.column,
      });
    } else {
      const fName = p.consume(TokenType.Identifier, 'Expected struct field name.');
      let typeAnnotation: TypeAnnotationNode | undefined;
      if (p.match(TokenType.Colon)) {
        typeAnnotation = p.parseTypeAnnotation();
      }
      let defaultValue = undefined;
      if (p.match(TokenType.Assign)) {
        defaultValue = p.parseExpr();
      }
      if (p.match(TokenType.Comma)) {
        // Optional trailing comma in structs
      } else {
        p.skipSeparators();
      }
      fields.push({
        kind: 'StructField',
        name: fName.lexeme,
        typeAnnotation,
        defaultValue,
        line: memberStart.line,
        column: memberStart.column,
      });
    }
    if (p.getPosition() === loopStartPos && !p.isAtEnd()) {
      throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in struct '${nameToken.lexeme}'.`);
    }
    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after struct body.");
  return {
    kind: 'StructDeclaration',
    name: nameToken.lexeme,
    genericParams,
    fields,
    methods,
    line: start.line,
    column: start.column,
  };
}

function parseEnumDeclaration(p: Parser): EnumDeclarationNode {
  const start = p.previous();
  const nameToken = p.consume(TokenType.Identifier, 'Expected enum name.');
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' before enum variants.");
  p.skipSeparators();

  const variants: EnumVariantNode[] = [];
  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const loopStartPos = p.getPosition();
    const vToken = p.consume(TokenType.Identifier, 'Expected enum variant name.');
    const fields: string[] = [];

    if (p.match(TokenType.LeftParen)) {
      if (!p.check(TokenType.RightParen)) {
        do {
          const fieldName = p.consume(TokenType.Identifier, 'Expected variant payload field name.');
          // Allow optional `: Type` on enum payload fields
          if (p.match(TokenType.Colon)) {
            p.parseTypeAnnotation();
          }
          fields.push(fieldName.lexeme);
        } while (p.match(TokenType.Comma));
      }
      p.consume(TokenType.RightParen, "Expected ')' after enum variant fields.");
    }

    variants.push({
      kind: 'EnumVariant',
      name: vToken.lexeme,
      fields,
      line: vToken.line,
      column: vToken.column,
    });

    p.match(TokenType.Comma);
    if (p.getPosition() === loopStartPos && !p.isAtEnd()) {
      throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in enum '${nameToken.lexeme}'.`);
    }
    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after enum variants.");
  return {
    kind: 'EnumDeclaration',
    name: nameToken.lexeme,
    variants,
    line: start.line,
    column: start.column,
  };
}

function parseTraitDeclaration(p: Parser): TraitDeclarationNode {
  const start = p.previous();
  const nameToken = p.consume(TokenType.Identifier, 'Expected trait or interface name.');
  const genericParams = p.parseGenericParams();
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' before trait/interface methods.");
  p.skipSeparators();

  const methods: TraitMethodSignatureNode[] = [];
  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const loopStartPos = p.getPosition();
    const mStart = p.consume(TokenType.Fn, "Expected 'fn' inside trait/interface.");
    const mName = p.consume(TokenType.Identifier, 'Expected method name.');
    p.consume(TokenType.LeftParen, "Expected '(' after method name.");
    const params = p.parseParamList();
    let returnType: TypeAnnotationNode | undefined;
    if (p.match(TokenType.Arrow)) {
      returnType = p.parseTypeAnnotation();
    }
    p.consumeStatementEnd();
    methods.push({
      kind: 'TraitMethodSignature',
      name: mName.lexeme,
      params,
      returnType,
      line: mStart.line,
      column: mStart.column,
    });
    if (p.getPosition() === loopStartPos && !p.isAtEnd()) {
      throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in trait '${nameToken.lexeme}'.`);
    }
    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after trait/interface body.");
  return {
    kind: 'TraitDeclaration',
    name: nameToken.lexeme,
    genericParams,
    methods,
    line: start.line,
    column: start.column,
  };
}

function parseHeaderExpr(p: Parser): ReturnType<Parser['parseExpr']> {
  const prev = p.allowStructInit;
  p.allowStructInit = false;
  try {
    return p.parseExpr();
  } finally {
    p.allowStructInit = prev;
  }
}

function parseIfStatement(p: Parser): StatementNode {
  const start = p.previous();
  const condition = parseHeaderExpr(p);
  const consequent = parseBlockStatement(p, 'the if condition');

  const elifBranches: ElifBranch[] = [];
  p.skipNewlines();
  while (p.match(TokenType.Elif)) {
    const elifTok = p.previous();
    const elifCond = parseHeaderExpr(p);
    const elifBody = parseBlockStatement(p, 'the elif condition');
    elifBranches.push({
      condition: elifCond,
      consequent: elifBody,
      line: elifTok.line,
      column: elifTok.column,
    });
    p.skipNewlines();
  }

  let alternate: BlockStatementNode | undefined;
  if (p.match(TokenType.Else)) {
    if (p.match(TokenType.If)) {
      const nested = parseIfStatement(p);
      alternate = {
        kind: 'BlockStatement',
        statements: [nested],
        line: nested.line,
        column: nested.column,
      };
    } else {
      alternate = parseBlockStatement(p, 'else');
    }
  }

  return {
    kind: 'IfStatement',
    condition,
    consequent,
    elifBranches,
    alternate,
    line: start.line,
    column: start.column,
  };
}

function parseForInStatement(p: Parser): StatementNode {
  const start = p.previous();

  // Support C/C++-style `for (let i = 0; i < 10; i++) { ... }`
  // and `for (i = 0, i < 10, i++): code`
  if (p.match(TokenType.LeftParen)) {
    p.skipNewlines();
    let init: StatementNode | undefined;
    if (!p.check(TokenType.Semicolon) && !p.check(TokenType.Comma)) {
      if (p.match(TokenType.Let, TokenType.Var)) {
        const kwTok = p.previous();
        const prev = p.allowStructInit;
        p.allowStructInit = false;
        try {
          init = parseSingleVarClause(p, true, undefined, kwTok.line, kwTok.column);
        } finally {
          p.allowStructInit = prev;
        }
      } else if (
        p.check(TokenType.Identifier) &&
        BUILTIN_TYPES.has(p.peek().lexeme) &&
        p.checkNext(TokenType.Identifier)
      ) {
        const typeAnnotation = p.parseTypeAnnotation();
        const nameToken = p.consume(TokenType.Identifier, 'Expected variable name after type.');
        let initializer = undefined;
        if (p.match(TokenType.Assign)) {
          p.skipNewlines();
          initializer = parseHeaderExpr(p);
        }
        init = {
          kind: 'VarDeclaration',
          mutable: true,
          name: nameToken.lexeme,
          typeAnnotation,
          initializer,
          line: typeAnnotation.line,
          column: typeAnnotation.column,
        };
      } else {
        const expr = parseHeaderExpr(p);
        init = {
          kind: 'ExpressionStatement',
          expression: expr,
          line: expr.line,
          column: expr.column,
        };
      }
    }

    p.skipNewlines();
    if (!p.match(TokenType.Semicolon, TokenType.Comma)) {
      throw p.error(p.peek(), "Expected ';' or ',' after for-loop initializer.");
    }
    p.skipNewlines();

    let condition = undefined;
    if (!p.check(TokenType.Semicolon) && !p.check(TokenType.Comma)) {
      condition = parseHeaderExpr(p);
    }
    p.skipNewlines();
    if (!p.match(TokenType.Semicolon, TokenType.Comma)) {
      throw p.error(p.peek(), "Expected ';' or ',' after for-loop condition.");
    }
    p.skipNewlines();

    let update = undefined;
    if (!p.check(TokenType.RightParen)) {
      update = parseHeaderExpr(p);
    }
    p.skipNewlines();
    p.consume(TokenType.RightParen, "Expected ')' after for-loop clauses.");
    const body = parseBlockStatement(p, 'the for loop');

    return {
      kind: 'CForStatement',
      init,
      condition,
      update,
      body,
      line: start.line,
      column: start.column,
    };
  }

  const variable = p.consume(TokenType.Identifier, "Expected loop variable after 'for'.");
  p.consume(TokenType.In, "Expected 'in' after loop variable.");
  const iterable = parseHeaderExpr(p);
  const body = parseBlockStatement(p, 'the for loop');
  return {
    kind: 'ForInStatement',
    variable: variable.lexeme,
    iterable,
    body,
    line: start.line,
    column: start.column,
  };
}

function parseWhileStatement(p: Parser): StatementNode {
  const start = p.previous();
  const condition = parseHeaderExpr(p);
  const body = parseBlockStatement(p, 'the while condition');
  return {
    kind: 'WhileStatement',
    condition,
    body,
    line: start.line,
    column: start.column,
  };
}

function parseDoWhileStatement(p: Parser): StatementNode {
  const start = p.advance(); // consume 'do'
  const body = parseBlockStatement(p, 'do-while loop');
  p.skipNewlines();
  p.consume(TokenType.While, "Expected 'while' after 'do' block.");
  const condition = parseHeaderExpr(p);
  p.consumeStatementEnd();
  return {
    kind: 'DoWhileStatement',
    body,
    condition,
    line: start.line,
    column: start.column,
  };
}

function parseLoopStatement(p: Parser): StatementNode {
  const start = p.previous();
  const body = parseBlockStatement(p, 'loop');
  return {
    kind: 'LoopStatement',
    body,
    line: start.line,
    column: start.column,
  };
}

function parseRepeatStatement(p: Parser): RepeatStatementNode {
  const start = p.previous();
  const count = parseHeaderExpr(p);
  p.consume(TokenType.Times, "Expected 'times' after repeat count.");
  const body = parseBlockStatement(p, 'repeat loop');
  return {
    kind: 'RepeatStatement',
    count,
    body,
    line: start.line,
    column: start.column,
  };
}

function parseReturnStatement(p: Parser): StatementNode {
  const start = p.previous();
  let value = undefined;
  if (
    !p.check(TokenType.Newline) &&
    !p.check(TokenType.Semicolon) &&
    !p.check(TokenType.RightBrace) &&
    !p.check(TokenType.Dedent) &&
    !p.isAtEnd()
  ) {
    value = p.parseExpr();
  }
  p.consumeStatementEnd();
  return {
    kind: 'ReturnStatement',
    value,
    line: start.line,
    column: start.column,
  };
}

function parseTryCatchStatement(p: Parser): StatementNode {
  const start = p.previous();
  const tryBlock = parseBlockStatement(p, 'try');
  p.skipNewlines();
  p.consume(TokenType.Catch, "Expected 'catch' after try block.");

  let catchVar: string | undefined;
  if (p.match(TokenType.Identifier)) {
    catchVar = p.previous().lexeme;
  }
  const catchBlock = parseBlockStatement(p, 'catch');

  return {
    kind: 'TryCatchStatement',
    tryBlock,
    catchVar,
    catchBlock,
    line: start.line,
    column: start.column,
  };
}

function parseThrowStatement(p: Parser): StatementNode {
  const start = p.previous();
  const value = p.parseExpr();
  p.consumeStatementEnd();
  return {
    kind: 'ThrowStatement',
    value,
    line: start.line,
    column: start.column,
  };
}

function parseDeferStatement(p: Parser): StatementNode {
  const start = p.previous();
  const stmt = parseStatement(p);
  return {
    kind: 'DeferStatement',
    statement: stmt,
    line: start.line,
    column: start.column,
  };
}

function parseDropStatement(p: Parser): StatementNode {
  const start = p.previous();
  const target = p.parseExpr();
  p.consumeStatementEnd();
  return {
    kind: 'DropStatement',
    target,
    line: start.line,
    column: start.column,
  };
}

function parseDeleteStatement(p: Parser): StatementNode {
  const start = p.advance(); // consume 'delete'
  let isArrayDelete = false;
  if (p.match(TokenType.LeftBracket)) {
    p.consume(TokenType.RightBracket, "Expected ']' after 'delete['.");
    isArrayDelete = true;
  }
  const target = p.parseExpr();
  p.consumeStatementEnd();
  return {
    kind: 'DropStatement',
    target,
    isArrayDelete,
    line: start.line,
    column: start.column,
  };
}

function parseScopeStatement(p: Parser): StatementNode {
  const start = p.previous();
  let name: string | undefined;
  if (p.match(TokenType.Identifier)) {
    name = p.previous().lexeme;
  }
  const body = parseBlockStatement(p, 'scope');
  return {
    kind: 'ScopeStatement',
    name,
    body,
    line: start.line,
    column: start.column,
  };
}
