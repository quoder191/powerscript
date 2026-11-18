/**
 * PowerScript / EasyJS Capability Security Manager & Code Integrity Analyzer
 *
 * Enforces compile-time security policies for:
 * - globalThis policy (disabled / readonly / sandboxed)
 * - Host-escape & dynamic-code-eval blocking (eval, Function, process, require, window, document, cookieStore)
 * - Prototype pollution & constructor gadget blocking (__proto__, constructor, prototype)
 * - Bounded fetch() & HTTP policy validation (cookies, credentials, SSRF/local IPs, HTTP methods)
 */

import type {
  BlockStatementNode,
  CallExpressionNode,
  ExpressionNode,
  MapLiteralNode,
  ProgramNode,
  StatementNode,
} from './ast/nodes.ts';
import { DiagnosticSeverity, type SecurityDiagnostic } from './types.ts';
import {
  NetworkPolicyManager,
  SecurityPolicyManager,
  type CompilerSecurityPolicy,
  type PartialCompilerSecurityPolicy,
} from './security-policy.ts';

const MAX_CAPABILITY_DEPTH = 200;
const MAX_CAPABILITY_NODES = 25000;

const HOST_ESCAPE_GLOBALS = new Set([
  'window',
  'document',
  'self',
  'top',
  'parent',
  'frames',
  'opener',
  'navigator',
  'history',
  'localStorage',
  'sessionStorage',
  'caches',
  'cookieStore',
  'indexedDB',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'EventSource',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'importScripts',
  'process',
  'require',
  'module',
  'exports',
  'global',
  'Buffer',
  'Deno',
  'Bun',
  'Proxy',
  'Reflect',
  'WebAssembly',
  'SharedArrayBuffer',
  'Atomics',
  'WeakRef',
  'FinalizationRegistry',
  'AsyncFunction',
  'GeneratorFunction',
  'AsyncGeneratorFunction',
  'ActiveXObject',
  'WScript',
]);

const DYNAMIC_EVAL_GLOBALS = new Set(['eval', 'Function']);

const BLOCKED_PROTOTYPE_PROPS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const BLOCKED_OBJECT_REFLECT_METHODS = new Set([
  'setPrototypeOf',
  'getPrototypeOf',
  'defineProperty',
  'defineProperties',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getOwnPropertyNames',
  'getOwnPropertySymbols',
]);

const SENSITIVE_INDEX_BASES = new Set([
  'Object',
  'Array',
  'Function',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Error',
  'RegExp',
  'Map',
  'Set',
  'globalThis',
  'window',
  'process',
  'Reflect',
  'Proxy',
]);

export interface CapabilitySecurityResult {
  success: boolean;
  analysisComplete: boolean;
  diagnostics: SecurityDiagnostic[];
  errorCount: number;
  warningCount: number;
}

export class CapabilitySecurityManager {
  private readonly policy: CompilerSecurityPolicy;
  private readonly networkManager: NetworkPolicyManager;
  private readonly diagnostics: SecurityDiagnostic[] = [];
  private readonly scopes: Array<Set<string>> = [];
  private analysisComplete = true;
  private depth = 0;
  private nodeCount = 0;

  constructor(policyOverrides?: PartialCompilerSecurityPolicy) {
    const manager = new SecurityPolicyManager(policyOverrides);
    this.policy = manager.policy;
    this.networkManager = manager.getNetworkManager();
  }

  private failClosed(reason: string, line = 1, column = 1): void {
    this.analysisComplete = false;
    this.error(
      'SEC000',
      `Incomplete Capability Security Analysis: ${reason}`,
      line,
      column,
      'Execution is blocked because capability verification could not complete.'
    );
  }

