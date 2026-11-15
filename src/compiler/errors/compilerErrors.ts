export type CompilerPhase = 'lexer' | 'parser' | 'transformer' | 'generator' | 'runtime';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CompilerDiagnostic {
  phase: CompilerPhase;
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  hint?: string;
}

export class EasyJSCompilerError extends Error {
  public readonly phase: CompilerPhase;
  public readonly line: number;
  public readonly column: number;
  public readonly hint?: string;

  constructor(
    phase: CompilerPhase,
    message: string,
    line: number,
    column: number,
    hint?: string
  ) {
    super(`[${phase}] (${line}:${column}) ${message}`);
    this.name = 'EasyJSCompilerError';
    this.phase = phase;
    this.line = line;
    this.column = column;
    this.hint = hint;
  }

  public toDiagnostic(severity: DiagnosticSeverity = 'error'): CompilerDiagnostic {
    return {
      phase: this.phase,
      severity,
      message: this.message.replace(/^\[[^\]]+\]\s*\(\d+:\d+\)\s*/, ''),
      line: this.line,
      column: this.column,
      hint: this.hint,
    };
  }
}

export class LexerError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super('lexer', message, line, column, hint);
    this.name = 'LexerError';
  }
}

export class ParserError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super('parser', message, line, column, hint);
    this.name = 'ParserError';
  }
}

export class TransformError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super('transformer', message, line, column, hint);
    this.name = 'TransformError';
  }
}

export class RuntimeRuleError extends EasyJSCompilerError {
  constructor(message: string, line = 0, column = 0, hint?: string) {
    super('runtime', message, line, column, hint);
    this.name = 'RuntimeRuleError';
  }
}
