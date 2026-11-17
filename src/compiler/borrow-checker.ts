
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
                `Cannot borrow unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getAllBorrows().filter(
            borrow =>
                borrow.ownerId === ownerId &&
                borrow.active
        );

        const hasMutableBorrow = borrows.some(
            borrow => borrow.kind === BorrowKind.MUTABLE
        );

        if (hasMutableBorrow) {
            this.diagnostics.error(
                "BOR002",
                `Cannot create shared borrow while a mutable borrow exists.`,
                location
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
                `Cannot mutably borrow unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getAllBorrows().filter(
            borrow =>
                borrow.ownerId === ownerId &&
                borrow.active
        );

        if (borrows.length > 0) {
            this.diagnostics.error(
                "BOR004",
                `Cannot create mutable borrow while another borrow exists.`,
                location
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
        location?: SourceLocation
    ): boolean {

        const owner = this.ownership.getOwner(ownerId);

        if (!owner || owner.state !== OwnerState.ACTIVE) {
            this.diagnostics.error(
                "BOR005",
                `Cannot modify unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getAllBorrows().filter(
            borrow =>
                borrow.ownerId === ownerId &&
                borrow.active
        );

        if (borrows.length > 0) {
            this.diagnostics.error(
                "BOR006",
                `Cannot directly modify an owner while it is borrowed.`,
                location
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
                `Cannot read unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        const borrows = this.ownership.getAllBorrows().filter(
            borrow =>
                borrow.ownerId === ownerId &&
                borrow.active
        );

        const hasMutableBorrow = borrows.some(
            borrow => borrow.kind === BorrowKind.MUTABLE
        );

        if (hasMutableBorrow) {
            this.diagnostics.error(
                "BOR008",
                `Cannot directly read owner while a mutable borrow exists.`,
                location
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

        const borrow = this.ownership.getAllBorrows().find(
            item => item.id === borrowId
        );

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
                `Borrow '${borrowId}' is no longer active.`,
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

        const borrow = this.ownership.getAllBorrows().find(
            item => item.id === borrowId
        );

        if (!borrow || borrow.kind !== BorrowKind.MUTABLE) {
            this.diagnostics.error(
                "BOR011",
                `Borrow '${borrowId}' is not mutable.`,
                location
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

        const borrow = this.ownership.getAllBorrows().find(
            item => item.id === borrowId
        );

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
                `Cannot move unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        if (this.ownership.hasActiveBorrows(ownerId)) {
            this.diagnostics.error(
                "BOR014",
                `Cannot move owner while active borrows exist.`,
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
                `Cannot drop unavailable owner '${ownerId}'.`,
                location
            );
            return false;
        }

        if (this.ownership.hasActiveBorrows(ownerId)) {
            this.diagnostics.error(
                "BOR016",
                `Cannot drop owner while active borrows exist.`,
                location
            );
            return false;
        }

        return true;
    }
        }
          