  analyze(program: ProgramNode): CapabilitySecurityResult {
    this.diagnostics.length = 0;
    this.scopes.length = 0;
    this.analysisComplete = true;
    this.depth = 0;
    this.nodeCount = 0;

    try {
      if (!program || !Array.isArray(program.body)) {
        this.failClosed('Program AST is malformed or missing body.');
      } else {
        this.pushScope();
        for (const stmt of program.body) {
          this.preDeclareStatement(stmt);
        }
        this.visitStatements(program.body);
        this.popScope();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failClosed(`Internal capability analyzer error: ${msg}`);
    }

    const errorCount = this.diagnostics.filter(
      (d) => d.severity === DiagnosticSeverity.ERROR
    ).length;
    const warningCount = this.diagnostics.filter(
      (d) => d.severity === DiagnosticSeverity.WARNING
    ).length;

    return {
      success: errorCount === 0 && this.analysisComplete,
      analysisComplete: this.analysisComplete,
      diagnostics: [...this.diagnostics],
      errorCount,
      warningCount,
    };
  }

  private pushScope(): void {
    this.scopes.push(new Set());
  }

  private popScope(): void {
    if (this.scopes.length > 0) {
      this.scopes.pop();
    }
  }

  private declare(name: string): void {
    const top = this.scopes[this.scopes.length - 1];
    if (top) {
      top.add(name);
    }
  }

  private isDeclared(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return true;
      }
    }
    return false;
  }

  private error(
    code: string,
    message: string,
    line: number,
    column: number,
    suggestion?: string
  ): void {
    this.diagnostics.push({
      code,
      message,
      severity: DiagnosticSeverity.ERROR,
      location: { line, column },
      suggestion,
    });
  }

  private preDeclareStatement(stmt: StatementNode): void {
    switch (stmt.kind) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
      case 'StructDeclaration':
      case 'EnumDeclaration':
      case 'TraitDeclaration':
        this.declare(stmt.name);
        break;
      case 'ImportStatement':
        if (stmt.defaultImport) this.declare(stmt.defaultImport);
        if (stmt.alias) this.declare(stmt.alias);
        for (const n of stmt.namedImports) this.declare(n);
        break;
      default:
        break;
    }
  }

  private visitStatements(statements: StatementNode[]): void {
    for (const stmt of statements) {
      this.visitStatement(stmt);
    }
  }

  private visitBlock(block: BlockStatementNode): void {
    this.pushScope();
    for (const s of block.statements) {
      this.preDeclareStatement(s);
    }
    this.visitStatements(block.statements);
    this.popScope();
  }

  private visitStatement(stmt: StatementNode): void {
    if (!this.analysisComplete) return;
    this.depth++;
    this.nodeCount++;
    if (this.depth > MAX_CAPABILITY_DEPTH || this.nodeCount > MAX_CAPABILITY_NODES) {
      this.failClosed('AST complexity limit exceeded during capability security check.', stmt.line, stmt.column);
      this.depth--;
      return;
    }
    try {
    switch (stmt.kind) {
      case 'VarDeclaration':
        if (stmt.initializer) {
          this.visitExpression(stmt.initializer);
        }
        if (stmt.name === 'globalThis' && this.policy.globals.globalThisMode !== 'sandboxed') {
          this.error(
            'SEC101',
            `Declaring or shadowing 'globalThis' is blocked by security policy (mode: '${this.policy.globals.globalThisMode}').`,
            stmt.line,
            stmt.column,
            "Choose a different variable name or set globals.globalThisMode to 'sandboxed'."
          );
        }
        this.declare(stmt.name);
        break;

      case 'MultiVarDeclaration':
        for (const d of stmt.declarations) {
          this.visitStatement(d);
        }
        break;

      case 'FunctionDeclaration':
        this.declare(stmt.name);
        this.pushScope();
        for (const p of stmt.params) {
          if (p.defaultValue) this.visitExpression(p.defaultValue);
          this.declare(p.name);
        }
        this.visitBlock(stmt.body);
        this.popScope();
        break;

      case 'ClassDeclaration':
        this.declare(stmt.name);
        for (const f of stmt.fields) {
          if (f.initializer) this.visitExpression(f.initializer);
        }
        for (const m of stmt.methods) {
          this.pushScope();
          for (const p of m.params) {
            if (p.defaultValue) this.visitExpression(p.defaultValue);
            this.declare(p.name);
          }
          this.visitBlock(m.body);
          this.popScope();
        }
        break;

      case 'StructDeclaration':
        this.declare(stmt.name);
        for (const f of stmt.fields) {
          if (f.defaultValue) this.visitExpression(f.defaultValue);
        }
        for (const m of stmt.methods) {
          this.pushScope();
          for (const p of m.params) {
            if (p.defaultValue) this.visitExpression(p.defaultValue);
            this.declare(p.name);
          }
          this.visitBlock(m.body);
          this.popScope();
        }
        break;

      case 'BlockStatement':
        this.visitBlock(stmt);
        break;

      case 'ScopeStatement':
        this.visitBlock(stmt.body);
        break;

      case 'IfStatement':
        this.visitExpression(stmt.condition);
        this.visitBlock(stmt.consequent);
        for (const elif of stmt.elifBranches) {
          this.visitExpression(elif.condition);
          this.visitBlock(elif.consequent);
        }
        if (stmt.alternate) {
          this.visitBlock(stmt.alternate);
        }
        break;

      case 'ForInStatement':
        this.visitExpression(stmt.iterable);
        this.pushScope();
        this.declare(stmt.variable);
        this.visitBlock(stmt.body);
        this.popScope();
        break;

      case 'CForStatement':
        this.pushScope();
        if (stmt.init) this.visitStatement(stmt.init);
        if (stmt.condition) this.visitExpression(stmt.condition);
        if (stmt.update) this.visitExpression(stmt.update);
        this.visitBlock(stmt.body);
        this.popScope();
        break;

      case 'WhileStatement':
        this.visitExpression(stmt.condition);
        this.visitBlock(stmt.body);
        break;

      case 'DoWhileStatement':
        this.visitBlock(stmt.body);
        this.visitExpression(stmt.condition);
        break;

      case 'LoopStatement':
        this.visitBlock(stmt.body);
        break;

      case 'RepeatStatement':
        this.visitExpression(stmt.count);
        this.visitBlock(stmt.body);
        break;

      case 'ReturnStatement':
      case 'ThrowStatement':
        if (stmt.value) this.visitExpression(stmt.value);
        break;

      case 'TryCatchStatement':
        this.visitBlock(stmt.tryBlock);
        this.pushScope();
        if (stmt.catchVar) this.declare(stmt.catchVar);
        this.visitBlock(stmt.catchBlock);
        this.popScope();
        break;

      case 'DeferStatement':
        this.visitStatement(stmt.statement);
        break;

      case 'DropStatement':
        this.visitExpression(stmt.target);
        break;

      case 'ExpressionStatement':
        this.visitExpression(stmt.expression);
        break;

      case 'ImportStatement':
      case 'EnumDeclaration':
      case 'TraitDeclaration':
      case 'StyleStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        break;

      default: {
        const unknown = stmt as unknown as { kind?: string; line?: number; column?: number };
        this.failClosed(
          `Unsupported statement node '${unknown.kind ?? 'unknown'}'.`,
          unknown.line ?? 1,
          unknown.column ?? 1
        );
        break;
      }
    }
    } finally {
      this.depth--;
    }
  }

  private isGlobalThisRoot(expr: ExpressionNode): boolean {
    if (expr.kind === 'Identifier' && expr.name === 'globalThis') {
      return true;
    }
    if (expr.kind === 'MemberExpression') {
      return this.isGlobalThisRoot(expr.object);
    }
    if (expr.kind === 'IndexExpression') {
      return this.isGlobalThisRoot(expr.object);
    }
    return false;
  }

  private extractLiteralObject(map: MapLiteralNode): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of map.entries) {
      let keyStr: string | null = null;
      if (entry.key.kind === 'Literal' && typeof entry.key.value === 'string') {
        keyStr = entry.key.value;
      } else if (entry.key.kind === 'Identifier') {
        keyStr = entry.key.name;
      }
      if (!keyStr) continue;

      if (entry.value.kind === 'Literal') {
        out[keyStr] = entry.value.value;
      } else if (entry.value.kind === 'MapLiteral') {
        out[keyStr] = this.extractLiteralObject(entry.value);
      }
    }
    return out;
  }

  private validateStaticNetworkCall(call: CallExpressionNode): void {
    const isDirectFetch =
      call.callee.kind === 'Identifier' &&
      call.callee.name === 'fetch' &&
      !this.isDeclared('fetch');

    const isHttpMember =
      call.callee.kind === 'MemberExpression' &&
      call.callee.object.kind === 'Identifier' &&
      call.callee.object.name === 'http' &&
      !this.isDeclared('http');

    if (!isDirectFetch && !isHttpMember) return;

    const urlArg = call.args[0];
    const optsArg = call.args[1];

    let literalMethod: string | undefined;
    if (isHttpMember && call.callee.kind === 'MemberExpression') {
      literalMethod = call.callee.property.toUpperCase();
      if (!this.policy.network.allowedMethods.includes(literalMethod)) {
        this.error(
          'NET004',
          `HTTP method '${literalMethod}' via http.${call.callee.property}() is blocked by network security policy (allowed: ${this.policy.network.allowedMethods.join(', ')}).`,
          call.line,
          call.column,
          'Use read-only GET/HEAD requests or explicitly permit this method in NetworkSecurityPolicy.'
        );
      }
    }

    const literalOpts: Record<string, unknown> =
      optsArg && optsArg.kind === 'MapLiteral' ? this.extractLiteralObject(optsArg) : {};

    if (literalMethod && !literalOpts.method) {
      literalOpts.method = literalMethod;
    }

    if (urlArg && urlArg.kind === 'Literal' && typeof urlArg.value === 'string') {
      const check = this.networkManager.validateFetchCall(urlArg.value, literalOpts, false);
      if (!check.ok) {
        this.error(
          check.code,
          check.reason,
          call.line,
          call.column,
          'fetch() is restricted to public http/https URLs without cookies, credentials, or local/private network access.'
        );
      }
    } else if (Object.keys(literalOpts).length > 0) {
      // Still validate static options (credentials / Cookie header / disallowed method) even if URL is dynamic
      const check = this.networkManager.validateFetchCall(
        'https://example.com/',
        literalOpts,
        false
      );
      if (!check.ok) {
        this.error(
          check.code,
          check.reason,
          call.line,
          call.column,
          'Remove cookies, credentials, or disallowed methods from fetch() options.'
        );
      }
    }
  }

  private visitExpression(expr: ExpressionNode): void {
    if (!this.analysisComplete) return;
    this.depth++;
    this.nodeCount++;
    if (this.depth > MAX_CAPABILITY_DEPTH || this.nodeCount > MAX_CAPABILITY_NODES) {
      this.failClosed('AST complexity limit exceeded during expression capability check.', expr.line, expr.column);
      this.depth--;
      return;
    }
    try {
    switch (expr.kind) {
      case 'Identifier': {
        if (expr.name === '__ejs' || expr.name.startsWith('__ejs_')) {
          this.error(
            'SEC102',
            `Access to reserved internal runtime identifier '${expr.name}' is forbidden.`,
            expr.line,
            expr.column,
            'Identifiers beginning with __ejs_ are reserved for the isolated runtime prelude.'
          );
          return;
        }
        if (expr.name === 'globalThis') {
          if (this.policy.globals.globalThisMode === 'disabled') {
            this.error(
              'SEC101',
              `Access to 'globalThis' is disabled by security policy.`,
              expr.line,
              expr.column,
              "Enable 'globals.globalThisMode: \"readonly\" | \"sandboxed\"' in SecurityPolicy only if required."
            );
          }
          return;
        }

        if (!this.isDeclared(expr.name)) {
          if (this.policy.globals.forbidDynamicEval && DYNAMIC_EVAL_GLOBALS.has(expr.name)) {
            this.error(
              'SEC102',
              `Dynamic code execution '${expr.name}' is blocked by security policy.`,
              expr.line,
              expr.column,
              'Avoid dynamic eval/Function evaluation; write static functions instead.'
            );
            return;
          }
          if (this.policy.globals.forbidHostEscapeGlobals && HOST_ESCAPE_GLOBALS.has(expr.name)) {
            this.error(
              'SEC102',
              `Access to host/environment global '${expr.name}' is blocked by security policy.`,
              expr.line,
              expr.column,
              `Use sandboxed EasyJS standard library APIs instead of '${expr.name}'.`
            );
            return;
          }
        }
        return;
      }

      case 'MemberExpression': {
        if (
          this.policy.globals.forbidPrototypeAccess &&
          BLOCKED_PROTOTYPE_PROPS.has(expr.property)
        ) {
          this.error(
            'SEC103',
            `Access to prototype property '.${expr.property}' is blocked by security policy.`,
            expr.line,
            expr.column,
            'Prototype and constructor chain traversal is disallowed to prevent sandbox escape and prototype pollution.'
          );
        }
        if (expr.property === 'cookie' && this.policy.network.blockCookies) {
          this.error(
            'SEC104',
            `Access to '.cookie' is blocked by cookie-protection policy.`,
            expr.line,
            expr.column
          );
        }
        this.visitExpression(expr.object);
        return;
      }

      case 'IndexExpression': {
        if (this.policy.globals.forbidPrototypeAccess) {
          if (
            expr.index.kind === 'Literal' &&
            typeof expr.index.value === 'string' &&
            (BLOCKED_PROTOTYPE_PROPS.has(expr.index.value) ||
              expr.index.value === 'cookie' ||
              DYNAMIC_EVAL_GLOBALS.has(expr.index.value))
          ) {
            this.error(
              'SEC103',
              `Bracket access to '${expr.index.value}' is blocked by security policy.`,
              expr.line,
              expr.column
            );
          } else {
            const isComputedStrIndex =
              expr.index.kind !== 'Literal' || typeof expr.index.value === 'string';
            const sensitiveBase =
              (expr.object.kind === 'Identifier' &&
                SENSITIVE_INDEX_BASES.has(expr.object.name) &&
                !this.isDeclared(expr.object.name)) ||
              expr.object.kind === 'MapLiteral' ||
              expr.object.kind === 'Literal';
            if (isComputedStrIndex && sensitiveBase && expr.index.kind !== 'Literal') {
              // Block `({})[k]`, `(1)[k]`, `Object[k]`, `({})["con" + "structor"]` gadget lookups
              const numericIndexOnly =
                expr.index.kind === 'UnaryExpression' && expr.index.operator === '-';
              if (!numericIndexOnly) {
                this.error(
                  'SEC103',
                  `Dynamic computed property indexing on '${expr.object.kind === 'Identifier' ? expr.object.name : expr.object.kind}' is blocked to prevent constructor/prototype gadget bypasses.`,
                  expr.line,
                  expr.column,
                  'Use a direct property name or typed dictionary variable instead.'
                );
              }
            }
          }
        }
        this.visitExpression(expr.object);
        this.visitExpression(expr.index);
        return;
      }

      case 'AssignmentExpression': {
        if (
          this.isGlobalThisRoot(expr.target) &&
          this.policy.globals.globalThisMode === 'readonly'
        ) {
          this.error(
            'SEC101',
            `Mutating 'globalThis' is forbidden while globals.globalThisMode is 'readonly'.`,
            expr.line,
            expr.column
          );
        } else if (
          this.isGlobalThisRoot(expr.target) &&
          this.policy.globals.globalThisMode === 'disabled'
        ) {
          this.error(
            'SEC101',
            `Access to 'globalThis' is disabled by security policy.`,
            expr.line,
            expr.column
          );
        } else {
          this.visitExpression(expr.target);
        }
        this.visitExpression(expr.value);
        return;
      }

      case 'CallExpression': {
        this.validateStaticNetworkCall(expr);
        if (
          this.policy.globals.forbidDynamicEval &&
          expr.callee.kind === 'Identifier' &&
          (expr.callee.name === 'setTimeout' || expr.callee.name === 'setInterval') &&
          !this.isDeclared(expr.callee.name) &&
          expr.args[0] &&
          expr.args[0].kind === 'Literal' &&
          typeof expr.args[0].value === 'string'
        ) {
          this.error(
            'SEC102',
            `String code evaluation inside ${expr.callee.name}() is blocked by security policy.`,
            expr.line,
            expr.column,
            'Pass a function callback instead of a code string.'
          );
        }
        if (
          this.policy.globals.forbidPrototypeAccess &&
          expr.callee.kind === 'MemberExpression' &&
          expr.callee.object.kind === 'Identifier' &&
          ((expr.callee.object.name === 'Object' &&
            BLOCKED_OBJECT_REFLECT_METHODS.has(expr.callee.property)) ||
            expr.callee.object.name === 'Reflect')
        ) {
          this.error(
            'SEC103',
            `${expr.callee.object.name}.${expr.callee.property}() is blocked by prototype-security policy.`,
            expr.line,
            expr.column
          );
        }
        this.visitExpression(expr.callee);
        for (const a of expr.args) {
          this.visitExpression(a);
        }
        return;
      }

      case 'NewExpression':
        if (
          this.policy.globals.forbidDynamicEval &&
          expr.className === 'Function' &&
          !this.isDeclared('Function')
        ) {
          this.error(
            'SEC102',
            `Constructing dynamic 'new Function()' is blocked by security policy.`,
            expr.line,
            expr.column
          );
        }
        if (
          this.policy.globals.forbidHostEscapeGlobals &&
          HOST_ESCAPE_GLOBALS.has(expr.className) &&
          !this.isDeclared(expr.className)
        ) {
          this.error(
            'SEC102',
            `Constructing host API 'new ${expr.className}()' is blocked by security policy.`,
            expr.line,
            expr.column
          );
        }
        for (const a of expr.args) this.visitExpression(a);
        if (expr.countExpr) this.visitExpression(expr.countExpr);
        return;

      case 'BinaryExpression':
      case 'LogicalExpression':
      case 'PipeExpression':
        this.visitExpression(expr.left);
        this.visitExpression(expr.right);
        return;

      case 'UnaryExpression':
        this.visitExpression(expr.operand);
        return;

      case 'UpdateExpression':
        this.visitExpression(expr.argument);
        return;

      case 'ConditionalExpression':
        this.visitExpression(expr.condition);
        this.visitExpression(expr.consequent);
        this.visitExpression(expr.alternate);
        return;

      case 'PointerExpression':
        this.visitExpression(expr.argument);
        return;

      case 'ArrayLiteral':
        for (const el of expr.elements) this.visitExpression(el);
        return;

      case 'MapLiteral':
        for (const e of expr.entries) {
          this.visitExpression(e.key);
          this.visitExpression(e.value);
        }
        return;

      case 'FString':
        for (const p of expr.parts) {
          if (p.kind === 'expr') this.visitExpression(p.expression);
        }
        return;

      case 'StructInitExpression':
        for (const f of expr.fields) this.visitExpression(f.value);
        return;

      case 'RangeExpression':
        this.visitExpression(expr.start);
        this.visitExpression(expr.end);
        return;

      case 'LambdaExpression':
        this.pushScope();
        for (const p of expr.params) {
          if (p.defaultValue) this.visitExpression(p.defaultValue);
          this.declare(p.name);
        }
        if (expr.body.kind === 'BlockStatement') {
          this.visitBlock(expr.body);
        } else {
          this.visitExpression(expr.body);
        }
        this.popScope();
        return;

      case 'MatchExpression':
        this.visitExpression(expr.subject);
        for (const arm of expr.arms) {
          this.pushScope();
          if (arm.pattern.kind === 'BindingPattern') {
            this.declare(arm.pattern.name);
          } else if (arm.pattern.kind === 'EnumPattern') {
            for (const b of arm.pattern.bindings) this.declare(b);
          }
          if (arm.body.kind === 'BlockStatement') {
            this.visitBlock(arm.body);
          } else {
            this.visitExpression(arm.body);
          }
          this.popScope();
        }
        return;

      case 'Literal':
      case 'SelfExpression':
      case 'SuperExpression':
        return;

      default: {
        const unknown = expr as unknown as { kind?: string; line?: number; column?: number };
        this.failClosed(
          `Unsupported expression node '${unknown.kind ?? 'unknown'}'.`,
          unknown.line ?? 1,
          unknown.column ?? 1
        );
        return;
      }
    }
    } finally {
      this.depth--;
    }
  }
}
