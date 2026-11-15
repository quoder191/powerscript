import { ProgramNode } from './ast/nodes.ts';
import { CompilerDiagnostic } from './errors/compilerErrors.ts';
import { generate, GeneratorOptions } from './generator/generator.ts';
import { tokenize } from './lexer/lexer.ts';
import { Token } from './lexer/tokens.ts';
import { parse } from './parser/parser.ts';
import { PointerRecord, SymbolRecord, transform } from './transformer/transformer.ts';
import {
  executeCompiledJS,
  executeCompiledJSAsync,
  ExecuteAsyncOptions,
  ExecuteSyncOptions,
  ExecutionResult,
} from './utils/helpers.ts';

export interface CompileTimings {
  lexMs: number;
  parseMs: number;
  transformMs: number;
  generateMs: number;
  totalMs: number;
}

export interface CompileResult {
  success: boolean;
  tokens: Token[];
  ast: ProgramNode;
  transformedAst: ProgramNode;
  code: string;
  diagnostics: CompilerDiagnostic[];
  symbols: SymbolRecord[];
  pointers: PointerRecord[];
  asyncFunctions: string[];
  topLevelAsync: boolean;
  timings: CompileTimings;
}

export function compileEasyJS(
  source: string,
  options: GeneratorOptions = {}
): CompileResult {
  const totalStart = performance.now();

  const t0 = performance.now();
  const lexResult = tokenize(source);
  const lexMs = Number((performance.now() - t0).toFixed(2));

  const t1 = performance.now();
  const parseResult = parse(lexResult.tokens);
  const parseMs = Number((performance.now() - t1).toFixed(2));

  const t2 = performance.now();
  const transformResult = transform(parseResult.ast);
  const transformMs = Number((performance.now() - t2).toFixed(2));

  const diagnostics: CompilerDiagnostic[] = [
    ...lexResult.diagnostics,
    ...parseResult.diagnostics,
    ...transformResult.diagnostics,
  ];

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const t3 = performance.now();
  const code = hasErrors
    ? ''
    : generate(transformResult.ast, {
        ...options,
        asyncFunctions: transformResult.asyncFunctions,
        interactiveAsync:
          options.interactiveAsync ??
          (transformResult.topLevelAsync || transformResult.asyncFunctions.length > 0),
      });
  const generateMs = Number((performance.now() - t3).toFixed(2));

  const totalMs = Number((performance.now() - totalStart).toFixed(2));

  return {
    success: !hasErrors,
    tokens: lexResult.tokens,
    ast: parseResult.ast,
    transformedAst: transformResult.ast,
    code,
    diagnostics,
    symbols: transformResult.symbols,
    pointers: transformResult.pointers,
    asyncFunctions: transformResult.asyncFunctions,
    topLevelAsync: transformResult.topLevelAsync,
    timings: {
      lexMs,
      parseMs,
      transformMs,
      generateMs,
      totalMs,
    },
  };
}

export interface RunResult extends CompileResult {
  execution?: ExecutionResult;
}

export function runEasyJS(
  source: string,
  options: ExecuteSyncOptions = {}
): RunResult {
  const compiled = compileEasyJS(source, { interactiveAsync: false });
  if (!compiled.success) {
    return compiled;
  }
  const execution = executeCompiledJS(compiled.code, options);
  return {
    ...compiled,
    execution,
  };
}

export async function runEasyJSAsync(
  source: string,
  options: ExecuteAsyncOptions = {}
): Promise<RunResult> {
  const compiled = compileEasyJS(source, { interactiveAsync: true });
  if (!compiled.success) {
    return compiled;
  }
  const execution = await executeCompiledJSAsync(compiled.code, options);
  return {
    ...compiled,
    execution,
  };
}

export * from './ast/nodes.ts';
export * from './errors/compilerErrors.ts';
export * from './generator/generator.ts';
export * from './lexer/keywords.ts';
export * from './lexer/lexer.ts';
export * from './lexer/tokens.ts';
export * from './parser/parser.ts';
export * from './transformer/transformer.ts';
export * from './utils/helpers.ts';
