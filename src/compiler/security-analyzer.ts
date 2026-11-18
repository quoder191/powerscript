/**
 * PowerScript Security Analyzer
 *
 * Performs full AST-based ownership, move, mutable/shared borrow,
 * lifetime-escape, and lexical scope analysis across all statements,
 * expressions, functions, classes, loops, and branches.
 */

import type {
    ProgramNode,
    StatementNode,
    ExpressionNode,
    VarDeclarationNode,
    BlockStatementNode,
    ParamNode,
    MatchArmNode
} from "./ast/nodes";

import {
    PowerScriptSecurityEngine
} from "./security-engine";

import {
    BorrowKind,
    OwnerKind,
    OwnerState,
    type OwnerRecord,
    type SecurityAnalysisResult,
    type SecurityPolicy,
    type SourceLocation
} from "./types";

const MAX_ANALYSIS_DEPTH = 200;
const MAX_ANALYZED_NODES = 25000;

export interface SecurityAnalyzerOptions {
    stopOnFirstError?: boolean;
    policy?: Partial<SecurityPolicy>;
}

export interface SecurityAnalyzerResult
    extends SecurityAnalysisResult {
    analysisComplete: boolean;
    incompleteReasons: string[];
}

interface BorrowBinding {
    borrowId: string;
    ownerId: string;
    kind: BorrowKind;
}

export class SecurityAnalyzer {

    private engine: PowerScriptSecurityEngine;

    /**
     * Stack of lexical scopes mapping variable names to unique owner IDs,
     * or `null` when shadowed by a non-owning local/parameter.
     */
    private scopeBindings: Array<Map<string, string | null>> = [];
    private borrowBindings: Array<Map<string, BorrowBinding | null>> = [];
    private scopeIds: string[] = [];

    private scopeCounter = 0;
    private ownerCounter = 0;
    private borrowCounter = 0;
    private functionEntryDepthStack: number[] = [];

    private analysisComplete = true;
    private incompleteReasons: string[] = [];
    private analyzedNodes = 0;
    private astDepth = 0;

    private stopOnFirstError: boolean;

    constructor(options: SecurityAnalyzerOptions = {}) {

        this.engine = new PowerScriptSecurityEngine({
            stopOnFirstError: options.stopOnFirstError ?? false,
            requireExplicitBorrowEnd: false,
            warnOnOwnerNotConsumedAtScopeExit: false,
            ...(options.policy ?? {}),
        });

        this.stopOnFirstError =
            options.stopOnFirstError ?? false;
    }

    private location(node: {
        line: number;
        column: number;
    }): SourceLocation {

        return {
            line: node.line,
            column: node.column
        };
    }

    private createScopeId(): string {

        this.scopeCounter++;

        return `powerscript_scope_${this.scopeCounter}`;
    }

    private createOwnerId(name: string): string {
        this.ownerCounter++;
        return `${name}#${this.ownerCounter}`;
    }

    private createBorrowId(ownerName: string): string {
        this.borrowCounter++;
        return `borrow_${ownerName}#${this.borrowCounter}`;
    }

    private currentScopeId(): string {
        return this.scopeIds[this.scopeIds.length - 1] ?? "powerscript_root";
    }

    private currentScopeDepth(): number {
        return Math.max(0, this.scopeIds.length - 1);
    }

    private pushScope(): string {
        const id = this.createScopeId();
        this.scopeIds.push(id);
        this.scopeBindings.push(new Map());
        this.borrowBindings.push(new Map());
        return id;
    }

    private popScope(): void {
        const id = this.scopeIds.pop();
        if (id) {
            this.engine.exitScope(id);
        }
        this.scopeBindings.pop();
        this.borrowBindings.pop();
    }

    private bindOwner(name: string, ownerId: string | null): void {
        const top = this.scopeBindings[this.scopeBindings.length - 1];
        if (top) {
            top.set(name, ownerId);
        }
        const bTop = this.borrowBindings[this.borrowBindings.length - 1];
        if (bTop) {
            bTop.set(name, null);
        }
    }

    private bindBorrow(name: string, binding: BorrowBinding | null): void {
        const bTop = this.borrowBindings[this.borrowBindings.length - 1];
        if (bTop) {
            bTop.set(name, binding);
        }
        const top = this.scopeBindings[this.scopeBindings.length - 1];
        if (top) {
            top.set(name, null);
        }
    }

