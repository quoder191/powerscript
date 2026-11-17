
/**
 * PowerScript Security Engine
 * Public API Entry Point
 */

// ==========================================
// 1. Core Types
// ==========================================

export {
    OwnerState,
    BorrowKind,
    DiagnosticSeverity,
    DEFAULT_SECURITY_POLICY
} from "./types";

export type {
    SourceLocation,
    SecurityDiagnostic,
    OwnerRecord,
    BorrowRecord,
    SecurityPolicy,
    SecurityAnalysisResult,
    SecurityOperation,
    SecurityOperationType
} from "./types";

// ==========================================
// 2. Diagnostics
// ==========================================

export {
    DiagnosticBag
} from "./diagnostics";

// ==========================================
// 3. Ownership Model
// ==========================================

export {
    OwnershipModel
} from "./ownership-model";

// ==========================================
// 4. Borrow Checker
// ==========================================

export {
    BorrowChecker
} from "./borrow-checker";

// ==========================================
// 5. Security Engine
// ==========================================

export {
    PowerScriptSecurityEngine
} from "./security-engine";

// ==========================================
// 6. Default Export
// ==========================================

export {
    PowerScriptSecurityEngine as default
} from "./security-engine";
