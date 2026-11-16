import { ProgramNode, StatementNode } from './ast/nodes.ts';
import { CompilerDiagnostic } from './errors/compilerErrors.ts';
import {
  generateWithSourceMap,
  GeneratorOptions,
  SourceMapping,
} from './generator/generator.ts';
import { ASTInterpreter, DebugSnapshot, DebuggerStatus, InterpreterOptions, runASTInterpreter } from './interpreter/interpreter.ts';
import { tokenize } from './lexer/lexer.ts';
import { Token } from './lexer/tokens.ts';
import {
  OptimizationReport,
  optimizeAST,
  OptimizeOptions,
} from './optimizer/optimizer.ts';
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
  optimizeMs: number;
  generateMs: number;
  totalMs: number;
}

export interface IncrementalStats {
  cachedStatements: number;
  recompiledStatements: number;
  totalStatements: number;
}

export interface CompileResult {
  success: boolean;
  tokens: Token[];
  ast: ProgramNode;
  transformedAst: ProgramNode;
  optimizedAst: ProgramNode;
  code: string;
  sourceMap: SourceMapping[];
  diagnostics: CompilerDiagnostic[];
  symbols: SymbolRecord[];
  pointers: PointerRecord[];
  asyncFunctions: string[];
  topLevelAsync: boolean;
  optimization: OptimizationReport;
  incremental: IncrementalStats;
  timings: CompileTimings;
}

export interface CompileOptions extends GeneratorOptions {
  optimize?: OptimizeOptions | false;
}

// Incremental statement-level AST cache across edits
const statementAstCache = new Map<string, StatementNode>();
let lastSourceLines: string[] = [];

function getStatementSliceKey(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join('\n');
}

export function compileEasyJS(
  source: string,
  options: CompileOptions = {}
): CompileResult {
  const totalStart = performance.now();

  const t0 = performance.now();
  const lexResult = tokenize(source);
  const lexMs = Number((performance.now() - t0).toFixed(2));

  const t1 = performance.now();
  const parseResult = parse(lexResult.tokens);
  const parseMs = Number((performance.now() - t1).toFixed(2));

  // Track incremental statement reuse for top-level declarations/statements
  const lines = source.split('\n');
  let cachedStatements = 0;
  let recompiledStatements = 0;
  const body = parseResult.ast.body;
  for (let i = 0; i < body.length; i++) {
    const stmt = body[i];
    const nextLine = i + 1 < body.length ? body[i + 1].line - 1 : lines.length;
    const key = getStatementSliceKey(lines, stmt.line, Math.max(stmt.line, nextLine));
    if (statementAstCache.has(key) && lastSourceLines.length > 0) {
      cachedStatements++;
    } else {
      recompiledStatements++;
      statementAstCache.set(key, stmt);
    }
  }
  if (statementAstCache.size > 500) {
    statementAstCache.clear();
  }
  lastSourceLines = lines;

  const t2 = performance.now();
  const transformResult = transform(parseResult.ast);
  const transformMs = Number((performance.now() - t2).toFixed(2));

  const diagnostics: CompilerDiagnostic[] = [
    ...lexResult.diagnostics,
    ...parseResult.diagnostics,
    ...transformResult.diagnostics,
  ];

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const tOpt = performance.now();
  const optResult =
    options.optimize === false || hasErrors
      ? {
          ast: transformResult.ast,
          report: {
            foldedConstants: 0,
            eliminatedBranches: 0,
            removedDeadStatements: 0,
            shakenFunctions: [],
          },
        }
      : optimizeAST(transformResult.ast, options.optimize);
  const optimizeMs = Number((performance.now() - tOpt).toFixed(2));

  const t3 = performance.now();
  const genOut = hasErrors
    ? { code: '', sourceMap: [] }
    : generateWithSourceMap(optResult.ast, {
        ...options,
        asyncFunctions: transformResult.asyncFunctions,
        refFunctionParams: transformResult.refFunctionParams,
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
    optimizedAst: optResult.ast,
    code: genOut.code,
    sourceMap: genOut.sourceMap,
    diagnostics,
    symbols: transformResult.symbols,
    pointers: transformResult.pointers,
    asyncFunctions: transformResult.asyncFunctions,
    topLevelAsync: transformResult.topLevelAsync,
    optimization: optResult.report,
    incremental: {
      cachedStatements,
      recompiledStatements,
      totalStatements: body.length,
    },
    timings: {
      lexMs,
      parseMs,
      transformMs,
      optimizeMs,
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

export async function runEasyJSInterpreted(
  source: string,
  options: InterpreterOptions = {}
): Promise<RunResult> {
  const compiled = compileEasyJS(source, { optimize: false });
  if (!compiled.success) {
    return compiled;
  }
  const execution = await runASTInterpreter(compiled.transformedAst, options);
  return {
    ...compiled,
    execution,
  };
}

export function createEasyJSDebugger(
  source: string,
  options: InterpreterOptions = {}
): { compileResult: CompileResult; debuggerInstance: ASTInterpreter | null } {
  const compileResult = compileEasyJS(source, { optimize: false });
  if (!compileResult.success) {
    return { compileResult, debuggerInstance: null };
  }
  const debuggerInstance = new ASTInterpreter(options);
  return { compileResult, debuggerInstance };
}

export { formatEasyJS } from './formatter.ts';
export { ASTInterpreter, type DebugSnapshot, type DebuggerStatus, type InterpreterOptions };
export * from './ast/nodes.ts';
export * from './errors/compilerErrors.ts';
export * from './generator/generator.ts';
export * from './lexer/keywords.ts';
export * from './lexer/lexer.ts';
export * from './lexer/tokens.ts';
export * from './optimizer/optimizer.ts';
export * from './parser/parser.ts';
export * from './transformer/transformer.ts';
export * from './utils/helpers.ts';
