/**
 * PowerScript Security Engine
 * Borrow Checker
 */

import {
    OwnerState,
    BorrowKind,
    SourceLocation
} from "./types";

import { OwnershipModel } from "./ownership-model";
import { DiagnosticBag } from "./diagnostics";

export class BorrowChecker {

    private ownership: OwnershipModel;
    private diagnostics: DiagnosticBag;

    constructor(
        ownership: OwnershipModel,
        diagnostics: DiagnosticBag
    ) {
        this.ownership = ownership;
        this.diagnostics = diagnostics;
    }

    private displayName(ownerId: string): string {
        return this.ownership.getOwner(ownerId)?.name ?? ownerId;
    }

    // ======================================
    // 1. Validate shared borrowing
    // ======================================

    checkSharedBorrow(
        ownerId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR001",
                `Cannot borrow unavailable owner '${this.displayName(ownerId)}'.`,
                location,
                "Ensure the owner has not been moved or dropped before borrowing."
            );
            return false;
        }

        const borrows = this.ownership.getActiveBorrows(ownerId);
        const hasMutableBorrow = borrows.some(
            borrow => borrow.kind === BorrowKind.MUTABLE
        );

        if (hasMutableBorrow) {
            this.diagnostics.error(
                "BOR002",
                `Cannot create shared borrow of '${owner.name}' while a mutable borrow exists.`,
                location,
                "A value cannot have shared readers while an exclusive mutable borrow is active."
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 2. Validate mutable borrowing
    // ======================================

    checkMutableBorrow(
        ownerId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR003",
                `Cannot mutably borrow unavailable owner '${this.displayName(ownerId)}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getActiveBorrows(ownerId);

        if (borrows.length > 0) {
            this.diagnostics.error(
                "BOR004",
                `Cannot create mutable borrow of '${owner.name}' while another borrow exists.`,
                location,
                "End all existing shared or mutable borrows before creating a mutable borrow."
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 3. Validate owner mutation
    // ======================================

    checkOwnerMutation(
        ownerId: string,
        location?: SourceLocation,
        allowInteriorUnderShared = false
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR005",
                `Cannot modify unavailable owner '${this.displayName(ownerId)}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getActiveBorrows(ownerId);
        const hasMutable = borrows.some(b => b.kind === BorrowKind.MUTABLE);

        if (hasMutable || (!allowInteriorUnderShared && borrows.length > 0)) {
            this.diagnostics.error(
                "BOR006",
                `Cannot directly modify '${owner.name}' while it is borrowed.`,
                location,
                "Release active borrows before mutating or rebinding the owner."
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 4. Validate owner reading
    // ======================================

    checkOwnerRead(
        ownerId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR007",
                `Cannot read unavailable owner '${this.displayName(ownerId)}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getActiveBorrows(ownerId);
        const hasMutableBorrow = borrows.some(
            borrow => borrow.kind === BorrowKind.MUTABLE
        );

        if (hasMutableBorrow) {
            this.diagnostics.error(
                "BOR008",
                `Cannot directly read '${owner.name}' while a mutable borrow exists.`,
                location,
                "Read through the mutable borrow or wait until the mutable borrow ends."
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 5. Validate borrow usage
    // ======================================

    checkBorrowUsage(
        borrowId: string,
        location?: SourceLocation
    ): boolean {

        const borrow = this.ownership.getBorrow(borrowId);

        if (!borrow) {
            this.diagnostics.error(
                "BOR009",
                `Borrow '${borrowId}' does not exist.`,
                location
            );
            return false;
        }

        if (!borrow.active) {
            this.diagnostics.error(
                "BOR010",
                `Borrow '${borrowId}' is no longer active (dangling reference).`,
                location,
                "The borrowed owner is no longer accessible through this borrow."
            );
            return false;
        }

        const owner = this.ownership.getOwner(borrow.ownerId);
        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR010",
                `Cannot use borrow of '${this.displayName(borrow.ownerId)}' because the owner was moved or dropped.`,
                location
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 6. Validate mutable borrow access
    // ======================================

    checkMutableBorrowAccess(
        borrowId: string,
        location?: SourceLocation
    ): boolean {

        if (!this.checkBorrowUsage(borrowId, location)) {
            return false;
        }

        const borrow = this.ownership.getBorrow(borrowId);

        if (!borrow || borrow.kind !== BorrowKind.MUTABLE) {
            this.diagnostics.error(
                "BOR011",
                `Cannot mutate through immutable shared borrow of '${this.displayName(borrow?.ownerId ?? borrowId)}'.`,
                location,
                "Use a mutable reference (`mut ref` / `int&`) to mutate borrowed data."
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 7. Validate shared borrow access
    // ======================================

    checkSharedBorrowAccess(
        borrowId: string,
        location?: SourceLocation
    ): boolean {

        if (!this.checkBorrowUsage(borrowId, location)) {
            return false;
        }

        const borrow = this.ownership.getBorrow(borrowId);

        if (!borrow || borrow.kind !== BorrowKind.SHARED) {
            this.diagnostics.error(
                "BOR012",
                `Borrow '${borrowId}' is not shared.`,
                location
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 8. Validate move while borrowed
    // ======================================

    checkMove(
        ownerId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR013",
                `Cannot move unavailable owner '${this.displayName(ownerId)}'.`,
                location
            );
            return false;
        }

        if (this.ownership.hasActiveBorrows(ownerId)) {
            this.diagnostics.error(
                "BOR014",
                `Cannot move '${owner.name}' while active borrows exist.`,
                location
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 9. Validate drop while borrowed
    // ======================================

    checkDrop(
        ownerId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR015",
                `Cannot drop unavailable owner '${this.displayName(ownerId)}'.`,
                location
            );
            return false;
        }

        if (this.ownership.hasActiveBorrows(ownerId)) {
            this.diagnostics.error(
                "BOR016",
                `Cannot drop '${owner.name}' while active borrows exist.`,
                location
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 10. Validate lifetime / dangling reference prevention
    // ======================================

    checkLifetimeEscape(
        ownerId: string,
        targetScopeDepth: number,
        contextDescription: string,
        location?: SourceLocation
    ): boolean {
        const owner = this.ownership.getOwner(ownerId);
        if (!owner) return true;

        if (owner.scopeDepth > targetScopeDepth) {
            this.diagnostics.error(
                "BOR017",
                `Dangling reference: '${owner.name}' does not live long enough (${contextDescription}).`,
                location,
                `Move ownership instead of returning or storing a reference to a shorter-lived local variable '${owner.name}'.`
            );
            return false;
        }

        return true;
    }
}
