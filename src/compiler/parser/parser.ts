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

const MAX_PARSER_RECURSION_DEPTH = 200;

export class Parser {
  private readonly tokens: Token[];
  public readonly diagnostics: CompilerDiagnostic[] = [];
  public allowStructInit = true;
  private current = 0;
  private recursionDepth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): ParseResult {
    const body: StatementNode[] = [];
    this.skipSeparators();
    let recoveredFromError = false;

    while (!this.isAtEnd()) {
      const startPos = this.current;
      try {
        const stmt = parseDeclaration(this);
        if (stmt) {
          body.push(stmt);
          recoveredFromError = false;
        } else if (this.current === startPos && !this.isAtEnd()) {
          // Consume stray closing delimiters (`}` or `Dedent`) so Parser.parse() always advances
          if (recoveredFromError && this.check(TokenType.Dedent)) {
            this.advance();
          } else {
            const bad = this.peek();
            this.diagnostics.push(
              this.error(
                bad,
                `Unexpected token '${bad.lexeme || bad.type}'.`,
                'Check for an extra closing brace or mismatched indentation.'
              ).toDiagnostic('error')
            );
            this.advance();
          }
        }
      } catch (err) {
        if (err instanceof ParserError) {
          this.diagnostics.push(err.toDiagnostic('error'));
          this.synchronize();
          recoveredFromError = true;
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

  public getPosition(): number {
    return this.current;
  }

  public parseExpr(): ExpressionNode {
    return parseExpression(this);
  }

  public parseBlock(): BlockStatementNode {
    return parseBlockStatement(this);
  }

  public parseTypeAnnotation(): TypeAnnotationNode {
    const first = this.parseSingleTypeAnnotation();

    if (this.check(TokenType.Or) || this.check(TokenType.Pipe)) {
      const unionTypes: TypeAnnotationNode[] = [first];
      while (this.match(TokenType.Or, TokenType.Pipe)) {
        this.skipNewlines();
        unionTypes.push(this.parseSingleTypeAnnotation());
      }
      return {
        kind: 'TypeAnnotation',
        name: unionTypes.map((t) => t.name).join(' | '),
        generics: [],
        nullable: unionTypes.some((t) => t.nullable),
        unionTypes,
        line: first.line,
        column: first.column,
      };
    }

    return first;
  }

  private parseSingleTypeAnnotation(): TypeAnnotationNode {
    const start = this.peek();
    const isConst = this.match(TokenType.Const);
    if (this.check(TokenType.Identifier) && this.peek().lexeme === 'std' && this.checkNext(TokenType.DoubleColon)) {
      this.advance();
      this.advance();
    }
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

    let isPointer = 0;
    while (this.check(TokenType.Star) || this.check(TokenType.Power)) {
      const tok = this.advance();
      isPointer += tok.type === TokenType.Power ? 2 : 1;
    }
    const isReference = isPointer === 0 ? this.match(TokenType.Ampersand) : false;
    const isConstPointer = isPointer > 0 ? this.match(TokenType.Const) : false;
    const nullable = this.match(TokenType.Question);

    return {
      kind: 'TypeAnnotation',
      name: nameToken.lexeme,
      generics,
      nullable,
      isPointer: isPointer > 0 ? isPointer : undefined,
      isReference: isReference || undefined,
      isConst: isConst || undefined,
      isConstPointer: isConstPointer || undefined,
      line: start.line,
      column: start.column,
    };
  }

  public parseGenericParams(): string[] | undefined {
    if (!this.match(TokenType.Less)) return undefined;
    const params: string[] = [];
    this.skipNewlines();
    if (!this.check(TokenType.Greater)) {
      do {
        this.skipNewlines();
        const tp = this.consume(TokenType.Identifier, 'Expected generic type parameter name.');
        params.push(tp.lexeme);
        this.skipNewlines();
      } while (this.match(TokenType.Comma));
    }
    this.consume(TokenType.Greater, "Expected '>' after generic type parameters.");
    return params;
  }

  private looksLikeTypeFirstParam(): boolean {
    if (this.check(TokenType.Const)) return true;
    if (this.check(TokenType.Identifier) && this.peek().lexeme === 'std' && this.checkNext(TokenType.DoubleColon)) {
      return true;
    }
    if (!this.check(TokenType.Identifier) && !this.isTypeKeyword(this.peek().type)) {
      return false;
    }
    const next = this.peekTokenAt(1);
    if (
      next.type === TokenType.Colon ||
      next.type === TokenType.Assign ||
      next.type === TokenType.Comma ||
      next.type === TokenType.RightParen
    ) {
      return false;
    }
    return (
      next.type === TokenType.Star ||
      next.type === TokenType.Ampersand ||
      next.type === TokenType.Less ||
      next.type === TokenType.Identifier
    );
  }

  public parseParamList(): ParamNode[] {
    const params: ParamNode[] = [];
    this.skipNewlines();

    if (!this.check(TokenType.RightParen)) {
      do {
        const loopStart = this.current;
        this.skipNewlines();
        if (this.check(TokenType.RightParen)) break;

        let nameToken: Token;
        let typeAnnotation: TypeAnnotationNode | undefined;
        let defaultValue: ExpressionNode | undefined;

        if (this.looksLikeTypeFirstParam()) {
          typeAnnotation = this.parseTypeAnnotation();
          nameToken = this.consume(TokenType.Identifier, 'Expected parameter name after type.');
        } else {
          nameToken = this.consume(TokenType.Identifier, 'Expected parameter name.');
          if (this.match(TokenType.Colon)) {
            typeAnnotation = this.parseTypeAnnotation();
          }
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
        if (this.current === loopStart && !this.isAtEnd()) {
          throw this.error(this.peek(), `Unexpected token '${this.peek().lexeme || this.peek().type}' in parameter list.`);
        }
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
      this.check(TokenType.Dedent) ||
      this.check(TokenType.Newline) ||
      this.check(TokenType.Semicolon) ||
      this.previous().type === TokenType.Dedent
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

  public peekTokenAt(offset: number): Token {
    const idx = Math.min(this.current + offset, this.tokens.length - 1);
    return this.tokens[Math.max(0, idx)];
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

  public withRecursionLimit<T>(fn: () => T): T {
    if (this.recursionDepth >= MAX_PARSER_RECURSION_DEPTH) {
      throw this.error(
        this.peek(),
        `Maximum nesting depth (${MAX_PARSER_RECURSION_DEPTH}) exceeded.`,
        'Reduce deeply nested expressions or blocks.'
      );
    }
    this.recursionDepth += 1;
    try {
      return fn();
    } finally {
      this.recursionDepth -= 1;
    }
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
        case TokenType.Var:
        case TokenType.Const:
        case TokenType.Import:
        case TokenType.Own:
        case TokenType.Ref:
        case TokenType.Shared:
        case TokenType.For:
        case TokenType.If:
        case TokenType.While:
        case TokenType.Loop:
        case TokenType.Repeat:
        case TokenType.Return:
        case TokenType.Try:
        case TokenType.Defer:
        case TokenType.Drop:
        case TokenType.Scope:
        case TokenType.Dedent:
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
