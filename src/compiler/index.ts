
import type {
  ProgramNode,
  StatementNode,
} from './ast/nodes.ts';

import type {
  CompilerDiagnostic,
} from './errors/compilerErrors.ts';

import {
  generateWithSourceMap,
  type GeneratorOptions,
  type SourceMapping,
} from './generator/generator.ts';

import {
  ASTInterpreter,
  type DebugSnapshot,
  type DebuggerStatus,
  type InterpreterOptions,
  runASTInterpreter,
} from './interpreter/interpreter.ts';

import { tokenize } from './lexer/lexer.ts';
import type { Token } from './lexer/tokens.ts';

import {
  optimizeAST,
  type OptimizationReport,
  type OptimizeOptions,
} from './optimizer/optimizer.ts';

import { parse } from './parser/parser.ts';

import {
  transform,
  type PointerRecord,
  type SymbolRecord,
} from './transformer/transformer.ts';

import {
  executeCompiledJS,
  executeCompiledJSAsync,
  type ExecuteAsyncOptions,
  type ExecuteSyncOptions,
  type ExecutionResult,
} from './utils/helpers.ts';

// ==========================================
// SECURITY ENGINE INTEGRATION
// ==========================================

import {
  SecurityAnalyzer,
} from './security-analyzer.ts';

import {
  DiagnosticSeverity as SecurityDiagnosticSeverity,
} from './types.ts';

import type {
  SecurityAnalyzerResult,
} from './security-analyzer.ts';

// ==========================================
// COMPILER TIMINGS
// ==========================================

export interface CompileTimings {
  lexMs: number;
  parseMs: number;
  transformMs: number;
  securityMs: number;
  optimizeMs: number;
  generateMs: number;
  totalMs: number;
}

// ==========================================
// INCREMENTAL COMPILATION
// ==========================================

export interface IncrementalStats {
  cachedStatements: number;
  recompiledStatements: number;
  totalStatements: number;
}

// ==========================================
// COMPILATION RESULT
// ==========================================

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

  security?: SecurityAnalyzerResult | null;
}

// ==========================================
// COMPILER OPTIONS
// ==========================================

export interface CompileOptions extends GeneratorOptions {
  optimize?: OptimizeOptions | false;
}

// ==========================================
// INCREMENTAL CACHE
// ==========================================

const statementAstCache = new Map<string, StatementNode>();

let lastSourceLines: string[] = [];

function getStatementSliceKey(
  lines: string[],
  startLine: number,
  endLine: number
): string {

  return lines
    .slice(startLine - 1, endLine)
    .join('\n');
}

// ==========================================
// SECURITY DIAGNOSTIC CONVERTER
// ==========================================

function convertSecurityDiagnostics(
  result: SecurityAnalyzerResult
): CompilerDiagnostic[] {

  return result.diagnostics.map((diagnostic) => {

    let severity: 'error' | 'warning' | 'info';

    switch (diagnostic.severity) {

      case SecurityDiagnosticSeverity.ERROR:
        severity = 'error';
        break;

      case SecurityDiagnosticSeverity.WARNING:
        severity = 'warning';
        break;

      default:
        severity = 'info';
    }

    return {
      phase: 'transformer' as const,
      severity,
      title: `Security ${diagnostic.code}`,
      message: diagnostic.message,
      line: diagnostic.location?.line ?? 1,
      column: diagnostic.location?.column ?? 1,
      hint: diagnostic.suggestion,
    };
  });
}

// ==========================================
// MAIN COMPILER
// ==========================================

