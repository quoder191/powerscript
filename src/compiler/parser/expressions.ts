import {
  ExpressionNode,
  FStringPart,
  MapEntryNode,
  MatchArmNode,
  MatchPattern,
  ParamNode,
  StructInitField,
} from '../ast/nodes.ts';
import { Lexer } from '../lexer/lexer.ts';
import { TokenType } from '../lexer/tokens.ts';
import type { Parser } from './parser.ts';

export function parseExpression(p: Parser): ExpressionNode {
  return p.withRecursionLimit(() => parseAssignment(p));
}

function parseAssignment(p: Parser): ExpressionNode {
  const expr = parseConditional(p);

  if (
    p.match(
      TokenType.Assign,
      TokenType.PlusAssign,
      TokenType.MinusAssign,
      TokenType.StarAssign,
      TokenType.SlashAssign
    )
  ) {
    const operatorToken = p.previous();
    p.skipNewlines();
    const value = parseAssignment(p);

    const validTarget =
      expr.kind === 'Identifier' ||
      expr.kind === 'MemberExpression' ||
      expr.kind === 'IndexExpression' ||
      (expr.kind === 'PointerExpression' && expr.op === 'deref');

    if (!validTarget) {
      throw p.error(operatorToken, 'Invalid assignment target.');
    }

    return {
      kind: 'AssignmentExpression',
      operator: operatorToken.lexeme as '=' | '+=' | '-=' | '*=' | '/=',
      target: expr,
      value,
      line: operatorToken.line,
      column: operatorToken.column,
    };
  }

  return expr;
}

function parseConditional(p: Parser): ExpressionNode {
  const condition = parseNullish(p);

  if (p.match(TokenType.Question)) {
    const qTok = p.previous();
    p.skipNewlines();
    const consequent = parseAssignment(p);
    p.skipNewlines();
    p.consume(TokenType.Colon, "Expected ':' in ternary conditional expression.");
    p.skipNewlines();
    const alternate = parseAssignment(p);
    return {
      kind: 'ConditionalExpression',
      condition,
      consequent,
      alternate,
      line: qTok.line,
      column: qTok.column,
    };
  }

  return condition;
}

