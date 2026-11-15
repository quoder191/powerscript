import { CompilerDiagnostic, LexerError } from '../errors/compilerErrors.ts';
import { lookupKeyword } from './keywords.ts';
import { createToken, Token, TokenType } from './tokens.ts';

export interface LexerResult {
  tokens: Token[];
  diagnostics: CompilerDiagnostic[];
}

export class Lexer {
  private readonly source: string;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: CompilerDiagnostic[] = [];

  private start = 0;
  private current = 0;
  private line = 1;
  private column = 1;
  private tokenStartLine = 1;
  private tokenStartColumn = 1;

  constructor(source: string) {
    this.source = source;
  }

  public tokenize(): LexerResult {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.tokenStartLine = this.line;
      this.tokenStartColumn = this.column;
      this.scanToken();
    }

    this.tokens.push(
      createToken(TokenType.EOF, '', null, this.line, this.column, this.current, this.current)
    );

    return {
      tokens: this.tokens,
      diagnostics: this.diagnostics,
    };
  }

  private scanToken(): void {
    const c = this.advance();

    switch (c) {
      // Whitespace
      case ' ':
      case '\r':
      case '\t':
        return;

      case '\n': {
        this.emitToken(TokenType.Newline, '\n', null);
        return;
      }

      // Single-character punctuation
      case '(':
        this.emitToken(TokenType.LeftParen);
        return;
      case ')':
        this.emitToken(TokenType.RightParen);
        return;
      case '{':
        this.emitToken(TokenType.LeftBrace);
        return;
      case '}':
        this.emitToken(TokenType.RightBrace);
        return;
      case '[':
        this.emitToken(TokenType.LeftBracket);
        return;
      case ']':
        this.emitToken(TokenType.RightBracket);
        return;
      case ',':
        this.emitToken(TokenType.Comma);
        return;
      case ';':
        this.emitToken(TokenType.Semicolon);
        return;
      case '%':
        this.emitToken(TokenType.Percent);
        return;

      // Comments starting with # (Python-style ergonomics)
      case '#':
        this.skipLineComment();
        return;

      // Multi-character operators & punctuation
      case '+':
        if (this.match('+')) {
          this.emitToken(TokenType.PlusPlus);
        } else if (this.match('=')) {
          this.emitToken(TokenType.PlusAssign);
        } else {
          this.emitToken(TokenType.Plus);
        }
        return;

      case '-':
        if (this.match('-')) {
          this.emitToken(TokenType.MinusMinus);
        } else if (this.match('>')) {
          this.emitToken(TokenType.Arrow);
        } else if (this.match('=')) {
          this.emitToken(TokenType.MinusAssign);
        } else {
          this.emitToken(TokenType.Minus);
        }
        return;

      case '*':
        if (this.match('*')) {
          this.emitToken(TokenType.Power);
        } else if (this.match('=')) {
          this.emitToken(TokenType.StarAssign);
        } else {
          this.emitToken(TokenType.Star);
        }
        return;

      case '/':
        if (this.match('/')) {
          this.skipLineComment();
        } else if (this.match('*')) {
          this.skipBlockComment();
        } else if (this.match('=')) {
          this.emitToken(TokenType.SlashAssign);
        } else {
          this.emitToken(TokenType.Slash);
        }
        return;

      case '=':
        if (this.match('=')) {
          this.emitToken(TokenType.Equal);
        } else if (this.match('>')) {
          this.emitToken(TokenType.FatArrow);
        } else {
          this.emitToken(TokenType.Assign);
        }
        return;

      case '!':
        this.emitToken(this.match('=') ? TokenType.NotEqual : TokenType.Bang);
        return;

      case '<':
        this.emitToken(this.match('=') ? TokenType.LessEqual : TokenType.Less);
        return;

      case '>':
        this.emitToken(this.match('=') ? TokenType.GreaterEqual : TokenType.Greater);
        return;

      case '&':
        this.emitToken(this.match('&') ? TokenType.AndAnd : TokenType.Ampersand);
        return;

      case '|':
        if (this.match('>')) {
          this.emitToken(TokenType.PipeArrow);
        } else if (this.match('|')) {
          this.emitToken(TokenType.PipePipe);
        } else {
          this.reportError(`Unexpected character '|'`, 'Use `|>` for pipelines or `||` / `or` for logical OR.');
        }
        return;

      case '.':
        if (this.match('.')) {
          this.emitToken(this.match('=') ? TokenType.RangeInclusive : TokenType.Range);
        } else {
          this.emitToken(TokenType.Dot);
        }
        return;

      case '?':
        if (this.match('?')) {
          this.emitToken(TokenType.Nullish);
        } else if (this.match('.')) {
          this.emitToken(TokenType.OptionalChain);
        } else {
          this.emitToken(TokenType.Question);
        }
        return;

      case ':':
        this.emitToken(this.match(':') ? TokenType.DoubleColon : TokenType.Colon);
        return;

      // Strings
      case '"':
      case "'":
        this.scanString(c, false);
        return;

      default:
        // Interpolated f-string: f"..." or f'...'
        if ((c === 'f' || c === 'F') && (this.peek() === '"' || this.peek() === "'")) {
          const quote = this.advance();
          this.scanString(quote, true);
          return;
        }

        if (this.isDigit(c)) {
          this.scanNumber(c);
          return;
        }

        if (this.isIdentifierStart(c)) {
          this.scanIdentifier();
          return;
        }

        this.reportError(`Unexpected character '${c}'`);
    }
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    let depth = 1;
    while (!this.isAtEnd() && depth > 0) {
      if (this.peek() === '/' && this.peekNext() === '*') {
        this.advance();
        this.advance();
        depth++;
      } else if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance();
        this.advance();
        depth--;
      } else {
        this.advance();
      }
    }

    if (depth > 0) {
      this.reportError('Unterminated block comment', 'Add closing `*/` before end of file.');
    }
  }

  private scanString(quote: string, isFString: boolean): void {
    let value = '';
    let braceDepth = 0;

    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === quote && braceDepth === 0) {
        this.advance();
        this.emitToken(
          isFString ? TokenType.FStringLiteral : TokenType.StringLiteral,
          this.source.slice(this.start, this.current),
          value
        );
        return;
      }

      if (ch === '\\') {
        this.advance();
        if (this.isAtEnd()) break;
        const esc = this.advance();
        switch (esc) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case 'r':
            value += '\r';
            break;
          case '\\':
            value += '\\';
            break;
          case '"':
            value += '"';
            break;
          case "'":
            value += "'";
            break;
          case '{':
            value += isFString ? '\\{' : '{';
            break;
          case '}':
            value += isFString ? '\\}' : '}';
            break;
          default:
            value += esc;
            break;
        }
        continue;
      }

      if (isFString) {
        if (ch === '{') braceDepth++;
        else if (ch === '}' && braceDepth > 0) braceDepth--;
      }

      value += this.advance();
    }

    this.reportError(
      isFString ? 'Unterminated f-string literal' : 'Unterminated string literal',
      `Add closing ${quote} quote.`
    );
  }

  private scanNumber(firstChar: string): void {
    // Support hex (0x) and binary (0b) integers
    if (firstChar === '0' && (this.peek() === 'x' || this.peek() === 'X')) {
      this.advance();
      while (this.isHexDigit(this.peek()) || this.peek() === '_') {
        this.advance();
      }
      const raw = this.source.slice(this.start, this.current).replace(/_/g, '');
      const parsed = Number.parseInt(raw.slice(2), 16);
      if (Number.isNaN(parsed)) {
        this.reportError(`Invalid hexadecimal literal '${raw}'`);
        return;
      }
      this.emitToken(TokenType.IntLiteral, this.source.slice(this.start, this.current), parsed);
      return;
    }

    if (firstChar === '0' && (this.peek() === 'b' || this.peek() === 'B')) {
      this.advance();
      while (this.peek() === '0' || this.peek() === '1' || this.peek() === '_') {
        this.advance();
      }
      const raw = this.source.slice(this.start, this.current).replace(/_/g, '');
      const parsed = Number.parseInt(raw.slice(2), 2);
      if (Number.isNaN(parsed)) {
        this.reportError(`Invalid binary literal '${raw}'`);
        return;
      }
      this.emitToken(TokenType.IntLiteral, this.source.slice(this.start, this.current), parsed);
      return;
    }

    while (this.isDigit(this.peek()) || this.peek() === '_') {
      this.advance();
    }

    let isFloat = false;
    // Check decimal point, making sure not to swallow range operator `1..10`
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      isFloat = true;
      this.advance();
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        this.advance();
      }
    }

    // Scientific notation (e.g. 1e5, 2.5e-3)
    if (this.peek() === 'e' || this.peek() === 'E') {
      const next = this.peekNext();
      if (this.isDigit(next) || next === '+' || next === '-') {
        isFloat = true;
        this.advance();
        if (this.peek() === '+' || this.peek() === '-') {
          this.advance();
        }
        while (this.isDigit(this.peek()) || this.peek() === '_') {
          this.advance();
        }
      }
    }

    const lexeme = this.source.slice(this.start, this.current);
    const cleaned = lexeme.replace(/_/g, '');
    const value = isFloat ? Number.parseFloat(cleaned) : Number.parseInt(cleaned, 10);

    this.emitToken(isFloat ? TokenType.FloatLiteral : TokenType.IntLiteral, lexeme, value);
  }

  private scanIdentifier(): void {
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(this.start, this.current);
    const keywordType = lookupKeyword(lexeme);

    if (keywordType === TokenType.BoolLiteral) {
      this.emitToken(TokenType.BoolLiteral, lexeme, lexeme === 'true');
      return;
    }

    if (keywordType === TokenType.NullLiteral) {
      this.emitToken(TokenType.NullLiteral, lexeme, null);
      return;
    }

    this.emitToken(keywordType ?? TokenType.Identifier, lexeme, lexeme);
  }

  private emitToken(
    type: TokenType,
    lexeme = this.source.slice(this.start, this.current),
    literal: string | number | boolean | null = null
  ): void {
    this.tokens.push(
      createToken(
        type,
        lexeme,
        literal,
        this.tokenStartLine,
        this.tokenStartColumn,
        this.start,
        this.current
      )
    );
  }

  private reportError(message: string, hint?: string): void {
    const err = new LexerError(message, this.tokenStartLine, this.tokenStartColumn, hint);
    this.diagnostics.push(err.toDiagnostic('error'));
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  private advance(): string {
    const ch = this.source[this.current++];
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private match(expected: string): boolean {
    if (this.isAtEnd() || this.source[this.current] !== expected) {
      return false;
    }
    this.advance();
    return true;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.current];
  }

  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return '\0';
    return this.source[this.current + 1];
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (
      (ch >= '0' && ch <= '9') ||
      (ch >= 'a' && ch <= 'f') ||
      (ch >= 'A' && ch <= 'F')
    );
  }

  private isIdentifierStart(ch: string): boolean {
    return (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      ch === '$'
    );
  }

  private isIdentifierPart(ch: string): boolean {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }
}

export function tokenize(source: string): LexerResult {
  return new Lexer(source).tokenize();
}
