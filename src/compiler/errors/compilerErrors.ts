export type CompilerPhase =
  | 'lexer'
  | 'parser'
  | 'transformer'
  | 'optimizer'
  | 'generator'
  | 'runtime';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CompilerDiagnostic {
  phase: CompilerPhase;
  severity: DiagnosticSeverity;
  title?: string;
  message: string;
  line: number;
  column: number;
  hint?: string;
}

export function formatDiagnosticTitle(phase: CompilerPhase, customTitle?: string): string {
  if (customTitle) return customTitle;
  switch (phase) {
    case 'lexer':
      return 'Lexical Error';
    case 'parser':
      return 'Syntax Error';
    case 'transformer':
      return 'Semantic / Type Error';
    case 'optimizer':
      return 'Optimizer Notice';
    case 'generator':
      return 'Codegen Error';
    case 'runtime':
      return 'Runtime Error';
  }
}

export function formatDiagnosticWithCaret(
  diag: CompilerDiagnostic,
  source: string
): string {
  const lines = source.split('\n');
  const lineText = lines[Math.max(0, diag.line - 1)] ?? '';
  const col = Math.max(1, diag.column);
  const caretPad = ' '.repeat(Math.max(0, col - 1));
  const title = formatDiagnosticTitle(diag.phase, diag.title);

  const parts = [
    `${title}:`,
    diag.message,
    '',
    `Line ${diag.line}:`,
    lineText,
    `${caretPad}^`,
  ];

  if (diag.hint) {
    parts.push(`Hint: ${diag.hint}`);
  }
  return parts.join('\n');
}

export class EasyJSCompilerError extends Error {
  public readonly phase: CompilerPhase;
  public readonly line: number;
  public readonly column: number;
  public readonly hint?: string;
  public readonly title?: string;

  constructor(
    phase: CompilerPhase,
    message: string,
    line: number,
    column: number,
    hint?: string,
    title?: string
  ) {
    super(`[${phase}] (${line}:${column}) ${message}`);
    this.name = 'EasyJSCompilerError';
    this.phase = phase;
    this.line = line;
    this.column = column;
    this.hint = hint;
    this.title = title;
  }

  public toDiagnostic(severity: DiagnosticSeverity = 'error'): CompilerDiagnostic {
    return {
      phase: this.phase,
      severity,
      title: this.title,
      message: this.message.replace(/^\[[^\]]+\]\s*\(\d+:\d+\)\s*/, ''),
      line: this.line,
      column: this.column,
      hint: this.hint,
    };
  }
}

export class LexerError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super('lexer', message, line, column, hint, 'Syntax Error');
    this.name = 'LexerError';
  }
}

export class ParserError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super('parser', message, line, column, hint, 'Syntax Error');
    this.name = 'ParserError';
  }
}

export class TransformError extends EasyJSCompilerError {
  constructor(message: string, line: number, column: number, hint?: string, title?: string) {
    super('transformer', message, line, column, hint, title);
    this.name = 'TransformError';
  }
}

export class RuntimeRuleError extends EasyJSCompilerError {
  constructor(message: string, line = 0, column = 0, hint?: string) {
    super('runtime', message, line, column, hint, 'Ownership Rule Error');
    this.name = 'RuntimeRuleError';
  }
}
