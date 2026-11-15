import {
  BlockStatementNode,
  ExpressionNode,
  ParamNode,
  ProgramNode,
  StatementNode,
  TypeAnnotationNode,
} from '../ast/nodes.ts';
import { CompilerDiagnostic, ParserError } from '../errors/compilerErrors.ts';
import { Token, TokenType } from '../lexer/tokens.ts';
import { parseExpression } from './expressions.ts';
import { parseBlockStatement, parseDeclaration } from './statements.ts';

export interface ParseResult {
  ast: ProgramNode;
  diagnostics: CompilerDiagnostic[];
}

export class Parser {
  private readonly tokens: Token[];
  public readonly diagnostics: CompilerDiagnostic[] = [];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): ParseResult {
    const body: StatementNode[] = [];
    this.skipSeparators();

    while (!this.isAtEnd()) {
      try {
        const stmt = parseDeclaration(this);
        if (stmt) {
          body.push(stmt);
        }
      } catch (err) {
        if (err instanceof ParserError) {
          this.diagnostics.push(err.toDiagnostic('error'));
          this.synchronize();
        } else {
          throw err;
        }
      }
      this.skipSeparators();
    }

    const firstToken = this.tokens[0];
    return {
      ast: {
        kind: 'Program',
        body,
        line: firstToken?.line ?? 1,
        column: firstToken?.column ?? 1,
      },
      diagnostics: this.diagnostics,
    };
  }

  public parseExpr(): ExpressionNode {
    return parseExpression(this);
  }

  public parseBlock(): BlockStatementNode {
    return parseBlockStatement(this);
  }

  public parseTypeAnnotation(): TypeAnnotationNode {
    const start = this.peek();
    if (!this.check(TokenType.Identifier) && !this.isTypeKeyword(this.peek().type)) {
      throw this.error(this.peek(), `Expected type name, got '${this.peek().lexeme}'`);
    }

    const nameToken = this.advance();
    const generics: TypeAnnotationNode[] = [];

    if (this.match(TokenType.Less)) {
      this.skipNewlines();
      do {
        this.skipNewlines();
        generics.push(this.parseTypeAnnotation());
        this.skipNewlines();
      } while (this.match(TokenType.Comma));
      this.consume(TokenType.Greater, "Expected '>' after generic type arguments.");
    }

    const nullable = this.match(TokenType.Question);

    return {
      kind: 'TypeAnnotation',
      name: nameToken.lexeme,
      generics,
      nullable,
      line: start.line,
      column: start.column,
    };
  }

  public parseParamList(): ParamNode[] {
    const params: ParamNode[] = [];
    this.skipNewlines();

    if (!this.check(TokenType.RightParen)) {
      do {
        this.skipNewlines();
        if (this.check(TokenType.RightParen)) break;

        const nameToken = this.consume(TokenType.Identifier, 'Expected parameter name.');
        let typeAnnotation: TypeAnnotationNode | undefined;
        let defaultValue: ExpressionNode | undefined;

        if (this.match(TokenType.Colon)) {
          typeAnnotation = this.parseTypeAnnotation();
        }
        if (this.match(TokenType.Assign)) {
          defaultValue = this.parseExpr();
        }

        params.push({
          kind: 'Param',
          name: nameToken.lexeme,
          typeAnnotation,
          defaultValue,
          line: nameToken.line,
          column: nameToken.column,
        });
        this.skipNewlines();
      } while (this.match(TokenType.Comma));
    }

    this.skipNewlines();
    this.consume(TokenType.RightParen, "Expected ')' after parameter list.");
    return params;
  }

  // ============================================================================
  // Token Navigation Helpers
  // ============================================================================

  public skipNewlines(): void {
    while (this.check(TokenType.Newline)) {
      this.advance();
    }
  }

  public skipSeparators(): void {
    while (this.check(TokenType.Newline) || this.check(TokenType.Semicolon)) {
      this.advance();
    }
  }

  public consumeStatementEnd(): void {
    if (
      this.isAtEnd() ||
      this.check(TokenType.RightBrace) ||
      this.check(TokenType.Newline) ||
      this.check(TokenType.Semicolon)
    ) {
      this.skipSeparators();
      return;
    }
    throw this.error(
      this.peek(),
      `Unexpected token '${this.peek().lexeme}' at end of statement.`,
      'Add a newline or semicolon between statements.'
    );
  }

  public match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  public check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === TokenType.EOF;
    return this.peek().type === type;
  }

  public checkNext(type: TokenType): boolean {
    if (this.current + 1 >= this.tokens.length) return false;
    return this.tokens[this.current + 1].type === type;
  }

  public advance(): Token {
    if (!this.isAtEnd()) {
      this.current++;
    }
    return this.previous();
  }

  public isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  public peek(): Token {
    return this.tokens[this.current];
  }

  public previous(): Token {
    return this.tokens[Math.max(0, this.current - 1)];
  }

  public consume(type: TokenType, message: string, hint?: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    throw this.error(this.peek(), message, hint);
  }

  public error(token: Token, message: string, hint?: string): ParserError {
    return new ParserError(message, token.line, token.column, hint);
  }

  public peekNonNewline(offset = 1): Token {
    let idx = this.current;
    let remaining = offset;
    while (idx < this.tokens.length) {
      if (this.tokens[idx].type !== TokenType.Newline) {
        if (remaining === 0) return this.tokens[idx];
        remaining--;
      }
      idx++;
    }
    return this.tokens[this.tokens.length - 1];
  }

  private isTypeKeyword(type: TokenType): boolean {
    return (
      type === TokenType.Own ||
      type === TokenType.Ref ||
      type === TokenType.Shared
    );
  }

  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (
        this.previous().type === TokenType.Semicolon ||
        this.previous().type === TokenType.Newline ||
        this.previous().type === TokenType.RightBrace
      ) {
        return;
      }

      switch (this.peek().type) {
        case TokenType.Class:
        case TokenType.Struct:
        case TokenType.Enum:
        case TokenType.Trait:
        case TokenType.Fn:
        case TokenType.Let:
        case TokenType.Const:
        case TokenType.Own:
        case TokenType.Ref:
        case TokenType.Shared:
        case TokenType.For:
        case TokenType.If:
        case TokenType.While:
        case TokenType.Loop:
        case TokenType.Return:
        case TokenType.Try:
        case TokenType.Defer:
        case TokenType.Drop:
          return;
        default:
          this.advance();
      }
    }
  }
}

export function parse(tokens: Token[]): ParseResult {
  return new Parser(tokens).parse();
}
