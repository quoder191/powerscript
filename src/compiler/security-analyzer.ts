
/**
 * PowerScript Security Analyzer
 *
 * Performs preliminary AST-based ownership analysis.
 * Uses the existing PowerScript Security Engine.
 *
 * Important:
 * This version handles sequential ownership operations.
 * Full control-flow and lifetime analysis are not yet implemented.
 */

import type {
    ProgramNode,
    StatementNode,
    ExpressionNode,
    VarDeclarationNode
} from "./ast/nodes";

import {
    PowerScriptSecurityEngine
} from "./security-engine";

import type {
    SecurityAnalysisResult,
    SourceLocation
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

    private ownerNames = new Set<string>();

    private scopeCounter = 0;

    private analysisComplete = true;

    private stopOnFirstError: boolean;

    constructor(options: SecurityAnalyzerOptions = {}) {

        this.engine = new PowerScriptSecurityEngine({
            stopOnFirstError: options.stopOnFirstError ?? false
        });

        this.stopOnFirstError =
            options.stopOnFirstError ?? false;
    }

    /**
     * Convert AST position into security source location.
     */
    private location(node: {
        line: number;
        column: number;
    }): SourceLocation {

        return {
            line: node.line,
            column: node.column
        };
    }

    /**
     * Generate unique scope IDs.
     */
    private createScopeId(): string {

        this.scopeCounter++;

        return `powerscript_scope_${this.scopeCounter}`;
    }

    /**
     * Analyze a complete program.
     */
    analyze(program: ProgramNode): SecurityAnalyzerResult {

        this.engine.reset();
        this.ownerNames.clear();

        this.scopeCounter = 0;
        this.analysisComplete = true;

        const rootScope = this.createScopeId();

        this.analyzeStatements(
            program.body,
            rootScope
        );

        this.engine.exitScope(rootScope);

        const result = this.engine.getResult();

        return {
            ...result,
            analysisComplete: this.analysisComplete
        };
    }

    /**
     * Analyze sequential statements.
     */
    private analyzeStatements(
        statements: StatementNode[],
        scopeId: string
    ): void {

        for (const statement of statements) {

            if (
                this.stopOnFirstError &&
                this.engine.diagnostics.hasErrors()
            ) {
                break;
            }

            this.analyzeStatement(statement, scopeId);
        }
    }

    /**
     * Analyze an individual statement.
     */
    private analyzeStatement(
        statement: StatementNode,
        scopeId: string
    ): void {

        switch (statement.kind) {

            case "VarDeclaration":
                this.analyzeVariable(
                    statement,
                    scopeId
                );
                break;

            case "MultiVarDeclaration":

                for (const declaration of statement.declarations) {
                    this.analyzeVariable(
                        declaration,
                        scopeId
                    );
                }

                break;

            case "DropStatement":

                if (statement.target.kind === "Identifier") {

                    const name = statement.target.name;

                    if (this.ownerNames.has(name)) {

                        this.engine.drop(
                            name,
                            this.location(statement)
                        );
                    }
                }

                break;

            case "BlockStatement": {

                const blockScope = this.createScopeId();

                this.analyzeStatements(
                    statement.statements,
                    blockScope
                );

                this.engine.exitScope(blockScope);

                break;
            }

            case "ScopeStatement": {

                const nestedScope = this.createScopeId();

                this.analyzeStatements(
                    statement.body.statements,
                    nestedScope
                );

                this.engine.exitScope(nestedScope);

                break;
            }

            case "ExpressionStatement":

                this.analyzeExpression(
                    statement.expression
                );

                break;

            default:

                /*
                 * Branches, loops, functions, exception
                 * handling and other complex constructs
                 * require control-flow analysis.
                 *
                 * Do not claim that these are verified.
                 */

                this.analysisComplete = false;

                this.engine.diagnostics.warning(
                    "SEC900",
                    `Security analysis is incomplete for '${statement.kind}'.`,
                    this.location(statement),
                    "Full control-flow analysis is required."
                );

                break;
        }
    }

    /**
     * Analyze a variable declaration.
     */
    private analyzeVariable(
        declaration: VarDeclarationNode,
        scopeId: string
    ): void {

        const location = this.location(declaration);

        const initializer = declaration.initializer;

        /*
         * Handle explicit ownership transfer.
         *
         * Example AST:
         * let second = move(first)
         */

        if (
            initializer?.kind === "PointerExpression" &&
            initializer.op === "move" &&
            initializer.argument.kind === "Identifier"
        ) {

            const source = initializer.argument.name;

            if (!this.ownerNames.has(source)) {

                this.engine.diagnostics.error(
                    "SEC003",
                    `Cannot move unknown owner '${source}'.`,
                    location
                );

                return;
            }

            this.engine.move(
                source,
                declaration.name,
                declaration.name,
                location
            );

            this.ownerNames.delete(source);
            this.ownerNames.add(declaration.name);

            return;
        }

        /*
         * Only explicit own and unique declarations
         * are registered as owners in this version.
         */

        if (
            declaration.pointerMode === "own" ||
            declaration.pointerMode === "unique"
        ) {

            this.engine.createOwner(
                declaration.name,
                declaration.name,
                scopeId,
                location
            );

            this.ownerNames.add(declaration.name);

            return;
        }

        if (initializer) {
            this.analyzeExpression(initializer);
        }
    }

    /**
     * Analyze expressions and check known owner usage.
     */
    private analyzeExpression(
        expression: ExpressionNode
    ): void {

        if (expression.kind === "Identifier") {

            if (this.ownerNames.has(expression.name)) {

                this.engine.checkUse(
                    expression.name,
                    this.location(expression)
                );
            }

            return;
        }

        /*
         * Ownership moves inside declarations are handled
         * separately by analyzeVariable().
         */

        if (
            expression.kind === "PointerExpression" &&
            (
                expression.op === "move" ||
                expression.op === "borrow" ||
                expression.op === "shared"
            )
        ) {

            this.analysisComplete = false;

            this.engine.diagnostics.warning(
                "SEC901",
                `Pointer operation '${expression.op}' requires additional ownership analysis.`,
                this.location(expression),
                "Use a supported declaration context or implement full borrow and lifetime analysis."
            );

            this.analyzeExpression(expression.argument);

            return;
        }

        /*
         * Recursively inspect nested AST expressions.
         * Only AST objects with a kind property are visited.
         */

        const visit = (value: unknown): void => {

            if (Array.isArray(value)) {

                for (const item of value) {
                    visit(item);
                }

                return;
            }

            if (
                value === null ||
                typeof value !== "object"
            ) {
                return;
            }

            const object = value as Record<string, unknown>;

            if (
                typeof object.kind === "string"
            ) {
                this.analyzeExpression(
                    object as unknown as ExpressionNode
                );

                return;
            }

            for (const child of Object.values(object)) {
                visit(child);
            }
        };

        for (const [key, value] of Object.entries(expression)) {

            if (
                key === "kind" ||
                key === "line" ||
                key === "column"
            ) {
                continue;
            }

            visit(value);
        }
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

        this.ownerNames.clear();

        this.scopeCounter = 0;

        this.analysisComplete = true;
    }
  }
              
