
/**
 * PowerScript Security Engine
 * Ownership Management System
 */

import {
    OwnerState,
    OwnerRecord,
    BorrowRecord,
    BorrowKind,
    SourceLocation
} from "./types";

import { DiagnosticBag } from "./diagnostics";

export class OwnershipModel {

    private owners = new Map<string, OwnerRecord>();
    private borrows = new Map<string, BorrowRecord>();

    private diagnostics: DiagnosticBag;

    constructor(diagnostics: DiagnosticBag) {
        this.diagnostics = diagnostics;
    }

    // ======================================
    // 1. Register a new owner
    // ======================================

    createOwner(
        id: string,
        name: string,
        scopeId: string,
        location?: SourceLocation
    ): void {

        if (this.owners.has(id)) {
            this.diagnostics.error(
                "OWN001",
                `Owner '${name}' already exists.`,
                location
            );
            return;
        }

        this.owners.set(id, {
            id,
            name,
            state: OwnerState.ACTIVE,
            scopeId,
            createdAt: location
        });
    }

    // ======================================
    // 2. Get owner information
    // ======================================

    getOwner(id: string): OwnerRecord | undefined {
        return this.owners.get(id);
    }

    // ======================================
    // 3. Check whether owner is usable
    // ======================================

    isUsable(
        id: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.owners.get(id);

        if (!owner) {
            this.diagnostics.error(
                "OWN002",
                `Owner '${id}' does not exist.`,
                location
            );
            return false;
        }

        if (owner.state === OwnerState.MOVED) {
            this.diagnostics.error(
                "OWN003",
                `Use of '${owner.name}' after move.`,
                location,
                "Use the new owner that received the moved value."
            );
            return false;
        }

        if (owner.state === OwnerState.DROPPED) {
            this.diagnostics.error(
                "OWN004",
                `Use of '${owner.name}' after drop.`,
                location
            );
            return false;
        }

        if (owner.state === OwnerState.INVALID) {
            this.diagnostics.error(
                "OWN005",
                `Owner '${owner.name}' is invalid.`,
                location
            );
            return false;
        }

        return true;
    }

    // ======================================
    // 4. Check active borrows
    // ======================================

    hasActiveBorrows(ownerId: string): boolean {

        for (const borrow of this.borrows.values()) {
            if (
                borrow.ownerId === ownerId &&
                borrow.active
            ) {
                return true;
            }
        }

        return false;
    }

    // ======================================
    // 5. Move ownership
    // ======================================

    moveOwner(
        id: string,
        newId: string,
        newName: string,
        location?: SourceLocation
    ): void {

        const owner = this.owners.get(id);

        if (!owner || !this.isUsable(id, location)) {
            return;
        }

        if (this.owners.has(newId)) {
            this.diagnostics.error(
                "OWN006",
                `Target owner '${newName}' already exists.`,
                location
            );
            return;
        }

        if (this.hasActiveBorrows(id)) {
            this.diagnostics.error(
                "OWN007",
                `Cannot move '${owner.name}' while it is borrowed.`,
                location
            );
            return;
        }

        owner.state = OwnerState.MOVED;
        owner.movedAt = location;

        this.owners.set(newId, {
            id: newId,
            name: newName,
            state: OwnerState.ACTIVE,
            scopeId: owner.scopeId,
            createdAt: location
        });
    }

    // ======================================
    // 6. Borrow an owner
    // ======================================

    borrowOwner(
        ownerId: string,
        borrowId: string,
        kind: BorrowKind,
        scopeId: string,
        location?: SourceLocation
    ): boolean {

        const owner = this.owners.get(ownerId);

        if (!owner || !this.isUsable(ownerId, location)) {
            return false;
        }

        if (this.borrows.has(borrowId)) {
            this.diagnostics.error(
                "OWN008",
                `Borrow '${borrowId}' already exists.`,
                location
            );
            return false;
        }

        const activeBorrows = [...this.borrows.values()].filter(
            borrow =>
                borrow.ownerId === ownerId &&
                borrow.active
        );

        if (kind === BorrowKind.MUTABLE && activeBorrows.length > 0) {
            this.diagnostics.error(
                "OWN009",
                `Cannot create mutable borrow of '${owner.name}' while another borrow exists.`,
                location
            );
            return false;
        }

        if (
            kind === BorrowKind.SHARED &&
            activeBorrows.some(
                borrow => borrow.kind === BorrowKind.MUTABLE
            )
        ) {
            this.diagnostics.error(
                "OWN010",
                `Cannot create shared borrow of '${owner.name}' while a mutable borrow exists.`,
                location
            );
            return false;
        }

        this.borrows.set(borrowId, {
            id: borrowId,
            ownerId,
            kind,
            scopeId,
            active: true,
            createdAt: location
        });

        return true;
    }

    // ======================================
    // 7. End a borrow
    // ======================================

    endBorrow(
        borrowId: string,
        location?: SourceLocation
    ): void {

        const borrow = this.borrows.get(borrowId);

        if (!borrow) {
            this.diagnostics.error(
                "OWN011",
                `Borrow '${borrowId}' does not exist.`,
                location
            );
            return;
        }

        if (!borrow.active) {
            this.diagnostics.error(
                "OWN012",
                `Borrow '${borrowId}' has already ended.`,
                location
            );
            return;
        }

        borrow.active = false;
        borrow.endedAt = location;
    }

    // ======================================
    // 8. Drop an owner
    // ======================================

    dropOwner(
        id: string,
        location?: SourceLocation
    ): void {

        const owner = this.owners.get(id);

        if (!owner || !this.isUsable(id, location)) {
            return;
        }

        if (this.hasActiveBorrows(id)) {
            this.diagnostics.error(
                "OWN013",
                `Cannot drop '${owner.name}' while it is borrowed.`,
                location
            );
            return;
        }

        owner.state = OwnerState.DROPPED;
        owner.droppedAt = location;
    }

    // ======================================
    // 9. Check scope exit
    // ======================================

    exitScope(scopeId: string): void {

        for (const owner of this.owners.values()) {

            if (
                owner.scopeId === scopeId &&
                owner.state === OwnerState.ACTIVE
            ) {
                this.diagnostics.warning(
                    "OWN014",
                    `Owner '${owner.name}' remains active at scope exit.`,
                    owner.createdAt,
                    "Consider explicitly dropping or transferring ownership."
                );
            }
        }

        for (const borrow of this.borrows.values()) {

            if (
                borrow.scopeId === scopeId &&
                borrow.active
            ) {
                this.diagnostics.error(
                    "OWN015",
                    `Borrow '${borrow.id}' remains active at scope exit.`,
                    borrow.createdAt
                );
            }
        }
    }

    // ======================================
    // 10. Get all owners
    // ======================================

    getAllOwners(): OwnerRecord[] {
        return [...this.owners.values()];
    }

    // ======================================
    // 11. Get all borrows
    // ======================================

    getAllBorrows(): BorrowRecord[] {
        return [...this.borrows.values()];
    }

    // ======================================
    // 12. Reset ownership state
    // ======================================

    clear(): void {
        this.owners.clear();
        this.borrows.clear();
    }
              }