export function compileEasyJS(
  source: string,
  options: CompileOptions = {}
): CompileResult {

  const totalStart = performance.now();

  // ========================================
  // PHASE 1: LEXER
  // ========================================

  const t0 = performance.now();

  const lexResult = tokenize(source);

  const lexMs = Number(
    (performance.now() - t0).toFixed(2)
  );

  // ========================================
  // PHASE 2: PARSER
  // ========================================

  const t1 = performance.now();

  const parseResult = parse(lexResult.tokens);

  const parseMs = Number(
    (performance.now() - t1).toFixed(2)
  );

  // ========================================
  // PHASE 3: INCREMENTAL CACHE
  // ========================================

  const lines = source.split('\n');

  let cachedStatements = 0;
  let recompiledStatements = 0;

  const body = parseResult.ast.body;

  for (let i = 0; i < body.length; i++) {

    const stmt = body[i];

    const nextLine =
      i + 1 < body.length
        ? body[i + 1].line - 1
        : lines.length;

    const key = getStatementSliceKey(
      lines,
      stmt.line,
      Math.max(stmt.line, nextLine)
    );

    if (
      statementAstCache.has(key) &&
      lastSourceLines.length > 0
    ) {

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

  // ========================================
  // PHASE 4: TRANSFORMER
  // ========================================

  const t2 = performance.now();

  const transformResult = transform(parseResult.ast);

  const transformMs = Number(
    (performance.now() - t2).toFixed(2)
  );

  // ========================================
  // PHASE 5: INITIAL DIAGNOSTICS
  // ========================================

  const diagnostics: CompilerDiagnostic[] = [

    ...lexResult.diagnostics,

    ...parseResult.diagnostics,

    ...transformResult.diagnostics,

  ];

  const previousErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error'
  );

  // ========================================
  // PHASE 6: SECURITY ANALYSIS
  // ========================================

  const securityStart = performance.now();

  let securityResult: SecurityAnalyzerResult | null = null;

  if (!previousErrors) {

    const securityAnalyzer = new SecurityAnalyzer({
      stopOnFirstError: false,
    });

    securityResult = securityAnalyzer.analyze(
      transformResult.ast
    );

    // Convert security diagnostics into
    // compiler-compatible diagnostics.

    diagnostics.push(
      ...convertSecurityDiagnostics(securityResult)
    );

    // Report any remaining non-fatal incomplete analysis note as info only
    // so normal programs are never blocked by control-flow heuristics.
    if (!securityResult.analysisComplete) {
      diagnostics.push({
        phase: 'transformer',
        severity: 'info',
        title: 'Security Analysis Note',
        message:
          'Security analyzer skipped partial control-flow verification for dynamic constructs.',
        line: 1,
        column: 1,
      });
    }
  }

  const securityMs = Number(
    (performance.now() - securityStart).toFixed(2)
  );

  // ========================================
  // PHASE 7: COMPILATION VALIDATION
  // ========================================

  const hasErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error'
  );

  // ========================================
  // PHASE 8: OPTIMIZER
  // ========================================

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

      : optimizeAST(
          transformResult.ast,
          options.optimize
        );

  const optimizeMs = Number(
    (performance.now() - tOpt).toFixed(2)
  );

  // ========================================
  // PHASE 9: JAVASCRIPT GENERATOR
  // ========================================

  const t3 = performance.now();

  const genOut = hasErrors

    ? {

        code: '',

        sourceMap: [],

      }

    : generateWithSourceMap(

        optResult.ast,

        {

          ...options,

          asyncFunctions:
            transformResult.asyncFunctions,

          refFunctionParams:
            transformResult.refFunctionParams,

          interactiveAsync:

            options.interactiveAsync ??

            (
              transformResult.topLevelAsync ||
              transformResult.asyncFunctions.length > 0
            ),

        }
      );

  const generateMs = Number(
    (performance.now() - t3).toFixed(2)
  );

  // ========================================
  // PHASE 10: FINAL TIMINGS
  // ========================================

  const totalMs = Number(
    (performance.now() - totalStart).toFixed(2)
  );

  // ========================================
  // FINAL COMPILER RESULT
  // ========================================

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

      securityMs,

      optimizeMs,

      generateMs,

      totalMs,

    },

    security: securityResult,

  };
}

// ==========================================
// EXECUTION RESULT
// ==========================================

export interface RunResult extends CompileResult {
  execution?: ExecutionResult;
}

// ==========================================
// SYNCHRONOUS EXECUTION
// ==========================================

export function runEasyJS(
  source: string,
  options: ExecuteSyncOptions = {}
): RunResult {

  const compiled = compileEasyJS(
    source,
    { interactiveAsync: false }
  );

  if (!compiled.success) {
    return compiled;
  }

  const execution = executeCompiledJS(
    compiled.code,
    options
  );

  return {
    ...compiled,
    execution,
  };
}

// ==========================================
// ASYNCHRONOUS EXECUTION
// ==========================================

export async function runEasyJSAsync(
  source: string,
  options: ExecuteAsyncOptions = {}
): Promise<RunResult> {

  const compiled = compileEasyJS(
    source,
    { interactiveAsync: true }
  );

  if (!compiled.success) {
    return compiled;
  }

  const execution = await executeCompiledJSAsync(
    compiled.code,
    options
  );

  return {
    ...compiled,
    execution,
  };
}

// ==========================================
// AST INTERPRETER
// ==========================================

export async function runEasyJSInterpreted(
  source: string,
  options: InterpreterOptions = {}
): Promise<RunResult> {

  const compiled = compileEasyJS(
    source,
    { optimize: false }
  );

  if (!compiled.success) {
    return compiled;
  }

  const execution = await runASTInterpreter(
    compiled.transformedAst,
    options
  );

  return {
    ...compiled,
    execution,
  };
}

// ==========================================
// DEBUGGER
// ==========================================

export function createEasyJSDebugger(
  source: string,
  options: InterpreterOptions = {}
): {
  compileResult: CompileResult;
  debuggerInstance: ASTInterpreter | null;
} {

  const compileResult = compileEasyJS(
    source,
    { optimize: false }
  );

  if (!compileResult.success) {

    return {
      compileResult,
      debuggerInstance: null,
    };
  }

  const debuggerInstance = new ASTInterpreter(options);

  return {
    compileResult,
    debuggerInstance,
  };
}

// ==========================================
// PUBLIC API EXPORTS
// ==========================================

export { formatEasyJS } from './formatter.ts';
export { disposeActiveBrowserSandbox } from './utils/helpers.ts';

export {
  ASTInterpreter,
  type DebugSnapshot,
  type DebuggerStatus,
  type InterpreterOptions,
};

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

// Security API

export { SecurityAnalyzer };

export {
  OwnerState,
  BorrowKind,
  DiagnosticSeverity as SecurityDiagnosticSeverity,
  DEFAULT_SECURITY_POLICY,
  DiagnosticBag,
  OwnershipModel,
  BorrowChecker,
  PowerScriptSecurityEngine,
} from './security-index.ts';

export type {
  SourceLocation,
  SecurityDiagnostic,
  OwnerRecord,
  BorrowRecord,
  SecurityPolicy,
  SecurityAnalysisResult,
  SecurityOperation,
  SecurityOperationType,
} from './security-index.ts';
  
