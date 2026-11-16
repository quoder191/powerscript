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

  // Indentation & nesting tracking for colon-indented blocks (`if age > 18:\n  ...`)
  private braceDepth = 0;
  private parenDepth = 0;
  private bracketDepth = 0;
  private atLineStart = true;
  private readonly indentStack: number[] = [0];
  private readonly braceStack: Array<{ indentLen: number; allowIndent: boolean }> = [];
  private readonly delimiterStack: Array<'paren' | 'bracket' | 'braceBlock' | 'braceMap'> = [];
  private lastSignificantTokenType: TokenType | null = null;

  constructor(source: string) {
    this.source = source;
  }

  public tokenize(): LexerResult {
    while (!this.isAtEnd()) {
      const topDelimiter =
        this.delimiterStack.length > 0
          ? this.delimiterStack[this.delimiterStack.length - 1]
          : null;
      const canHandleIndent = topDelimiter === null || topDelimiter === 'braceBlock';
      if (this.atLineStart && canHandleIndent) {
        this.handleLineIndentation();
        if (this.isAtEnd()) break;
      }

      this.start = this.current;
      this.tokenStartLine = this.line;
      this.tokenStartColumn = this.column;
      this.scanToken();
    }

    // Close any remaining indentation levels cleanly at EOF
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push(
        createToken(TokenType.Dedent, '', null, this.line, this.column, this.current, this.current)
      );
    }

    this.tokens.push(
      createToken(TokenType.EOF, '', null, this.line, this.column, this.current, this.current)
    );

    return {
      tokens: this.tokens,
      diagnostics: this.diagnostics,
    };
  }

  private handleLineIndentation(): void {
    let spaces = 0;
    let probe = this.current;

    while (probe < this.source.length) {
      const ch = this.source[probe];
      if (ch === ' ') {
        spaces++;
        probe++;
      } else if (ch === '\t') {
        spaces += 2;
        probe++;
      } else {
        break;
      }
    }

    // Ignore blank lines and comment-only lines for indentation changes
    const nextCh = this.source[probe];
    const nextNext = this.source[probe + 1];
    if (
      nextCh === undefined ||
      nextCh === '\n' ||
      nextCh === '\r' ||
      nextCh === '#' ||
      (nextCh === '/' && (nextNext === '/' || nextNext === '*'))
    ) {
      this.atLineStart = false;
      return;
    }

    // Consume leading whitespace on this active line
    while (this.current < probe) {
      this.advance();
    }
    this.atLineStart = false;

    const currentIndent = this.indentStack[this.indentStack.length - 1];
    if (spaces > currentIndent && this.lastSignificantTokenType === TokenType.Colon) {
      this.indentStack.push(spaces);
      this.tokens.push(
        createToken(TokenType.Indent, '', null, this.line, this.column, this.current, this.current)
      );
    } else if (spaces < currentIndent) {
      const minIndentLen =
        this.braceStack.length > 0
          ? this.braceStack[this.braceStack.length - 1].indentLen
          : 1;
      while (
        this.indentStack.length > minIndentLen &&
        spaces < this.indentStack[this.indentStack.length - 1]
      ) {
        this.indentStack.pop();
        this.tokens.push(
          createToken(TokenType.Dedent, '', null, this.line, this.column, this.current, this.current)
        );
      }
    }
  }

  private popDelimiter(kind: 'paren' | 'bracket' | 'brace'): void {
    for (let i = this.delimiterStack.length - 1; i >= 0; i--) {
      const entry = this.delimiterStack[i];
      const matches =
        kind === 'brace'
          ? entry === 'braceBlock' || entry === 'braceMap'
          : entry === kind;
      if (matches) {
        this.delimiterStack.length = i;
        return;
      }
    }
  }

  private isBlockOpeningBrace(): boolean {
    // Walk back to the previous non-newline token
    let idx = this.tokens.length - 1;
    while (idx >= 0 && this.tokens[idx].type === TokenType.Newline) {
      idx--;
    }
    if (idx < 0) return true;

    const prev = this.tokens[idx].type;
    if (
      prev === TokenType.LeftBrace ||
      prev === TokenType.RightBrace ||
      prev === TokenType.Semicolon ||
      prev === TokenType.Indent ||
      prev === TokenType.Dedent ||
      prev === TokenType.FatArrow
    ) {
      return true;
    }

    if (
      prev === TokenType.Assign ||
      prev === TokenType.PlusAssign ||
      prev === TokenType.MinusAssign ||
      prev === TokenType.StarAssign ||
      prev === TokenType.SlashAssign ||
      prev === TokenType.Comma ||
      prev === TokenType.Colon ||
      prev === TokenType.LeftParen ||
      prev === TokenType.LeftBracket ||
      prev === TokenType.Return ||
      prev === TokenType.Throw ||
      prev === TokenType.Question ||
      prev === TokenType.Nullish
    ) {
      return false;
    }

    // Scan backwards to the start of the current statement (respecting paren/bracket nesting)
    let paren = 0;
    let bracket = 0;
    let stmtStart = 0;
    for (let i = idx; i >= 0; i--) {
      const t = this.tokens[i].type;
      if (t === TokenType.RightParen) {
        paren++;
      } else if (t === TokenType.LeftParen) {
        if (paren === 0) {
          stmtStart = i + 1;
          break;
        }
        paren--;
      } else if (t === TokenType.RightBracket) {
        bracket++;
      } else if (t === TokenType.LeftBracket) {
        if (bracket === 0) {
          stmtStart = i + 1;
          break;
        }
        bracket--;
      }

      if (paren === 0 && bracket === 0) {
        if (
          t === TokenType.Semicolon ||
          t === TokenType.LeftBrace ||
          t === TokenType.RightBrace ||
          t === TokenType.Indent ||
          t === TokenType.Dedent ||
          t === TokenType.Assign ||
          t === TokenType.Comma ||
          t === TokenType.FatArrow
        ) {
          stmtStart = i + 1;
          break;
        }
        // Only treat Newline as statement boundary if next token starts a statement
        if (t === TokenType.Newline && i < idx) {
          const nextTok = this.tokens[i + 1].type;
          if (
            nextTok === TokenType.Class ||
            nextTok === TokenType.Struct ||
            nextTok === TokenType.Enum ||
            nextTok === TokenType.Trait ||
            nextTok === TokenType.Fn ||
            nextTok === TokenType.Init ||
            nextTok === TokenType.Pub ||
            nextTok === TokenType.Priv ||
            nextTok === TokenType.Prot ||
            nextTok === TokenType.Override ||
            nextTok === TokenType.Static ||
            nextTok === TokenType.Export ||
            nextTok === TokenType.If ||
            nextTok === TokenType.Elif ||
            nextTok === TokenType.Else ||
            nextTok === TokenType.For ||
            nextTok === TokenType.While ||
            nextTok === TokenType.Loop ||
            nextTok === TokenType.Repeat ||
            nextTok === TokenType.Try ||
            nextTok === TokenType.Catch ||
            nextTok === TokenType.Scope
          ) {
            stmtStart = i + 1;
            break;
          }
        }
      }
    }

    while (stmtStart <= idx) {
      const t = this.tokens[stmtStart].type;
      if (
        t === TokenType.Newline ||
        t === TokenType.Export ||
        t === TokenType.Pub ||
        t === TokenType.Priv ||
        t === TokenType.Prot ||
        t === TokenType.Override ||
        t === TokenType.Static
      ) {
        stmtStart++;
        continue;
      }
      return (
        t === TokenType.Class ||
        t === TokenType.Struct ||
        t === TokenType.Enum ||
        t === TokenType.Trait ||
        t === TokenType.Fn ||
        t === TokenType.Init ||
        t === TokenType.If ||
        t === TokenType.Elif ||
        t === TokenType.Else ||
        t === TokenType.For ||
        t === TokenType.While ||
        t === TokenType.Loop ||
        t === TokenType.Repeat ||
        t === TokenType.Try ||
        t === TokenType.Catch ||
        t === TokenType.Scope
      );
    }
    return false;
  }

  private scanToken(): void {
    const c = this.advance();

    switch (c) {
      case ' ':
      case '\r':
      case '\t':
        return;

      case '\n':
        this.emitToken(TokenType.Newline, '\n', null);
        this.atLineStart = true;
        return;

      case '(':
        this.parenDepth++;
        this.delimiterStack.push('paren');
        this.emitToken(TokenType.LeftParen);
        return;
      case ')':
        this.parenDepth = Math.max(0, this.parenDepth - 1);
        this.popDelimiter('paren');
        this.emitToken(TokenType.RightParen);
        return;
      case '{': {
        const allowIndent = this.isBlockOpeningBrace();
        this.braceStack.push({ indentLen: this.indentStack.length, allowIndent });
        this.delimiterStack.push(allowIndent ? 'braceBlock' : 'braceMap');
        this.braceDepth++;
        this.emitToken(TokenType.LeftBrace);
        return;
      }
      case '}': {
        const closed = this.braceStack.pop();
        if (closed) {
          while (this.indentStack.length > closed.indentLen) {
            this.indentStack.pop();
            this.tokens.push(
              createToken(TokenType.Dedent, '', null, this.line, this.column, this.current, this.current)
            );
          }
        }
        this.popDelimiter('brace');
        this.braceDepth = Math.max(0, this.braceDepth - 1);
        this.emitToken(TokenType.RightBrace);
        return;
      }
      case '[':
        this.bracketDepth++;
        this.delimiterStack.push('bracket');
        this.emitToken(TokenType.LeftBracket);
        return;
      case ']':
        this.bracketDepth = Math.max(0, this.bracketDepth - 1);
        this.popDelimiter('bracket');
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

      case '#':
        this.skipLineComment();
        return;

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
          this.emitToken(TokenType.Pipe);
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

      case '`':
        this.scanMultilineBacktickString();
        return;

      case '"':
      case "'":
        if (this.peek() === c && this.peekNext() === c) {
          this.advance();
          this.advance();
          this.scanTripleQuotedString(c);
          return;
        }
        this.scanString(c, true);
        return;

      default:
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

  private scanTripleQuotedString(quote: string): void {
    let value = '';
    while (!this.isAtEnd()) {
      if (
        this.peek() === quote &&
        this.peekNext() === quote &&
        this.source[this.current + 2] === quote
      ) {
        this.advance();
        this.advance();
        this.advance();
        const isInterpolated = this.hasInterpolation(value);
        this.emitToken(
          isInterpolated ? TokenType.FStringLiteral : TokenType.StringLiteral,
          this.source.slice(this.start, this.current),
          value
        );
        return;
      }
      value += this.advance();
    }
    this.reportError(
      'Unterminated multiline string literal',
      `Add closing ${quote.repeat(3)} delimiter.`
    );
  }

  private scanMultilineBacktickString(): void {
    let value = '';
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === '`') {
        this.advance();
        const isInterpolated = this.hasInterpolation(value);
        this.emitToken(
          isInterpolated ? TokenType.FStringLiteral : TokenType.StringLiteral,
          this.source.slice(this.start, this.current),
          value
        );
        return;
      }
      if (ch === '\\' && this.peekNext() === '`') {
        this.advance();
        value += this.advance();
        continue;
      }
      value += this.advance();
    }
    this.reportError('Unterminated multiline backtick string', 'Add closing ` backtick.');
  }

  private hasInterpolation(raw: string): boolean {
    // Detect unescaped `{expr}` interpolation cleanly
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\') {
        i++;
        continue;
      }
      if (raw[i] === '{') {
        const rest = raw.slice(i + 1);
        const closeIdx = rest.indexOf('}');
        if (closeIdx > 0 && /^[a-zA-Z0-9_$.()+\-*/% '"[\],]+$/.test(rest.slice(0, closeIdx).trim())) {
          return true;
        }
      }
    }
    return false;
  }

  private scanString(quote: string, allowInterpolation: boolean): void {
    let value = '';
    let braceDepth = 0;
    let sawInterpolation = false;
    const explicitF = this.source[this.start] === 'f' || this.source[this.start] === 'F';

    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === quote && braceDepth === 0) {
        this.advance();
        const emitAsF = explicitF || (allowInterpolation && sawInterpolation && this.hasInterpolation(value));
        this.emitToken(
          emitAsF ? TokenType.FStringLiteral : TokenType.StringLiteral,
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
            value += '\\{';
            break;
          case '}':
            value += '\\}';
            break;
          default:
            value += esc;
            break;
        }
        continue;
      }

      if (allowInterpolation) {
        if (ch === '{') {
          braceDepth++;
          sawInterpolation = true;
        } else if (ch === '}' && braceDepth > 0) {
          braceDepth--;
        }
      }

      value += this.advance();
    }

    this.reportError(
      explicitF ? 'Unterminated f-string literal' : 'Unterminated string literal',
      `Add closing ${quote} quote.`
    );
  }

  private scanNumber(firstChar: string): void {
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
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      isFloat = true;
      this.advance();
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        this.advance();
      }
    }

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

    // Special syntax: `style { ... }` captures raw CSS directly (preserving #colors, units, :hover, etc.)
    if (lexeme === 'style' && this.lastSignificantTokenType !== TokenType.Dot) {
      let probe = this.current;
      while (probe < this.source.length) {
        const ch = this.source[probe];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
          probe++;
        } else {
          break;
        }
      }
      if (this.source[probe] === '{') {
        this.emitToken(TokenType.Style, lexeme, lexeme);
        this.scanStyleBlock();
        return;
      }
    }

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

  private scanStyleBlock(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else {
        break;
      }
    }

    if (this.peek() !== '{') return;

    const blockStartOffset = this.current;
    const blockStartLine = this.line;
    const blockStartColumn = this.column;
    this.advance(); // consume '{'

    const cssStartOffset = this.current;
    let cssEndOffset = this.current;
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const ch = this.peek();

      // CSS strings
      if (ch === '"' || ch === "'") {
        const q = this.advance();
        while (!this.isAtEnd()) {
          if (this.peek() === '\\') {
            this.advance();
            if (!this.isAtEnd()) this.advance();
            continue;
          }
          if (this.advance() === q) break;
        }
        cssEndOffset = this.current;
        continue;
      }

      // CSS comments /* ... */
      if (ch === '/' && this.peekNext() === '*') {
        this.advance();
        this.advance();
        while (!this.isAtEnd() && !(this.peek() === '*' && this.peekNext() === '/')) {
          this.advance();
        }
        if (!this.isAtEnd()) {
          this.advance();
          this.advance();
        }
        cssEndOffset = this.current;
        continue;
      }

      if (ch === '{') {
        depth++;
        this.advance();
        cssEndOffset = this.current;
        continue;
      }

      if (ch === '}') {
        depth--;
        if (depth === 0) {
          cssEndOffset = this.current;
          this.advance(); // consume closing '}'
          break;
        }
        this.advance();
        cssEndOffset = this.current;
        continue;
      }

      this.advance();
      cssEndOffset = this.current;
    }

    if (depth > 0) {
      this.tokenStartLine = blockStartLine;
      this.tokenStartColumn = blockStartColumn;
      this.reportError('Unterminated style { ... } block', "Add closing '}' for your CSS style block.");
    }

    const rawCss = this.dedentCssBlock(this.source.slice(cssStartOffset, cssEndOffset));
    this.atLineStart = false;
    this.lastSignificantTokenType = TokenType.StyleBlock;
    this.tokens.push(
      createToken(
        TokenType.StyleBlock,
        this.source.slice(blockStartOffset, this.current),
        rawCss,
        blockStartLine,
        blockStartColumn,
        blockStartOffset,
        this.current
      )
    );
  }

  private dedentCssBlock(raw: string): string {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length === 0) return '';
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const minIndent = Math.min(
      ...nonEmpty.map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0)
    );
    return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join('\n');
  }

  private emitToken(
    type: TokenType,
    lexeme = this.source.slice(this.start, this.current),
    literal: string | number | boolean | null = null
  ): void {
    if (type !== TokenType.Newline) {
      this.lastSignificantTokenType = type;
    }
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
