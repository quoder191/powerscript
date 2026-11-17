
/**
 * PowerScript Security Engine
 * Central Security Controller
 */

import {
    SecurityPolicy,
    SecurityAnalysisResult,
    SourceLocation,
    BorrowKind,
    DEFAULT_SECURITY_POLICY
} from "./types";

import { DiagnosticBag } from "./diagnostics";
import { OwnershipModel } from "./ownership-model";
import { BorrowChecker } from "./borrow-checker";

export class PowerScriptSecurityEngine {

    readonly diagnostics: DiagnosticBag;
    readonly ownership: OwnershipModel;
    readonly borrowChecker: BorrowChecker;

    readonly policy: SecurityPolicy;

    constructor(policy?: Partial<SecurityPolicy>) {

        this.policy = {
            ...DEFAULT_SECURITY_POLICY,
            ...policy
        };

        this.diagnostics = new DiagnosticBag();

        this.ownership = new OwnershipModel(
            this.diagnostics
        );

        this.borrowChecker = new BorrowChecker(
            this.ownership,
            this.diagnostics
        );
    }

    // Create an owner
    createOwner(
        id: string,
        name: string,
        scopeId: string,
        location?: SourceLocation
    ): void {

        this.ownership.createOwner(
            id,
            name,
            scopeId,
            location
        );
    }

    // Check owner usage
    checkUse(
        id: string,
        location?: SourceLocation
    ): boolean {

        return this.ownership.isUsable(
            id,
            location
        );
    }

    // Move ownership
    move(
        id: string,
        newId: string,
        newName: string,
        location?: SourceLocation
    ): void {

        if (!this.policy.forbidMoveWhileBorrowed &&
            this.ownership.hasActiveBorrows(id)) {
            // Policy permits the operation.
            // OwnershipModel currently rejects it, so this
            // configuration is not supported by this operation.
            this.diagnostics.warning(
                "SEC001",
                "Move-while-borrowed policy is disabled, but the ownership model still enforces this restriction.",
                location
            );
            return;
        }

        this.ownership.moveOwner(
            id,
            newId,
            newName,
            location
        );
    }

    // Create a shared borrow
    borrowShared(
        ownerId: string,
        borrowId: string,
        scopeId: string,
        location?: SourceLocation
    ): boolean {

        if (!this.borrowChecker.checkSharedBorrow(ownerId, location)) {
            return false;
        }

        return this.ownership.borrowOwner(
            ownerId,
            borrowId,
            BorrowKind.SHARED,
            scopeId,
            location
        );
    }

    // Create a mutable borrow
    borrowMutable(
        ownerId: string,
        borrowId: string,
        scopeId: string,
        location?: SourceLocation
    ): boolean {

        if (!this.borrowChecker.checkMutableBorrow(ownerId, location)) {
            return false;
        }

        return this.ownership.borrowOwner(
            ownerId,
            borrowId,
            BorrowKind.MUTABLE,
            scopeId,
            location
        );
    }

    // End a borrow
    endBorrow(
        borrowId: string,
        location?: SourceLocation
    ): void {

        this.ownership.endBorrow(
            borrowId,
            location
        );
    }

    // Drop an owner
    drop(
        id: string,
        location?: SourceLocation
    ): void {

        if (!this.policy.forbidDropWhileBorrowed &&
            this.ownership.hasActiveBorrows(id)) {
            this.diagnostics.warning(
                "SEC002",
                "Drop-while-borrowed policy is disabled, but the ownership model still enforces this restriction.",
                location
            );
            return;
        }

        this.ownership.dropOwner(
            id,
            location
        );
    }

    // Check direct owner mutation
    checkMutation(
        id: string,
        location?: SourceLocation
    ): boolean {

        return this.borrowChecker.checkOwnerMutation(
            id,
            location
        );
    }

    // Check direct owner reading
    checkRead(
        id: string,
        location?: SourceLocation
    ): boolean {

        return this.borrowChecker.checkOwnerRead(
            id,
            location
        );
    }

    // End a scope
    exitScope(scopeId: string): void {

        this.ownership.exitScope(scopeId);
    }

    // Get analysis result
    getResult(): SecurityAnalysisResult {

        const all = this.diagnostics.getAll();

        const errors = this.diagnostics.errorCount;
        const warnings = this.diagnostics.warningCount;

        return {
            success: errors === 0,
            diagnostics: all,
            errorCount: errors,
            warningCount: warnings
        };
    }

    // Reset the engine
    reset(): void {

        this.diagnostics.clear();
        this.ownership.clear();
    }
  }
      
