
/**
 * PowerScript Security Engine
 * Public Entry Point
 *
 * This file exports all security components.
 */

// Core types and interfaces
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

// Future security component exports
// Uncomment these after creating the respective files.

// export { DiagnosticBag } from "./diagnostics";

// export { OwnershipModel } from "./ownership-model";

// export { BorrowChecker } from "./borrow-checker";

// export { PowerScriptSecurityEngine } from "./security-engine";

// Default export will be added after security-engine.ts exists.
