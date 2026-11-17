
/**
 * PowerScript Security Engine
 * Core Types and Interfaces
 */

// ==========================================
// 1. Ownership States
// ==========================================

export enum OwnerState {
    ACTIVE = "active",
    MOVED = "moved",
    DROPPED = "dropped",
    INVALID = "invalid"
}

// ==========================================
// 2. Borrowing Types
// ==========================================

export enum BorrowKind {
    SHARED = "shared",
    MUTABLE = "mutable"
}

// ==========================================
// 3. Source Location
// ==========================================

export interface SourceLocation {
    file?: string;
    line: number;
    column: number;
    start?: number;
    end?: number;
}

// ==========================================
// 4. Diagnostic Severity
// ==========================================

export enum DiagnosticSeverity {
    ERROR = "error",
    WARNING = "warning",
    INFO = "info"
}

// ==========================================
// 5. Security Diagnostic
// ==========================================

export interface SecurityDiagnostic {
    code: string;
    message: string;
    severity: DiagnosticSeverity;
    location?: SourceLocation;
    suggestion?: string;
}

// ==========================================
// 6. Owner Record
// ==========================================

export interface OwnerRecord {
    id: string;
    name: string;
    state: OwnerState;

    scopeId: string;

    createdAt?: SourceLocation;
    movedAt?: SourceLocation;
    droppedAt?: SourceLocation;
}

// ==========================================
// 7. Borrow Record
// ==========================================

export interface BorrowRecord {
    id: string;

    ownerId: string;

    kind: BorrowKind;

    scopeId: string;

    active: boolean;

    createdAt?: SourceLocation;
    endedAt?: SourceLocation;
}

// ==========================================
// 8. Security Policy
// ==========================================

export interface SecurityPolicy {

    // Ownership rules
    forbidUseAfterMove: boolean;
    forbidUseAfterDrop: boolean;

    // Borrowing rules
    forbidMoveWhileBorrowed: boolean;
    forbidDropWhileBorrowed: boolean;

    // Borrow lifecycle
    requireExplicitBorrowEnd: boolean;

    // Scope checking
    warnOnOwnerNotConsumedAtScopeExit: boolean;

    // Diagnostic settings
    allowWarnings: boolean;
    stopOnFirstError: boolean;
}

// ==========================================
// 9. Default Security Policy
// ==========================================

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {

    forbidUseAfterMove: true,
    forbidUseAfterDrop: true,

    forbidMoveWhileBorrowed: true,
    forbidDropWhileBorrowed: true,

    requireExplicitBorrowEnd: true,

    warnOnOwnerNotConsumedAtScopeExit: true,

    allowWarnings: true,
    stopOnFirstError: false
};

// ==========================================
// 10. Security Analysis Result
// ==========================================

export interface SecurityAnalysisResult {
    success: boolean;

    diagnostics: SecurityDiagnostic[];

    errorCount: number;
    warningCount: number;
}

// ==========================================
// 11. Security Operation
// ==========================================

export type SecurityOperationType =
    | "create"
    | "use"
    | "move"
    | "drop"
    | "borrow"
    | "endBorrow"
    | "scopeExit";

export interface SecurityOperation {
    type: SecurityOperationType;

    ownerId: string;

    borrowId?: string;

    borrowKind?: BorrowKind;

    scopeId?: string;

    location?: SourceLocation;
}
