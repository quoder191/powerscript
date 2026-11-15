import {
  BlockStatementNode,
  ClassDeclarationNode,
  ClassFieldNode,
  ClassMethodNode,
  ElifBranch,
  EnumDeclarationNode,
  EnumVariantNode,
  FunctionDeclarationNode,
  PointerMode,
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
  if (p.isAtEnd()) return null;

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
    return parseVarDeclaration(p, true);
  }
  if (p.match(TokenType.Const)) {
    return parseVarDeclaration(p, false);
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
  if (p.match(TokenType.Loop)) return parseLoopStatement(p);
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
  if (p.match(TokenType.Scope)) return parseScopeStatement(p);
  if (p.check(TokenType.LeftBrace)) return parseBlockStatement(p);

  const expr = p.parseExpr();
  p.consumeStatementEnd();
  return {
    kind: 'ExpressionStatement',
    expression: expr,
    line: expr.line,
    column: expr.column,
  };
}

export function parseBlockStatement(p: Parser): BlockStatementNode {
  const openBrace = p.consume(TokenType.LeftBrace, "Expected '{' to start block.");
  const statements: StatementNode[] = [];
  p.skipSeparators();

  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const stmt = parseDeclaration(p);
    if (stmt) statements.push(stmt);
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

function parseVarDeclaration(
  p: Parser,
  mutable: boolean,
  pointerMode?: PointerMode,
  overrideLine?: number,
  overrideCol?: number
): VarDeclarationNode {
  const start = p.previous();
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

  p.consumeStatementEnd();
  return {
    kind: 'VarDeclaration',
    mutable,
    pointerMode,
    name: nameToken.lexeme,
    typeAnnotation,
    initializer,
    line: overrideLine ?? start.line,
    column: overrideCol ?? start.column,
  };
}

function parseTypeFirstVarDeclaration(p: Parser): VarDeclarationNode {
  const typeAnnotation = p.parseTypeAnnotation();
  const nameToken = p.consume(TokenType.Identifier, 'Expected variable name after type.');

  let initializer = undefined;
  if (p.match(TokenType.Assign)) {
    p.skipNewlines();
    initializer = p.parseExpr();
  }

  p.consumeStatementEnd();
  return {
    kind: 'VarDeclaration',
    mutable: true,
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
  } else {
    p.skipNewlines();
    body = parseBlockStatement(p);
  }

  return {
    kind: 'FunctionDeclaration',
    name: nameToken.lexeme,
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
  p.consume(TokenType.LeftBrace, "Expected '{' before class body.");
  p.skipSeparators();

  const fields: ClassFieldNode[] = [];
  const methods: ClassMethodNode[] = [];

  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
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

    if (p.match(TokenType.Init)) {
      p.consume(TokenType.LeftParen, "Expected '(' after 'init'.");
      const params = p.parseParamList();
      p.skipNewlines();
      const body = parseBlockStatement(p);
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
      const mName = p.consume(TokenType.Identifier, 'Expected method name.');
      p.consume(TokenType.LeftParen, "Expected '(' after method name.");
      const params = p.parseParamList();
      let returnType: TypeAnnotationNode | undefined;
      if (p.match(TokenType.Arrow)) {
        returnType = p.parseTypeAnnotation();
      }

      let body: BlockStatementNode;
      if (p.match(TokenType.FatArrow)) {
        const arrow = p.previous();
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
      } else {
        p.skipNewlines();
        body = parseBlockStatement(p);
      }

      methods.push({
        kind: 'ClassMethod',
        visibility,
        isStatic,
        isOverride,
        isConstructor: false,
        name: mName.lexeme,
        params,
        returnType,
        body,
        line: memberStart.line,
        column: memberStart.column,
      });
    } else {
      // Field declaration (optional `let` / `const`)
      p.match(TokenType.Let, TokenType.Const);
      const fName = p.consume(TokenType.Identifier, 'Expected class field or method declaration.');
      let typeAnnotation: TypeAnnotationNode | undefined;
      if (p.match(TokenType.Colon)) {
        typeAnnotation = p.parseTypeAnnotation();
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

    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after class body.");
  return {
    kind: 'ClassDeclaration',
    name: nameToken.lexeme,
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
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' before struct body.");
  p.skipSeparators();

  const fields: StructFieldNode[] = [];
  const methods: ClassMethodNode[] = [];

  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
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
      const body = parseBlockStatement(p);
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
    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after struct body.");
  return {
    kind: 'StructDeclaration',
    name: nameToken.lexeme,
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
  const nameToken = p.consume(TokenType.Identifier, 'Expected trait name.');
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' before trait methods.");
  p.skipSeparators();

  const methods: TraitMethodSignatureNode[] = [];
  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const mStart = p.consume(TokenType.Fn, "Expected 'fn' inside trait.");
    const mName = p.consume(TokenType.Identifier, 'Expected trait method name.');
    p.consume(TokenType.LeftParen, "Expected '(' after trait method name.");
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
    p.skipSeparators();
  }

  p.consume(TokenType.RightBrace, "Expected '}' after trait body.");
  return {
    kind: 'TraitDeclaration',
    name: nameToken.lexeme,
    methods,
    line: start.line,
    column: start.column,
  };
}

function parseIfStatement(p: Parser): StatementNode {
  const start = p.previous();
  const condition = p.parseExpr();
  p.skipNewlines();
  const consequent = parseBlockStatement(p);

  const elifBranches: ElifBranch[] = [];
  p.skipNewlines();
  while (p.match(TokenType.Elif)) {
    const elifTok = p.previous();
    const elifCond = p.parseExpr();
    p.skipNewlines();
    const elifBody = parseBlockStatement(p);
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
    p.skipNewlines();
    if (p.match(TokenType.If)) {
      const nested = parseIfStatement(p);
      alternate = {
        kind: 'BlockStatement',
        statements: [nested],
        line: nested.line,
        column: nested.column,
      };
    } else {
      alternate = parseBlockStatement(p);
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

  // Support C-style `for (let i = 0; i < 10; i++) { ... }`
  if (p.match(TokenType.LeftParen)) {
    let init: StatementNode | undefined;
    if (!p.check(TokenType.Semicolon)) {
      if (p.match(TokenType.Let, TokenType.Var)) {
        init = parseVarDeclaration(p, true);
      } else if (
        p.check(TokenType.Identifier) &&
        BUILTIN_TYPES.has(p.peek().lexeme) &&
        p.checkNext(TokenType.Identifier)
      ) {
        init = parseTypeFirstVarDeclaration(p);
      } else {
        const expr = p.parseExpr();
        p.match(TokenType.Semicolon);
        init = {
          kind: 'ExpressionStatement',
          expression: expr,
          line: expr.line,
          column: expr.column,
        };
      }
    } else {
      p.consume(TokenType.Semicolon, "Expected ';' after for-loop initializer.");
    }

    let condition = undefined;
    if (!p.check(TokenType.Semicolon)) {
      condition = p.parseExpr();
    }
    p.consume(TokenType.Semicolon, "Expected ';' after for-loop condition.");

    let update = undefined;
    if (!p.check(TokenType.RightParen)) {
      update = p.parseExpr();
    }
    p.consume(TokenType.RightParen, "Expected ')' after for-loop clauses.");
    p.skipNewlines();
    const body = parseBlockStatement(p);

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
  const iterable = p.parseExpr();
  p.skipNewlines();
  const body = parseBlockStatement(p);
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
  const condition = p.parseExpr();
  p.skipNewlines();
  const body = parseBlockStatement(p);
  return {
    kind: 'WhileStatement',
    condition,
    body,
    line: start.line,
    column: start.column,
  };
}

function parseLoopStatement(p: Parser): StatementNode {
  const start = p.previous();
  p.skipNewlines();
  const body = parseBlockStatement(p);
  return {
    kind: 'LoopStatement',
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
  p.skipNewlines();
  const tryBlock = parseBlockStatement(p);
  p.skipNewlines();
  p.consume(TokenType.Catch, "Expected 'catch' after try block.");

  let catchVar: string | undefined;
  if (p.match(TokenType.Identifier)) {
    catchVar = p.previous().lexeme;
  }
  p.skipNewlines();
  const catchBlock = parseBlockStatement(p);

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

function parseScopeStatement(p: Parser): StatementNode {
  const start = p.previous();
  let name: string | undefined;
  if (p.match(TokenType.Identifier)) {
    name = p.previous().lexeme;
  }
  p.skipNewlines();
  const body = parseBlockStatement(p);
  return {
    kind: 'ScopeStatement',
    name,
    body,
    line: start.line,
    column: start.column,
  };
}