function parseNullish(p: Parser): ExpressionNode {
  let expr = parsePipe(p);

  while (p.match(TokenType.Nullish)) {
    const op = p.previous();
    p.skipNewlines();
    const right = parsePipe(p);
    expr = {
      kind: 'LogicalExpression',
      operator: '??',
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parsePipe(p: Parser): ExpressionNode {
  let expr = parseOr(p);

  while (true) {
    // Allow multiline pipelines:
    // data
    //   |> map(...)
    if (p.check(TokenType.Newline) && p.peekNonNewline(0).type === TokenType.PipeArrow) {
      p.skipNewlines();
    }

    if (!p.match(TokenType.PipeArrow)) break;

    const op = p.previous();
    p.skipNewlines();
    const right = parseOr(p);
    expr = {
      kind: 'PipeExpression',
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseOr(p: Parser): ExpressionNode {
  let expr = parseAnd(p);

  while (p.match(TokenType.Or, TokenType.PipePipe)) {
    const op = p.previous();
    p.skipNewlines();
    const right = parseAnd(p);
    expr = {
      kind: 'LogicalExpression',
      operator: 'or',
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseAnd(p: Parser): ExpressionNode {
  let expr = parseEquality(p);

  while (p.match(TokenType.And, TokenType.AndAnd)) {
    const op = p.previous();
    p.skipNewlines();
    const right = parseEquality(p);
    expr = {
      kind: 'LogicalExpression',
      operator: 'and',
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseEquality(p: Parser): ExpressionNode {
  let expr = parseComparison(p);

  while (p.match(TokenType.Equal, TokenType.NotEqual, TokenType.Is)) {
    const op = p.previous();
    const right = parseComparison(p);
    expr = {
      kind: 'BinaryExpression',
      operator: op.type === TokenType.Is ? 'is' : op.lexeme,
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseComparison(p: Parser): ExpressionNode {
  let expr = parseRange(p);

  while (true) {
    if (
      p.match(
        TokenType.Less,
        TokenType.LessEqual,
        TokenType.Greater,
        TokenType.GreaterEqual,
        TokenType.In
      )
    ) {
      const op = p.previous();
      const right = parseRange(p);
      expr = {
        kind: 'BinaryExpression',
        operator: op.type === TokenType.In ? 'in' : op.lexeme,
        left: expr,
        right,
        line: op.line,
        column: op.column,
      };
      continue;
    }

    if (p.check(TokenType.Not) && p.checkNext(TokenType.In)) {
      const notTok = p.advance();
      p.advance(); // consume `in`
      const right = parseRange(p);
      expr = {
        kind: 'BinaryExpression',
        operator: 'not in',
        left: expr,
        right,
        line: notTok.line,
        column: notTok.column,
      };
      continue;
    }

    break;
  }

  return expr;
}

function parseRange(p: Parser): ExpressionNode {
  const expr = parseTerm(p);

  if (p.match(TokenType.Range, TokenType.RangeInclusive)) {
    const op = p.previous();
    const end = parseTerm(p);
    return {
      kind: 'RangeExpression',
      start: expr,
      end,
      inclusive: op.type === TokenType.RangeInclusive,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseTerm(p: Parser): ExpressionNode {
  let expr = parseFactor(p);

  while (p.match(TokenType.Plus, TokenType.Minus)) {
    const op = p.previous();
    const right = parseFactor(p);
    expr = {
      kind: 'BinaryExpression',
      operator: op.lexeme,
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parseFactor(p: Parser): ExpressionNode {
  let expr = parsePower(p);

  while (p.match(TokenType.Star, TokenType.Slash, TokenType.Percent)) {
    const op = p.previous();
    const right = parsePower(p);
    expr = {
      kind: 'BinaryExpression',
      operator: op.lexeme,
      left: expr,
      right,
      line: op.line,
      column: op.column,
    };
  }

  return expr;
}

function parsePower(p: Parser): ExpressionNode {
  const base = parseUnary(p);

  if (p.match(TokenType.Power)) {
    const op = p.previous();
    const exponent = parsePower(p);
    return {
      kind: 'BinaryExpression',
      operator: '**',
      left: base,
      right: exponent,
      line: op.line,
      column: op.column,
    };
  }

  return base;
}

function parseUnary(p: Parser): ExpressionNode {
  if (p.match(TokenType.PlusPlus, TokenType.MinusMinus)) {
    const op = p.previous();
    return {
      kind: 'UpdateExpression',
      operator: op.lexeme as '++' | '--',
      argument: parseUnary(p),
      prefix: true,
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Bang, TokenType.Not, TokenType.Minus)) {
    const op = p.previous();
    const operand = parseUnary(p);
    return {
      kind: 'UnaryExpression',
      operator: op.type === TokenType.Not ? '!' : op.lexeme,
      operand,
      line: op.line,
      column: op.column,
    };
  }

  // Pointer & Ownership unary operators:
  // *ptr (deref), &x / borrow x (rule borrow), move x, own x, shared x
  if (p.match(TokenType.Star)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'deref',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Power)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'deref',
      argument: {
        kind: 'PointerExpression',
        op: 'deref',
        argument: parseUnary(p),
        line: op.line,
        column: op.column + 1,
      },
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Borrow)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'borrow',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Ampersand)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'addr',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Move)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'move',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Own)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'own',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  if (p.match(TokenType.Shared)) {
    const op = p.previous();
    return {
      kind: 'PointerExpression',
      op: 'shared',
      argument: parseUnary(p),
      line: op.line,
      column: op.column,
    };
  }

  return parsePostfix(p);
}

function parsePostfix(p: Parser): ExpressionNode {
  let expr = parsePrimary(p);

  while (true) {
    if (p.match(TokenType.LeftParen)) {
      const args = parseArgumentList(p);
      expr = {
        kind: 'CallExpression',
        callee: expr,
        args,
        line: expr.line,
        column: expr.column,
      };
    } else if (p.match(TokenType.Dot, TokenType.OptionalChain, TokenType.DoubleColon)) {
      const op = p.previous();
      const prop = p.consume(TokenType.Identifier, "Expected property or variant name after '.' or '::'.");
      expr = {
        kind: 'MemberExpression',
        object: expr,
        property: prop.lexeme,
        optional: op.type === TokenType.OptionalChain,
        line: op.line,
        column: op.column,
      };
    } else if (p.match(TokenType.Arrow)) {
      const op = p.previous();
      const prop = p.consume(TokenType.Identifier, "Expected member name after '->'.");
      expr = {
        kind: 'MemberExpression',
        object: {
          kind: 'PointerExpression',
          op: 'deref',
          argument: expr,
          line: op.line,
          column: op.column,
        },
        property: prop.lexeme,
        optional: false,
        line: op.line,
        column: op.column,
      };
    } else if (p.match(TokenType.LeftBracket)) {
      p.skipNewlines();
      const index = parseExpression(p);
      p.skipNewlines();
      p.consume(TokenType.RightBracket, "Expected ']' after index expression.");
      expr = {
        kind: 'IndexExpression',
        object: expr,
        index,
        line: expr.line,
        column: expr.column,
      };
    } else if (p.match(TokenType.PlusPlus, TokenType.MinusMinus)) {
      const op = p.previous();
      expr = {
        kind: 'UpdateExpression',
        operator: op.lexeme as '++' | '--',
        argument: expr,
        prefix: false,
        line: op.line,
        column: op.column,
      };
    } else {
      break;
    }
  }

  return expr;
}

function parseArgumentList(p: Parser): ExpressionNode[] {
  const args: ExpressionNode[] = [];
  p.skipNewlines();

  if (!p.check(TokenType.RightParen)) {
    do {
      const startPos = p.getPosition();
      p.skipNewlines();
      if (p.check(TokenType.RightParen)) break;
      args.push(parseExpression(p));
      p.skipNewlines();
      if (p.getPosition() === startPos && !p.isAtEnd()) {
        throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in arguments.`);
      }
    } while (p.match(TokenType.Comma));
  }

  p.skipNewlines();
  p.consume(TokenType.RightParen, "Expected ')' after arguments.");
  return args;
}

function parsePrimary(p: Parser): ExpressionNode {
  if (p.match(TokenType.IntLiteral)) {
    const tok = p.previous();
    return {
      kind: 'Literal',
      literalType: 'int',
      value: tok.literal,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.FloatLiteral)) {
    const tok = p.previous();
    return {
      kind: 'Literal',
      literalType: 'float',
      value: tok.literal,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.StringLiteral)) {
    const tok = p.previous();
    return {
      kind: 'Literal',
      literalType: 'str',
      value: tok.literal,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.FStringLiteral)) {
    const tok = p.previous();
    const raw = String(tok.literal ?? '');
    return {
      kind: 'FString',
      raw,
      parts: parseFStringParts(p, raw, tok.line, tok.column),
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.BoolLiteral)) {
    const tok = p.previous();
    return {
      kind: 'Literal',
      literalType: 'bool',
      value: Boolean(tok.literal),
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.NullLiteral)) {
    const tok = p.previous();
    return {
      kind: 'Literal',
      literalType: 'null',
      value: null,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.match(TokenType.Self)) {
    const tok = p.previous();
    return { kind: 'SelfExpression', line: tok.line, column: tok.column };
  }

  if (p.match(TokenType.Super)) {
    const tok = p.previous();
    return { kind: 'SuperExpression', line: tok.line, column: tok.column };
  }

  if (p.match(TokenType.New)) {
    const tok = p.previous();
    if (p.check(TokenType.Identifier) && p.peek().lexeme === 'std' && p.checkNext(TokenType.DoubleColon)) {
      p.advance();
      p.advance();
    }
    const className = p.consume(TokenType.Identifier, "Expected type or class name after 'new'.");
    if (p.match(TokenType.LeftBracket)) {
      p.skipNewlines();
      const countExpr = parseExpression(p);
      p.skipNewlines();
      p.consume(TokenType.RightBracket, "Expected ']' after array size in 'new'.");
      return {
        kind: 'NewExpression',
        className: className.lexeme,
        args: [],
        countExpr,
        line: tok.line,
        column: tok.column,
      };
    }
    p.consume(TokenType.LeftParen, "Expected '(' or '[' after type name in 'new'.");
    const args = parseArgumentList(p);
    return {
      kind: 'NewExpression',
      className: className.lexeme,
      args,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.check(TokenType.Identifier) && p.peek().lexeme === 'sizeof' && p.checkNext(TokenType.LeftParen)) {
    const tok = p.advance();
    p.consume(TokenType.LeftParen, "Expected '(' after 'sizeof'.");
    p.skipNewlines();
    const peekLex = p.peek().lexeme;
    const isPlainType =
      ['int', 'float', 'number', 'str', 'string', 'text', 'bool', 'boolean', 'double', 'char', 'long', 'short', 'auto', 'void', 'ptr'].includes(peekLex) ||
      (p.check(TokenType.Identifier) && p.checkNext(TokenType.Star));
    if (isPlainType) {
      const t = p.parseTypeAnnotation();
      p.skipNewlines();
      p.consume(TokenType.RightParen, "Expected ')' after sizeof argument.");
      const tLabel = `${t.name}${'*'.repeat(t.isPointer ?? 0)}${t.isReference ? '&' : ''}`;
      return {
        kind: 'PointerExpression',
        op: 'sizeof',
        sizeofTypeName: tLabel,
        argument: { kind: 'Literal', literalType: 'null', value: null, line: tok.line, column: tok.column },
        line: tok.line,
        column: tok.column,
      };
    }
    const arg = parseExpression(p);
    p.skipNewlines();
    p.consume(TokenType.RightParen, "Expected ')' after sizeof argument.");
    return {
      kind: 'PointerExpression',
      op: 'sizeof',
      argument: arg,
      line: tok.line,
      column: tok.column,
    };
  }

  if (p.check(TokenType.Identifier) && p.peek().lexeme === 'std' && p.checkNext(TokenType.DoubleColon)) {
    const stdTok = p.advance();
    p.advance();
    if (p.match(TokenType.Move)) {
      p.consume(TokenType.LeftParen, "Expected '(' after 'std::move'.");
      p.skipNewlines();
      const arg = parseExpression(p);
      p.skipNewlines();
      p.consume(TokenType.RightParen, "Expected ')' after 'std::move' argument.");
      return {
        kind: 'PointerExpression',
        op: 'move',
        argument: arg,
        line: stdTok.line,
        column: stdTok.column,
      };
    }
    const fnTok = p.consume(TokenType.Identifier, "Expected symbol after 'std::'.");
    if (p.check(TokenType.Less)) {
      skipOptionalTemplateArgs(p);
    }
    return {
      kind: 'Identifier',
      name: fnTok.lexeme,
      line: stdTok.line,
      column: stdTok.column,
    };
  }

  if (p.match(TokenType.Fn)) {
    return parseLambdaExpression(p);
  }

  if (p.match(TokenType.Match)) {
    return parseMatchExpression(p);
  }

  if (p.match(TokenType.LeftBracket)) {
    return parseArrayLiteral(p);
  }

  if (p.match(TokenType.LeftBrace)) {
    return parseMapLiteral(p);
  }

  if (p.match(TokenType.LeftParen)) {
    const start = p.previous();
    if (looksLikeArrowParams(p)) {
      const params = p.parseParamList();
      p.consume(TokenType.FatArrow, "Expected '=>' after arrow function parameters.");
      p.skipNewlines();
      if (p.check(TokenType.LeftBrace) || p.check(TokenType.Colon)) {
        const body = p.parseBlock();
        return {
          kind: 'LambdaExpression',
          params,
          body,
          line: start.line,
          column: start.column,
        };
      }
      const bodyExpr = parseExpression(p);
      return {
        kind: 'LambdaExpression',
        params,
        body: bodyExpr,
        line: start.line,
        column: start.column,
      };
    }

    p.skipNewlines();
    const expr = parseExpression(p);
    p.skipNewlines();
    p.consume(TokenType.RightParen, "Expected ')' after expression.");
    return { ...expr, line: start.line, column: start.column };
  }

  if (p.match(TokenType.Identifier)) {
    const tok = p.previous();

    if (
      (tok.lexeme === 'make_unique' ||
        tok.lexeme === 'make_shared' ||
        tok.lexeme === 'unique_ptr' ||
        tok.lexeme === 'shared_ptr' ||
        tok.lexeme === 'weak_ptr') &&
      p.check(TokenType.Less)
    ) {
      skipOptionalTemplateArgs(p);
    }

    // Support single-identifier arrow function: `x => x * 2` or `x => { ... }`
    if (p.match(TokenType.FatArrow)) {
      const param: ParamNode = {
        kind: 'Param',
        name: tok.lexeme,
        line: tok.line,
        column: tok.column,
      };
      p.skipNewlines();
      const body =
        p.check(TokenType.LeftBrace) || p.check(TokenType.Colon)
          ? p.parseBlock()
          : parseExpression(p);
      return {
        kind: 'LambdaExpression',
        params: [param],
        body,
        line: tok.line,
        column: tok.column,
      };
    }

    // Support Struct literal syntax: Point { x: 10, y: 20 }
    if (p.allowStructInit && p.check(TokenType.LeftBrace) && looksLikeStructInit(p)) {
      return parseStructInit(p, tok.lexeme, tok.line, tok.column);
    }

    return {
      kind: 'Identifier',
      name: tok.lexeme,
      line: tok.line,
      column: tok.column,
    };
  }

  const bad = p.peek();
  throw p.error(bad, `Unexpected token '${bad.lexeme || bad.type}' in expression.`);
}

function skipOptionalTemplateArgs(p: Parser): void {
  if (!p.match(TokenType.Less)) return;
  let depth = 1;
  while (depth > 0 && !p.isAtEnd()) {
    if (p.match(TokenType.Less)) depth++;
    else if (p.match(TokenType.Greater)) depth--;
    else p.advance();
  }
}

function looksLikeArrowParams(p: Parser): boolean {
  let depth = 1;
  let offset = 0;
  while (offset < 200) {
    const tok = p.peekTokenAt(offset);
    if (tok.type === TokenType.EOF) return false;
    if (tok.type === TokenType.LeftParen) {
      depth++;
    } else if (tok.type === TokenType.RightParen) {
      depth--;
      if (depth === 0) {
        let nextOffset = offset + 1;
        while (p.peekTokenAt(nextOffset).type === TokenType.Newline) {
          nextOffset++;
        }
        return p.peekTokenAt(nextOffset).type === TokenType.FatArrow;
      }
    }
    offset++;
  }
  return false;
}

function looksLikeStructInit(p: Parser): boolean {
  // Distinguish `Point { x: 1, y: 2 }` from `if cond { ... }` or `match x { ... }`.
  // After `{` (ignoring newlines), either `}` (empty struct) or `Identifier :` appears.
  const t1 = p.peekNonNewline(1);
  if (t1.type === TokenType.RightBrace) {
    return true;
  }
  const t2 = p.peekNonNewline(2);
  return t1.type === TokenType.Identifier && t2.type === TokenType.Colon;
}

function parseStructInit(
  p: Parser,
  structName: string,
  line: number,
  column: number
): ExpressionNode {
  p.consume(TokenType.LeftBrace, "Expected '{'.");
  const fields: StructInitField[] = [];
  p.skipNewlines();

  if (!p.check(TokenType.RightBrace)) {
    do {
      const startPos = p.getPosition();
      p.skipNewlines();
      if (p.check(TokenType.RightBrace)) break;
      const fieldName = p.consume(TokenType.Identifier, 'Expected struct field name.');
      p.consume(TokenType.Colon, "Expected ':' after struct field name.");
      p.skipNewlines();
      const value = parseExpression(p);
      fields.push({ name: fieldName.lexeme, value });
      p.skipNewlines();
      if (p.getPosition() === startPos && !p.isAtEnd()) {
        throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in struct initializer.`);
      }
    } while (p.match(TokenType.Comma));
  }

  p.skipNewlines();
  p.consume(TokenType.RightBrace, "Expected '}' after struct fields.");
  return {
    kind: 'StructInitExpression',
    structName,
    fields,
    line,
    column,
  };
}

function parseLambdaExpression(p: Parser): ExpressionNode {
  const start = p.previous();
  let params: ParamNode[] = [];

  if (p.match(TokenType.LeftParen)) {
    params = p.parseParamList();
  } else if (p.check(TokenType.Identifier)) {
    const single = p.advance();
    params = [
      {
        kind: 'Param',
        name: single.lexeme,
        line: single.line,
        column: single.column,
      },
    ];
  }

  if (p.match(TokenType.FatArrow)) {
    p.skipNewlines();
    const body =
      p.check(TokenType.LeftBrace) || p.check(TokenType.Colon)
        ? p.parseBlock()
        : parseExpression(p);
    return {
      kind: 'LambdaExpression',
      params,
      body,
      line: start.line,
      column: start.column,
    };
  }

  if (p.check(TokenType.LeftBrace)) {
    const body = p.parseBlock();
    return {
      kind: 'LambdaExpression',
      params,
      body,
      line: start.line,
      column: start.column,
    };
  }

  throw p.error(p.peek(), "Expected '=>' or '{' in lambda expression.");
}

function parseMatchExpression(p: Parser): ExpressionNode {
  const start = p.previous();
  const prevStructFlag = p.allowStructInit;
  p.allowStructInit = false;
  let subject: ExpressionNode;
  try {
    subject = parseExpression(p);
  } finally {
    p.allowStructInit = prevStructFlag;
  }
  p.skipNewlines();
  p.consume(TokenType.LeftBrace, "Expected '{' after match subject.");
  p.skipSeparators();

  const arms: MatchArmNode[] = [];
  while (!p.check(TokenType.RightBrace) && !p.isAtEnd()) {
    const startPos = p.getPosition();
    const armStart = p.peek();
    const pattern = parseMatchPattern(p);
    if (!p.match(TokenType.FatArrow, TokenType.Colon)) {
      throw p.error(p.peek(), "Expected '=>' or ':' after match pattern.");
    }
    p.skipNewlines();

    const body = p.check(TokenType.LeftBrace) ? p.parseBlock() : parseExpression(p);
    arms.push({
      pattern,
      body,
      line: armStart.line,
      column: armStart.column,
    });
    p.skipSeparators();
    if (p.match(TokenType.Comma)) {
      p.skipSeparators();
    }
    if (p.getPosition() === startPos && !p.isAtEnd()) {
      throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in match expression.`);
    }
  }

  p.consume(TokenType.RightBrace, "Expected '}' to close match expression.");
  return {
    kind: 'MatchExpression',
    subject,
    arms,
    line: start.line,
    column: start.column,
  };
}

function parseMatchPattern(p: Parser): MatchPattern {
  // Optional `case` keyword for readability
  p.match(TokenType.Case);

  if (p.match(TokenType.Default)) {
    return { kind: 'WildcardPattern' };
  }

  if (p.check(TokenType.Identifier) && p.peek().lexeme === '_') {
    p.advance();
    return { kind: 'WildcardPattern' };
  }

  if (p.match(TokenType.IntLiteral, TokenType.FloatLiteral)) {
    const startVal = Number(p.previous().literal);
    if (p.match(TokenType.Range, TokenType.RangeInclusive)) {
      const inclusive = p.previous().type === TokenType.RangeInclusive;
      const endTok = p.consume(TokenType.IntLiteral, 'Expected upper bound integer in range pattern.');
      return {
        kind: 'RangePattern',
        start: startVal,
        end: Number(endTok.literal),
        inclusive,
      };
    }
    return { kind: 'LiteralPattern', value: startVal };
  }

  if (p.match(TokenType.StringLiteral, TokenType.BoolLiteral, TokenType.NullLiteral)) {
    return { kind: 'LiteralPattern', value: p.previous().literal };
  }

  if (p.match(TokenType.Identifier)) {
    const first = p.previous();
    let enumName: string | undefined;
    let variant = first.lexeme;

    if (p.match(TokenType.Dot, TokenType.DoubleColon)) {
      const next = p.consume(TokenType.Identifier, 'Expected enum variant name.');
      enumName = first.lexeme;
      variant = next.lexeme;
    }

    const bindings: string[] = [];
    if (p.match(TokenType.LeftParen)) {
      if (!p.check(TokenType.RightParen)) {
        do {
          const b = p.consume(TokenType.Identifier, 'Expected pattern binding identifier.');
          bindings.push(b.lexeme);
        } while (p.match(TokenType.Comma));
      }
      p.consume(TokenType.RightParen, "Expected ')' after pattern bindings.");
      return { kind: 'EnumPattern', enumName, variant, bindings };
    }

    if (enumName) {
      return { kind: 'EnumPattern', enumName, variant, bindings: [] };
    }

    // Capitalized bare identifiers are treated as enum variants (e.g. `Red`, `None`)
    if (variant[0] >= 'A' && variant[0] <= 'Z') {
      return { kind: 'EnumPattern', variant, bindings: [] };
    }

    return { kind: 'BindingPattern', name: variant };
  }

  throw p.error(p.peek(), `Invalid pattern '${p.peek().lexeme}' in match arm.`);
}

function parseArrayLiteral(p: Parser): ExpressionNode {
  const start = p.previous();
  const elements: ExpressionNode[] = [];
  p.skipNewlines();

  if (!p.check(TokenType.RightBracket)) {
    do {
      const startPos = p.getPosition();
      p.skipNewlines();
      if (p.check(TokenType.RightBracket)) break;
      elements.push(parseExpression(p));
      p.skipNewlines();
      if (p.getPosition() === startPos && !p.isAtEnd()) {
        throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in array literal.`);
      }
    } while (p.match(TokenType.Comma));
  }

  p.skipNewlines();
  p.consume(TokenType.RightBracket, "Expected ']' after array literal.");
  return {
    kind: 'ArrayLiteral',
    elements,
    line: start.line,
    column: start.column,
  };
}

function parseMapLiteral(p: Parser): ExpressionNode {
  const start = p.previous();
  const entries: MapEntryNode[] = [];
  p.skipNewlines();

  if (!p.check(TokenType.RightBrace)) {
    do {
      const startPos = p.getPosition();
      p.skipNewlines();
      if (p.check(TokenType.RightBrace)) break;

      let key: ExpressionNode;
      if (p.check(TokenType.Identifier) || (p.checkNext(TokenType.Colon) && p.peek().lexeme.length > 0 && /^[a-zA-Z_$]/.test(p.peek().lexeme))) {
        const id = p.advance();
        key = {
          kind: 'Literal',
          literalType: 'str',
          value: id.lexeme,
          line: id.line,
          column: id.column,
        };
      } else {
        key = parseExpression(p);
      }

      p.consume(TokenType.Colon, "Expected ':' in map literal.");
      p.skipNewlines();
      const value = parseExpression(p);
      entries.push({ key, value });
      p.skipNewlines();
      if (p.getPosition() === startPos && !p.isAtEnd()) {
        throw p.error(p.peek(), `Unexpected token '${p.peek().lexeme || p.peek().type}' in map literal.`);
      }
    } while (p.match(TokenType.Comma));
  }

  p.skipNewlines();
  p.consume(TokenType.RightBrace, "Expected '}' after map literal.");
  return {
    kind: 'MapLiteral',
    entries,
    line: start.line,
    column: start.column,
  };
}

function parseFStringParts(
  p: Parser,
  raw: string,
  line: number,
  column: number
): FStringPart[] {
  const parts: FStringPart[] = [];
  let textBuffer = '';
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === '\\' && (raw[i + 1] === '{' || raw[i + 1] === '}')) {
      textBuffer += raw[i + 1];
      i += 2;
      continue;
    }

    if (raw[i] === '{') {
      if (textBuffer.length > 0) {
        parts.push({ kind: 'text', value: textBuffer });
        textBuffer = '';
      }

      i++; // skip '{'
      let depth = 1;
      let exprSource = '';
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') depth--;

        if (depth > 0) {
          exprSource += raw[i];
        }
        i++;
      }

      if (depth !== 0) {
        throw p.error(p.previous(), 'Unclosed interpolation `{` in f-string.');
      }

      const subLex = new Lexer(exprSource).tokenize();
      if (subLex.diagnostics.length > 0) {
        throw p.error(p.previous(), `Invalid f-string interpolation: ${subLex.diagnostics[0].message}`);
      }

      // Dynamically parse embedded expression using a fresh Parser via constructor of p
      const SubParser = p.constructor as new (tokens: typeof subLex.tokens) => Parser;
      const subParser = new SubParser(subLex.tokens);
      const expr = subParser.parseExpr();
      parts.push({ kind: 'expr', expression: expr });
      continue;
    }

    textBuffer += raw[i];
    i++;
  }

  if (textBuffer.length > 0 || parts.length === 0) {
    parts.push({ kind: 'text', value: textBuffer });
  }

  void line;
  void column;
  return parts;
}
