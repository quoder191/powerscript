
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
  CapabilitySecurityManager,
} from './capability-security.ts';

import {
  SecurityPolicyManager,
  type PartialCompilerSecurityPolicy,
} from './security-policy.ts';

import {
  TypeChecker,
} from './type-checker.ts';

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

export interface SecurityVerdict {
  approved: boolean;
  analysisComplete: boolean;
  blockedCount: number;
  blockedReasons: string[];
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

  security?: SecurityAnalyzerResult | null;

  securityVerdict: SecurityVerdict;
}

// ==========================================
// COMPILER OPTIONS
// ==========================================

export interface CompileOptions extends GeneratorOptions {
  optimize?: OptimizeOptions | false;
  securityPolicy?: PartialCompilerSecurityPolicy;
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
  // PHASE 5: STATIC TYPE CHECKER & DIAGNOSTICS
  // ========================================

  const policyManager = new SecurityPolicyManager(options.securityPolicy);

  const diagnostics: CompilerDiagnostic[] = [

    ...lexResult.diagnostics,

    ...parseResult.diagnostics,

    ...transformResult.diagnostics,

  ];

  const hasLexOrParseErrors =
    lexResult.diagnostics.some((d) => d.severity === 'error') ||
    parseResult.diagnostics.some((d) => d.severity === 'error');

  const hasParseOrTransformErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error'
  );

  if (!hasLexOrParseErrors) {
    const typeChecker = new TypeChecker(policyManager.policy.typeSafety);
    const typeResult = typeChecker.check(transformResult.ast);
    for (const td of typeResult.diagnostics) {
      const isDup = diagnostics.some(
        (existing) =>
          existing.line === td.line &&
          existing.message === td.message
      );
      if (!isDup) {
        diagnostics.push(td);
      }
    }
  }

  // ========================================
  // PHASE 6: FAIL-CLOSED SECURITY & CAPABILITY ANALYSIS
  // ========================================

  const securityStart = performance.now();

  let securityResult: SecurityAnalyzerResult | null = null;
  let securityAnalysisComplete = false;

  if (!hasLexOrParseErrors) {

    const securityAnalyzer = new SecurityAnalyzer({
      stopOnFirstError: false,
      policy: policyManager.policy.ownership,
    });

    securityResult = securityAnalyzer.analyze(
      transformResult.ast
    );

    const capabilityManager = new CapabilitySecurityManager(
      options.securityPolicy
    );
    const capabilityResult = capabilityManager.analyze(
      transformResult.ast
    );

    securityAnalysisComplete =
      securityResult.analysisComplete && capabilityResult.analysisComplete;

    const mergedSecurityDiagnostics = [
      ...securityResult.diagnostics,
      ...capabilityResult.diagnostics,
    ];
    const combinedSecurity: SecurityAnalyzerResult = {
      success:
        securityResult.success &&
        capabilityResult.success &&
        securityAnalysisComplete,
      diagnostics: mergedSecurityDiagnostics,
      errorCount: securityResult.errorCount + capabilityResult.errorCount,
      warningCount: securityResult.warningCount + capabilityResult.warningCount,
      analysisComplete: securityAnalysisComplete,
      incompleteReasons: [...securityResult.incompleteReasons],
    };
    securityResult = combinedSecurity;

    diagnostics.push(
      ...convertSecurityDiagnostics(combinedSecurity)
    );

    if (!securityAnalysisComplete) {
      const alreadyHasSec000 = diagnostics.some(
        (d) => d.severity === 'error' && d.title === 'Security SEC000'
      );
      if (!alreadyHasSec000) {
        diagnostics.push({
          phase: 'transformer',
          severity: 'error',
          title: 'Security SEC000',
          message:
            'Incomplete Security Analysis: Compilation blocked because the security analyzer could not completely verify the program.',
          line: 1,
          column: 1,
          hint: 'Execution is denied whenever security analysis is incomplete (fail-closed policy).',
        });
      }
    }
  }

  const securityMs = Number(
    (performance.now() - securityStart).toFixed(2)
  );

  // ========================================
  // PHASE 7: COMPILATION VALIDATION
  // ========================================

  const errorDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const securityApproved =
    !hasParseOrTransformErrors &&
    securityAnalysisComplete &&
    Boolean(securityResult?.success) &&
    errorDiagnostics.length === 0;
  const hasErrors = errorDiagnostics.length > 0 || !securityApproved;

  const securityVerdict: SecurityVerdict = {
    approved: securityApproved,
    analysisComplete: securityAnalysisComplete,
    blockedCount: errorDiagnostics.length,
    blockedReasons: errorDiagnostics.map((d) => `${d.title}: ${d.message}`),
  };

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

    securityVerdict,

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
    { interactiveAsync: false, securityPolicy: options.securityPolicy }
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
    { interactiveAsync: true, securityPolicy: options.securityPolicy }
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
    { optimize: false, securityPolicy: options.securityPolicy }
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
  SandboxBuilderEngine,
  SANDBOX_SHADOWED_GLOBALS,
  buildBrowserSandboxDocument,
  buildLexicallyIsolatedInvocation,
  escapeInlineScriptTag,
  type BrowserSandboxDocumentOptions,
  type LexicalIsolationBuildOptions,
} from './builder-engine.ts';

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
export { TypeChecker, type TypeCheckResult } from './type-checker.ts';

export {
  OwnerState,
  OwnerKind,
  BorrowKind,
  DiagnosticSeverity as SecurityDiagnosticSeverity,
  DEFAULT_SECURITY_POLICY,
  DEFAULT_SECURITY_POLICY as SECURITY_POLICY_DEFAULT,
  DiagnosticBag,
  OwnershipModel,
  BorrowChecker,
  PowerScriptSecurityEngine,
  SecurityPolicyManager,
  NetworkPolicyManager,
  CapabilitySecurityManager,
  isPrivateOrLoopbackHost,
  isPrivateOrReservedIp,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  DEFAULT_COMPILER_SECURITY_POLICY,
  DEFAULT_NETWORK_SECURITY_POLICY,
  DEFAULT_GLOBAL_ACCESS_POLICY,
  DEFAULT_TYPE_SAFETY_POLICY,
  DEFAULT_BLOCKED_HEADERS,
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
  GlobalThisPolicyMode,
  NetworkSecurityPolicy,
  GlobalAccessPolicy,
  TypeSafetyPolicy,
  CompilerSecurityPolicy,
  PartialCompilerSecurityPolicy,
  FetchValidationResult,
  CapabilitySecurityResult,
} from './security-index.ts';
  