    private lookupOwnerId(name: string): string | null {
        for (let i = this.scopeBindings.length - 1; i >= 0; i--) {
            if (this.scopeBindings[i].has(name)) {
                return this.scopeBindings[i].get(name) ?? null;
            }
        }
        return null;
    }

    private lookupOwnerDeclarationDepth(name: string): number {
        for (let i = this.scopeBindings.length - 1; i >= 0; i--) {
            if (this.scopeBindings[i].has(name)) {
                return i;
            }
        }
        return 0;
    }

    private lookupBorrow(name: string): BorrowBinding | null {
        for (let i = this.borrowBindings.length - 1; i >= 0; i--) {
            if (this.borrowBindings[i].has(name)) {
                return this.borrowBindings[i].get(name) ?? null;
            }
        }
        return null;
    }

    private snapshotBindings(): {
        owners: Array<Map<string, string | null>>;
        borrows: Array<Map<string, BorrowBinding | null>>;
    } {
        return {
            owners: this.scopeBindings.map((m) => new Map(m)),
            borrows: this.borrowBindings.map((m) => new Map(m)),
        };
    }

    private restoreBindings(saved: {
        owners: Array<Map<string, string | null>>;
        borrows: Array<Map<string, BorrowBinding | null>>;
    }): void {
        this.scopeBindings = saved.owners.map((m) => new Map(m));
        this.borrowBindings = saved.borrows.map((m) => new Map(m));
    }

    private abortIncomplete(reason: string, location?: SourceLocation): void {
        this.analysisComplete = false;
        if (!this.incompleteReasons.includes(reason)) {
            this.incompleteReasons.push(reason);
            this.engine.diagnostics.error(
                "SEC000",
                `Incomplete Security Analysis: ${reason}`,
                location,
                "Execution is blocked because the security analyzer could not completely verify this program."
            );
        }
    }

