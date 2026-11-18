/**
 * PowerScript Security Analyzer
 *
 * Performs full AST-based ownership, move, borrow, and scope analysis
 * across all statements, expressions, functions, classes, loops, and branches.
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
    OwnerState,
    type OwnerRecord,
    type SecurityAnalysisResult,
    type SourceLocation
} from "./types";

export interface SecurityAnalyzerOptions {
    stopOnFirstError?: boolean;
}

export interface SecurityAnalyzerResult
    extends SecurityAnalysisResult {
    analysisComplete: boolean;
}

export class SecurityAnalyzer {

    private engine: PowerScriptSecurityEngine;

    /**
     * Stack of lexical scopes mapping variable names to unique owner IDs,
     * or `null` when shadowed by a non-owning local/parameter.
     */
    private scopeBindings: Array<Map<string, string | null>> = [];
    private scopeIds: string[] = [];

    private scopeCounter = 0;
    private ownerCounter = 0;
    private borrowCounter = 0;

    private analysisComplete = true;

    private stopOnFirstError: boolean;

    constructor(options: SecurityAnalyzerOptions = {}) {

        this.engine = new PowerScriptSecurityEngine({
            stopOnFirstError: options.stopOnFirstError ?? false,
            requireExplicitBorrowEnd: false,
            warnOnOwnerNotConsumedAtScopeExit: false
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

    private pushScope(): string {
        const id = this.createScopeId();
        this.scopeIds.push(id);
        this.scopeBindings.push(new Map());
        return id;
    }

    private popScope(): void {
        const id = this.scopeIds.pop();
        if (id) {
            this.engine.exitScope(id);
        }
        this.scopeBindings.pop();
    }

    private bindOwner(name: string, ownerId: string | null): void {
        const top = this.scopeBindings[this.scopeBindings.length - 1];
        if (top) {
            top.set(name, ownerId);
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

    private snapshotBindings(): Array<Map<string, string | null>> {
        return this.scopeBindings.map((m) => new Map(m));
    }

    private restoreBindings(saved: Array<Map<string, string | null>>): void {
        this.scopeBindings = saved.map((m) => new Map(m));
    }

    /**
     * Analyze a complete program.
     */
    analyze(program: ProgramNode): SecurityAnalyzerResult {

        this.engine.reset();
        this.scopeBindings = [];
        this.scopeIds = [];
        this.scopeCounter = 0;
        this.ownerCounter = 0;
        this.borrowCounter = 0;
        this.analysisComplete = true;

        this.pushScope();

        this.analyzeStatements(program.body);

        this.popScope();

        const result = this.engine.getResult();

        return {
            ...result,
            analysisComplete: this.analysisComplete
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

        const fnScope = this.pushScope();

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
                    this.location(param)
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

    private analyzeStatement(statement: StatementNode): void {

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
            case "ThrowStatement":
                if (statement.value) {
                    if (
                        statement.kind === "ReturnStatement" &&
                        statement.value.kind === "Identifier"
                    ) {
                        const oid = this.lookupOwnerId(statement.value.name);
                        if (oid) {
                            this.engine.checkUse(oid, this.location(statement.value));
                        }
                    } else {
                        this.analyzeExpression(statement.value);
                    }
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
                // Deferred statements execute on scope exit, not immediately.
                const saved = this.engine.snapshot();
                const savedBindings = this.snapshotBindings();
                this.analyzeStatement(statement.statement);
                this.engine.restore(saved);
                this.restoreBindings(savedBindings);
                break;
            }
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
                    location
                );
                // Keep sourceName bound to sourceOwnerId (now MOVED) so any
                // subsequent use-after-move is caught, and bind target to the new owner.
                this.bindOwner(declaration.name, targetOwnerId);
                return;
            }

            // Moving a non-owning value/parameter is a pass-through in EasyJS
            this.analyzeExpression(initializer.argument);
            this.bindOwner(declaration.name, null);
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
                location
            );
            this.bindOwner(declaration.name, ownerId);
            return;
        }

        // Shadow any outer owner with the same name when declaring a non-owning local
        this.bindOwner(declaration.name, null);
    }

    private analyzeExpression(expression: ExpressionNode): void {

        switch (expression.kind) {

            case "Identifier": {
                const ownerId = this.lookupOwnerId(expression.name);
                if (ownerId) {
                    this.engine.checkUse(ownerId, this.location(expression));
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
                                this.location(expression)
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
                                    this.location(expression)
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

                this.analyzeExpression(expression.argument);
                return;
            }

            case "AssignmentExpression": {
                this.analyzeExpression(expression.value);
                if (expression.target.kind === "Identifier") {
                    const targetName = expression.target.name;
                    const existingOwnerId = this.lookupOwnerId(targetName);
                    if (expression.operator === "=") {
                        if (
                            expression.value.kind === "PointerExpression" &&
                            expression.value.op === "move" &&
                            expression.value.argument.kind === "Identifier"
                        ) {
                            // Handled if RHS was moved, re-bind target
                            if (this.isUniqueLikeCall(expression.value) || existingOwnerId) {
                                const newId = this.createOwnerId(targetName);
                                this.engine.createOwner(
                                    newId,
                                    targetName,
                                    this.currentScopeId(),
                                    this.location(expression)
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
                                this.location(expression)
                            );
                            this.bindOwner(targetName, newId);
                        }
                    } else if (existingOwnerId) {
                        this.engine.checkUse(existingOwnerId, this.location(expression.target));
                    }
                    return;
                }
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
        this.scopeIds = [];

        this.scopeCounter = 0;
        this.ownerCounter = 0;
        this.borrowCounter = 0;

        this.analysisComplete = true;
    }
}