    /**
     * Analyze a complete program.
     */
    analyze(program: ProgramNode): SecurityAnalyzerResult {

        this.engine.reset();
        this.scopeBindings = [];
        this.borrowBindings = [];
        this.scopeIds = [];
        this.scopeCounter = 0;
        this.ownerCounter = 0;
        this.borrowCounter = 0;
        this.functionEntryDepthStack = [];
        this.analysisComplete = true;
        this.incompleteReasons = [];
        this.analyzedNodes = 0;
        this.astDepth = 0;

        try {
            if (!program || !Array.isArray(program.body)) {
                this.abortIncomplete("Program AST is malformed or missing body.");
            } else {
                this.pushScope();
                this.analyzeStatements(program.body);
                this.popScope();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.abortIncomplete(`Internal security analyzer failure: ${msg}`);
        }

        const result = this.engine.getResult();

        return {
            ...result,
            success: result.success && this.analysisComplete,
            analysisComplete: this.analysisComplete,
            incompleteReasons: [...this.incompleteReasons],
        };
    }

    private analyzeStatements(statements: StatementNode[]): void {

        for (const statement of statements) {

            if (
                this.stopOnFirstError &&
                this.engine.diagnostics.hasErrors()
            ) {
                break;
            }

            this.analyzeStatement(statement);
        }
    }

    private analyzeBlock(block: BlockStatementNode): void {
        this.pushScope();
        this.analyzeStatements(block.statements);
        this.popScope();
    }

    private analyzeCallableBody(
        params: ParamNode[],
        body: BlockStatementNode | ExpressionNode
    ): void {
        const savedEngine = this.engine.snapshot();
        const savedBindings = this.snapshotBindings();

        const outerDepth = this.currentScopeDepth();
        this.functionEntryDepthStack.push(outerDepth);
        const fnScope = this.pushScope();
        const fnDepth = this.currentScopeDepth();

        for (const param of params) {
            if (param.defaultValue) {
                this.analyzeExpression(param.defaultValue);
            }
            const typeName = param.typeAnnotation?.name;
            if (typeName === "own" || typeName === "unique_ptr") {
                const oid = this.createOwnerId(param.name);
                this.engine.createOwner(
                    oid,
                    param.name,
                    fnScope,
                    this.location(param),
                    fnDepth,
                    OwnerKind.UNIQUE
                );
                this.bindOwner(param.name, oid);
            } else {
                // Shadow outer bindings with parameter name
                this.bindOwner(param.name, null);
            }
        }

        if (body.kind === "BlockStatement") {
            this.analyzeStatements(body.statements);
        } else {
            this.analyzeExpression(body);
        }

        this.popScope();
        this.functionEntryDepthStack.pop();

        // Restoring pre-declaration state ensures defining a function/method
        // does not prematurely consume top-level owners before it is called.
        this.engine.restore(savedEngine);
        this.restoreBindings(savedBindings);
    }

    private isUniqueLikeCall(expr?: ExpressionNode): boolean {
        if (!expr) return false;
        if (
            expr.kind === "CallExpression" &&
            expr.callee.kind === "Identifier" &&
            (expr.callee.name === "make_unique" || expr.callee.name === "unique_ptr")
        ) {
            return true;
        }
        if (
            expr.kind === "PointerExpression" &&
            expr.op === "own"
        ) {
            return true;
        }
        return false;
    }

    private isSharedLikeCall(expr?: ExpressionNode): boolean {
        if (!expr) return false;
        if (
            expr.kind === "CallExpression" &&
            expr.callee.kind === "Identifier" &&
            (expr.callee.name === "make_shared" ||
                expr.callee.name === "shared_ptr" ||
                expr.callee.name === "share")
        ) {
            return true;
        }
        if (
            expr.kind === "PointerExpression" &&
            expr.op === "shared"
        ) {
            return true;
        }
        return false;
    }

    private createBorrowForOwner(
        ownerId: string,
        ownerLabel: string,
        kind: BorrowKind,
        location: SourceLocation
    ): BorrowBinding | null {
        if (!this.engine.checkUse(ownerId, location)) {
            return null;
        }
        const borrowId = this.createBorrowId(ownerLabel);
        const ok =
            kind === BorrowKind.MUTABLE
                ? this.engine.borrowMutable(
                      ownerId,
                      borrowId,
                      this.currentScopeId(),
                      location,
                      this.currentScopeDepth()
                  )
                : this.engine.borrowShared(
                      ownerId,
                      borrowId,
                      this.currentScopeId(),
                      location,
                      this.currentScopeDepth()
                  );
        return ok ? { borrowId, ownerId, kind } : null;
    }

    private createBorrowForExpr(
        expr: ExpressionNode,
        kind: BorrowKind,
        location: SourceLocation
    ): BorrowBinding | null {
        if (
            expr.kind === "PointerExpression" &&
            (expr.op === "borrow" || expr.op === "addr") &&
            expr.argument.kind === "Identifier"
        ) {
            const ownerId = this.lookupOwnerId(expr.argument.name);
            if (!ownerId) {
                this.analyzeExpression(expr.argument);
                return null;
            }
            return this.createBorrowForOwner(
                ownerId,
                expr.argument.name,
                kind,
                location
            );
        }
        return null;
    }

    private analyzeStatement(statement: StatementNode): void {
        if (!this.analysisComplete) return;
        this.astDepth++;
        this.analyzedNodes++;
        if (this.astDepth > MAX_ANALYSIS_DEPTH) {
            this.abortIncomplete(
                `Maximum AST nesting depth (${MAX_ANALYSIS_DEPTH}) exceeded during security analysis.`,
                this.location(statement)
            );
            this.astDepth--;
            return;
        }
        if (this.analyzedNodes > MAX_ANALYZED_NODES) {
            this.abortIncomplete(
                `Maximum AST node budget (${MAX_ANALYZED_NODES}) exceeded during security analysis.`,
                this.location(statement)
            );
            this.astDepth--;
            return;
        }

        try {
            switch (statement.kind) {

            case "VarDeclaration":
                this.analyzeVariable(statement);
                break;

            case "MultiVarDeclaration":
                for (const declaration of statement.declarations) {
                    this.analyzeVariable(declaration);
                }
                break;

            case "DropStatement":
                this.analyzeDrop(statement.target, this.location(statement));
                break;

            case "BlockStatement":
                this.analyzeBlock(statement);
                break;

            case "ScopeStatement":
                this.analyzeBlock(statement.body);
                break;

            case "ExpressionStatement":
                this.analyzeExpression(statement.expression);
                break;

            case "ImportStatement":
            case "StyleStatement":
            case "EnumDeclaration":
            case "TraitDeclaration":
            case "BreakStatement":
            case "ContinueStatement":
                break;

            case "FunctionDeclaration":
                this.analyzeCallableBody(statement.params, statement.body);
                break;

            case "ClassDeclaration":
                for (const field of statement.fields) {
                    if (field.initializer) {
                        this.analyzeExpression(field.initializer);
                    }
                }
                for (const method of statement.methods) {
                    this.analyzeCallableBody(method.params, method.body);
                }
                break;

            case "StructDeclaration":
                for (const field of statement.fields) {
                    if (field.defaultValue) {
                        this.analyzeExpression(field.defaultValue);
                    }
                }
                for (const method of statement.methods) {
                    this.analyzeCallableBody(method.params, method.body);
                }
                break;

            case "IfStatement": {
                this.analyzeExpression(statement.condition);

                const preState = this.engine.snapshot();
                const preBindings = this.snapshotBindings();

                const branchSnapshots: Array<Map<string, OwnerRecord>> = [];

                this.analyzeBlock(statement.consequent);
                branchSnapshots.push(this.engine.snapshot().owners);

                for (const elif of statement.elifBranches) {
                    this.engine.restore(preState);
                    this.restoreBindings(preBindings);
                    this.analyzeExpression(elif.condition);
                    this.analyzeBlock(elif.consequent);
                    branchSnapshots.push(this.engine.snapshot().owners);
                }

                if (statement.alternate) {
                    this.engine.restore(preState);
                    this.restoreBindings(preBindings);
                    this.analyzeBlock(statement.alternate);
                    branchSnapshots.push(this.engine.snapshot().owners);
                }

                // Restore pre-branch state, then mark any pre-existing owner as
                // moved/dropped only if EVERY exhaustive branch consumed it.
                this.engine.restore(preState);
                this.restoreBindings(preBindings);

                if (statement.alternate && branchSnapshots.length >= 2) {
                    for (const [id, preRec] of preState.owners.entries()) {
                        if (preRec.state !== OwnerState.ACTIVE) continue;
                        const allMoved = branchSnapshots.every(
                            (snap) => snap.get(id)?.state === OwnerState.MOVED
                        );
                        const allDropped = branchSnapshots.every(
                            (snap) => snap.get(id)?.state === OwnerState.DROPPED
                        );
                        if (allMoved) {
                            const rec = this.engine.ownership.getOwner(id);
                            if (rec) rec.state = OwnerState.MOVED;
                        } else if (allDropped) {
                            const rec = this.engine.ownership.getOwner(id);
                            if (rec) rec.state = OwnerState.DROPPED;
                        }
                    }
                }
                break;
            }

            case "ForInStatement": {
                this.analyzeExpression(statement.iterable);
                this.pushScope();
                this.bindOwner(statement.variable, null);
                this.analyzeStatements(statement.body.statements);
                this.popScope();
                break;
            }

            case "CForStatement": {
                this.pushScope();
                if (statement.init) this.analyzeStatement(statement.init);
                if (statement.condition) this.analyzeExpression(statement.condition);
                if (statement.update) this.analyzeExpression(statement.update);
                this.analyzeStatements(statement.body.statements);
                this.popScope();
                break;
            }

            case "WhileStatement":
                this.analyzeExpression(statement.condition);
                this.analyzeBlock(statement.body);
                break;

            case "DoWhileStatement":
                this.analyzeBlock(statement.body);
                this.analyzeExpression(statement.condition);
                break;

            case "LoopStatement":
                this.analyzeBlock(statement.body);
                break;

            case "RepeatStatement":
                this.analyzeExpression(statement.count);
                this.analyzeBlock(statement.body);
                break;

            case "ReturnStatement":
                if (statement.value) {
                    const fnOuterDepth =
                        this.functionEntryDepthStack.length > 0
                            ? this.functionEntryDepthStack[this.functionEntryDepthStack.length - 1]
                            : 0;
                    const loc = this.location(statement.value);

                    // Returning an existing borrow variable that points to a local owner
                    if (statement.value.kind === "Identifier") {
                        const borrow = this.lookupBorrow(statement.value.name);
                        if (borrow) {
                            this.engine.checkBorrowRead(borrow.borrowId, loc);
                            this.engine.checkLifetimeEscape(
                                borrow.ownerId,
                                fnOuterDepth,
                                "returning borrowed reference from function",
                                loc
                            );
                            break;
                        }
                        const oid = this.lookupOwnerId(statement.value.name);
                        if (oid) {
                            this.engine.checkUse(oid, loc);
                        }
                        break;
                    }

                    // Returning `&localOwner` / `borrow localOwner` directly
                    if (
                        statement.value.kind === "PointerExpression" &&
                        (statement.value.op === "addr" || statement.value.op === "borrow") &&
                        statement.value.argument.kind === "Identifier"
                    ) {
                        const oid = this.lookupOwnerId(statement.value.argument.name);
                        if (oid) {
                            this.engine.checkUse(oid, loc);
                            this.engine.checkLifetimeEscape(
                                oid,
                                fnOuterDepth,
                                "returning reference to local variable",
                                loc
                            );
                            break;
                        }
                    }

                    this.analyzeExpression(statement.value);
                }
                break;

            case "ThrowStatement":
                if (statement.value) {
                    this.analyzeExpression(statement.value);
                }
                break;

            case "TryCatchStatement": {
                const preTry = this.engine.snapshot();
                const preBindings = this.snapshotBindings();

                this.analyzeBlock(statement.tryBlock);

                this.engine.restore(preTry);
                this.restoreBindings(preBindings);

                this.pushScope();
                if (statement.catchVar) {
                    this.bindOwner(statement.catchVar, null);
                }
                this.analyzeStatements(statement.catchBlock.statements);
                this.popScope();
                break;
            }

            case "DeferStatement": {
                const saved = this.engine.snapshot();
                const savedBindings = this.snapshotBindings();
                this.analyzeStatement(statement.statement);
                this.engine.restore(saved);
                this.restoreBindings(savedBindings);
                break;
            }

            default: {
                const unknown = statement as unknown as { kind?: string; line?: number; column?: number };
                this.abortIncomplete(
                    `Unsupported statement node '${unknown.kind ?? "unknown"}' cannot be verified safely.`,
                    { line: unknown.line ?? 1, column: unknown.column ?? 1 }
                );
                break;
            }
        }
        } finally {
            this.astDepth--;
        }
    }

    private analyzeDrop(target: ExpressionNode, location: SourceLocation): void {
        if (target.kind === "Identifier") {
            const ownerId = this.lookupOwnerId(target.name);
            if (ownerId) {
                this.engine.drop(ownerId, location);
                return;
            }
        }
        this.analyzeExpression(target);
    }

    private analyzeVariable(declaration: VarDeclarationNode): void {

        const location = this.location(declaration);
        const scopeId = this.currentScopeId();
        const scopeDepth = this.currentScopeDepth();
        const initializer = declaration.initializer;

        /*
         * Handle explicit ownership transfer:
         * let second = move(first) / u2 = std::move(u1)
         */
        if (
            initializer?.kind === "PointerExpression" &&
            initializer.op === "move" &&
            initializer.argument.kind === "Identifier"
        ) {
            const sourceName = initializer.argument.name;
            const sourceOwnerId = this.lookupOwnerId(sourceName);

            if (sourceOwnerId) {
                const targetOwnerId = this.createOwnerId(declaration.name);
                this.engine.move(
                    sourceOwnerId,
                    targetOwnerId,
                    declaration.name,
                    location,
                    scopeId,
                    scopeDepth
                );
                this.bindOwner(declaration.name, targetOwnerId);
                return;
            }

            this.analyzeExpression(initializer.argument);
            this.bindOwner(declaration.name, null);
            return;
        }

        /*
         * Handle shared cloning: let s2 = s1.clone()
         */
        if (
            initializer?.kind === "CallExpression" &&
            initializer.callee.kind === "MemberExpression" &&
            initializer.callee.property === "clone" &&
            initializer.callee.object.kind === "Identifier"
        ) {
            const sourceOwnerId = this.lookupOwnerId(initializer.callee.object.name);
            if (sourceOwnerId) {
                const rec = this.engine.ownership.getOwner(sourceOwnerId);
                if (rec && rec.kind === OwnerKind.SHARED) {
                    const targetOwnerId = this.createOwnerId(declaration.name);
                    this.engine.cloneShared(
                        sourceOwnerId,
                        targetOwnerId,
                        declaration.name,
                        scopeId,
                        scopeDepth,
                        location
                    );
                    this.bindOwner(declaration.name, targetOwnerId);
                    return;
                }
            }
        }

        /*
         * Handle explicit borrow variable declarations:
         * ref view = &data / mutref view = &data / int& r = data / const int& r = data
         */
        if (
            initializer &&
            ((initializer.kind === "PointerExpression" &&
                (initializer.op === "borrow" || initializer.op === "addr") &&
                initializer.argument.kind === "Identifier" &&
                (declaration.pointerMode === "ref" ||
                    declaration.pointerMode === "cpp_ref" ||
                    initializer.op === "borrow" ||
                    this.lookupOwnerId(initializer.argument.name) !== null)) ||
                ((declaration.pointerMode === "cpp_ref" ||
                    declaration.pointerMode === "ref") &&
                    initializer.kind === "Identifier"))
        ) {
            const wantsMutable =
                declaration.pointerMode === "cpp_ref" &&
                !declaration.typeAnnotation?.isConst;
            const kind = wantsMutable ? BorrowKind.MUTABLE : BorrowKind.SHARED;
            const targetName =
                initializer.kind === "Identifier"
                    ? initializer.name
                    : initializer.kind === "PointerExpression" &&
                        initializer.argument.kind === "Identifier"
                      ? initializer.argument.name
                      : null;

            if (targetName) {
                const ownerId = this.lookupOwnerId(targetName);
                if (ownerId) {
                    const borrow = this.createBorrowForOwner(
                        ownerId,
                        targetName,
                        kind,
                        location
                    );
                    this.bindBorrow(declaration.name, borrow);
                    return;
                }
                const existingBorrow = this.lookupBorrow(targetName);
                if (existingBorrow) {
                    this.engine.checkBorrowRead(existingBorrow.borrowId, location);
                    const borrow = this.createBorrowForOwner(
                        existingBorrow.ownerId,
                        targetName,
                        kind,
                        location
                    );
                    this.bindBorrow(declaration.name, borrow);
                    return;
                }
            }
            const borrow = this.createBorrowForExpr(initializer, kind, location);
            this.bindBorrow(declaration.name, borrow);
            return;
        }

        if (initializer) {
            this.analyzeExpression(initializer);
        }

        if (
            declaration.pointerMode === "own" ||
            declaration.pointerMode === "unique" ||
            this.isUniqueLikeCall(initializer)
        ) {
            const ownerId = this.createOwnerId(declaration.name);
            this.engine.createOwner(
                ownerId,
                declaration.name,
                scopeId,
                location,
                scopeDepth,
                OwnerKind.UNIQUE
            );
            this.bindOwner(declaration.name, ownerId);
            return;
        }

        if (
            declaration.pointerMode === "shared" ||
            this.isSharedLikeCall(initializer)
        ) {
            const ownerId = this.createOwnerId(declaration.name);
            this.engine.createOwner(
                ownerId,
                declaration.name,
                scopeId,
                location,
                scopeDepth,
                OwnerKind.SHARED
            );
            this.bindOwner(declaration.name, ownerId);
            return;
        }

        // Shadow any outer owner with the same name when declaring a non-owning local
        this.bindOwner(declaration.name, null);
    }

    private analyzeExpression(expression: ExpressionNode): void {
        if (!this.analysisComplete) return;
        this.astDepth++;
        this.analyzedNodes++;
        if (this.astDepth > MAX_ANALYSIS_DEPTH) {
            this.abortIncomplete(
                `Maximum expression nesting depth (${MAX_ANALYSIS_DEPTH}) exceeded.`,
                this.location(expression)
            );
            this.astDepth--;
            return;
        }
        if (this.analyzedNodes > MAX_ANALYZED_NODES) {
            this.abortIncomplete(
                `Maximum AST node budget (${MAX_ANALYZED_NODES}) exceeded.`,
                this.location(expression)
            );
            this.astDepth--;
            return;
        }

        try {
            switch (expression.kind) {

            case "Identifier": {
                const borrow = this.lookupBorrow(expression.name);
                if (borrow) {
                    this.engine.checkBorrowRead(borrow.borrowId, this.location(expression));
                    return;
                }
                const ownerId = this.lookupOwnerId(expression.name);
                if (ownerId) {
                    if (this.engine.checkUse(ownerId, this.location(expression))) {
                        this.engine.checkRead(ownerId, this.location(expression));
                    }
                }
                return;
            }

            case "Literal":
            case "SelfExpression":
            case "SuperExpression":
                return;

            case "PointerExpression": {
                if (expression.op === "move") {
                    if (expression.argument.kind === "Identifier") {
                        const sourceOwnerId = this.lookupOwnerId(expression.argument.name);
                        if (sourceOwnerId) {
                            const tempId = this.createOwnerId(`${expression.argument.name}_moved`);
                            this.engine.move(
                                sourceOwnerId,
                                tempId,
                                `${expression.argument.name}_moved`,
                                this.location(expression),
                                this.currentScopeId(),
                                this.currentScopeDepth()
                            );
                            return;
                        }
                    }
                    this.analyzeExpression(expression.argument);
                    return;
                }

                if (expression.op === "borrow" || expression.op === "addr") {
                    if (expression.argument.kind === "Identifier") {
                        const ownerId = this.lookupOwnerId(expression.argument.name);
                        if (ownerId) {
                            if (this.engine.checkUse(ownerId, this.location(expression))) {
                                this.engine.borrowShared(
                                    ownerId,
                                    this.createBorrowId(expression.argument.name),
                                    this.currentScopeId(),
                                    this.location(expression),
                                    this.currentScopeDepth()
                                );
                            }
                            return;
                        }
                    }
                    this.analyzeExpression(expression.argument);
                    return;
                }

                if (expression.op === "sizeof" && expression.sizeofTypeName) {
                    return;
                }

                if (expression.op === "deref" && expression.argument.kind === "Identifier") {
                    const borrow = this.lookupBorrow(expression.argument.name);
                    if (borrow) {
                        this.engine.checkBorrowRead(borrow.borrowId, this.location(expression));
                        return;
                    }
                    const ownerId = this.lookupOwnerId(expression.argument.name);
                    if (ownerId) {
                        if (this.engine.checkUse(ownerId, this.location(expression))) {
                            this.engine.checkRead(ownerId, this.location(expression));
                        }
                        return;
                    }
                }

                this.analyzeExpression(expression.argument);
                return;
            }

            case "AssignmentExpression": {
                const loc = this.location(expression);

                // Dereferenced write: `*ptr = val`
                if (
                    expression.target.kind === "PointerExpression" &&
                    expression.target.op === "deref" &&
                    expression.target.argument.kind === "Identifier"
                ) {
                    this.analyzeExpression(expression.value);
                    const ptrName = expression.target.argument.name;
                    const borrow = this.lookupBorrow(ptrName);
                    if (borrow) {
                        this.engine.checkBorrowWrite(borrow.borrowId, loc);
                        return;
                    }
                    const ownerId = this.lookupOwnerId(ptrName);
                    if (ownerId) {
                        this.engine.checkMutation(ownerId, loc, true);
                        return;
                    }
                    return;
                }

                // Direct identifier assignment: `x = val`
                if (expression.target.kind === "Identifier") {
                    const targetName = expression.target.name;
                    const targetDeclDepth = this.lookupOwnerDeclarationDepth(targetName);

                    // Check lifetime escape when assigning a borrow into an outer-scoped variable
                    if (
                        expression.operator === "=" &&
                        expression.value.kind === "PointerExpression" &&
                        (expression.value.op === "borrow" || expression.value.op === "addr") &&
                        expression.value.argument.kind === "Identifier"
                    ) {
                        const borrowedOwnerId = this.lookupOwnerId(expression.value.argument.name);
                        if (borrowedOwnerId) {
                            this.engine.checkLifetimeEscape(
                                borrowedOwnerId,
                                targetDeclDepth,
                                `assigning reference into outer variable '${targetName}'`,
                                loc
                            );
                        }
                    } else if (
                        expression.operator === "=" &&
                        expression.value.kind === "Identifier"
                    ) {
                        const rhsBorrow = this.lookupBorrow(expression.value.name);
                        if (rhsBorrow) {
                            this.engine.checkLifetimeEscape(
                                rhsBorrow.ownerId,
                                targetDeclDepth,
                                `assigning reference into outer variable '${targetName}'`,
                                loc
                            );
                        }
                    }

                    this.analyzeExpression(expression.value);

                    const existingOwnerId = this.lookupOwnerId(targetName);
                    if (expression.operator === "=") {
                        if (
                            existingOwnerId &&
                            this.engine.ownership.getOwner(existingOwnerId)?.state === OwnerState.ACTIVE
                        ) {
                            // Rebinding an active owner while borrowed is forbidden
                            this.engine.checkMutation(existingOwnerId, loc, false);
                        }
                        if (
                            expression.value.kind === "PointerExpression" &&
                            expression.value.op === "move" &&
                            expression.value.argument.kind === "Identifier"
                        ) {
                            if (this.isUniqueLikeCall(expression.value) || existingOwnerId) {
                                const newId = this.createOwnerId(targetName);
                                this.engine.createOwner(
                                    newId,
                                    targetName,
                                    this.currentScopeId(),
                                    loc,
                                    this.currentScopeDepth(),
                                    OwnerKind.UNIQUE
                                );
                                this.bindOwner(targetName, newId);
                                return;
                            }
                        }
                        if (existingOwnerId && this.isUniqueLikeCall(expression.value)) {
                            const newId = this.createOwnerId(targetName);
                            this.engine.createOwner(
                                newId,
                                targetName,
                                this.currentScopeId(),
                                loc,
                                this.currentScopeDepth(),
                                OwnerKind.UNIQUE
                            );
                            this.bindOwner(targetName, newId);
                        }
                    } else if (existingOwnerId) {
                        this.engine.checkMutation(existingOwnerId, loc, false);
                    }
                    return;
                }

                this.analyzeExpression(expression.value);
                this.analyzeExpression(expression.target);
                return;
            }

            case "LambdaExpression":
                this.analyzeCallableBody(expression.params, expression.body);
                return;

            case "FString":
                for (const part of expression.parts) {
                    if (part.kind === "expr") {
                        this.analyzeExpression(part.expression);
                    }
                }
                return;

            case "ArrayLiteral":
                for (const el of expression.elements) {
                    this.analyzeExpression(el);
                }
                return;

            case "MapLiteral":
                for (const entry of expression.entries) {
                    this.analyzeExpression(entry.key);
                    this.analyzeExpression(entry.value);
                }
                return;

            case "BinaryExpression":
            case "LogicalExpression":
            case "PipeExpression":
                this.analyzeExpression(expression.left);
                this.analyzeExpression(expression.right);
                return;

            case "UnaryExpression":
                this.analyzeExpression(expression.operand);
                return;

            case "UpdateExpression":
                this.analyzeExpression(expression.argument);
                return;

            case "ConditionalExpression":
                this.analyzeExpression(expression.condition);
                this.analyzeExpression(expression.consequent);
                this.analyzeExpression(expression.alternate);
                return;

            case "CallExpression":
                this.analyzeExpression(expression.callee);
                for (const arg of expression.args) {
                    this.analyzeExpression(arg);
                }
                return;

            case "MemberExpression":
                this.analyzeExpression(expression.object);
                return;

            case "IndexExpression":
                this.analyzeExpression(expression.object);
                this.analyzeExpression(expression.index);
                return;

            case "NewExpression":
                for (const arg of expression.args) {
                    this.analyzeExpression(arg);
                }
                if (expression.countExpr) {
                    this.analyzeExpression(expression.countExpr);
                }
                return;

            case "StructInitExpression":
                for (const field of expression.fields) {
                    this.analyzeExpression(field.value);
                }
                return;

            case "RangeExpression":
                this.analyzeExpression(expression.start);
                this.analyzeExpression(expression.end);
                return;

            case "MatchExpression": {
                this.analyzeExpression(expression.subject);
                const preMatch = this.engine.snapshot();
                const preBindings = this.snapshotBindings();

                for (const arm of expression.arms) {
                    this.engine.restore(preMatch);
                    this.restoreBindings(preBindings);
                    this.analyzeMatchArm(arm);
                }

                this.engine.restore(preMatch);
                this.restoreBindings(preBindings);
                return;
            }

            default: {
                const unknown = expression as unknown as { kind?: string; line?: number; column?: number };
                this.abortIncomplete(
                    `Unsupported expression node '${unknown.kind ?? "unknown"}' cannot be verified safely.`,
                    { line: unknown.line ?? 1, column: unknown.column ?? 1 }
                );
                return;
            }
        }
        } finally {
            this.astDepth--;
        }
    }

    private analyzeMatchArm(arm: MatchArmNode): void {
        this.pushScope();
        if (arm.pattern.kind === "BindingPattern") {
            this.bindOwner(arm.pattern.name, null);
        } else if (arm.pattern.kind === "EnumPattern") {
            for (const b of arm.pattern.bindings) {
                this.bindOwner(b, null);
            }
        }
        if (arm.body.kind === "BlockStatement") {
            this.analyzeStatements(arm.body.statements);
        } else {
            this.analyzeExpression(arm.body);
        }
        this.popScope();
    }

    /**
     * Retrieve the underlying security engine.
     */
    getEngine(): PowerScriptSecurityEngine {

        return this.engine;
    }

    /**
     * Reset analyzer state.
     */
    reset(): void {

        this.engine.reset();

        this.scopeBindings = [];
        this.borrowBindings = [];
        this.scopeIds = [];

        this.scopeCounter = 0;
        this.ownerCounter = 0;
        this.borrowCounter = 0;
        this.functionEntryDepthStack = [];

        this.analysisComplete = true;
        this.incompleteReasons = [];
        this.analyzedNodes = 0;
        this.astDepth = 0;
    }
}
