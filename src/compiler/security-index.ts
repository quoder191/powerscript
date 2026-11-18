/**
 * PowerScript Security Engine
 * Public API Entry Point
 */

// ==========================================
// 1. Core Types
// ==========================================

export {
    OwnerState,
    OwnerKind,
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
// 5. Security Engine & Managers
// ==========================================

export {
    PowerScriptSecurityEngine
} from "./security-engine";

export {
    SecurityPolicyManager,
    NetworkPolicyManager,
    isPrivateOrLoopbackHost,
    isPrivateOrReservedIp,
    isPrivateOrReservedIpv4,
    isPrivateOrReservedIpv6,
    parseCanonicalIpv4,
    parseCanonicalIpv6,
    DEFAULT_COMPILER_SECURITY_POLICY,
    DEFAULT_NETWORK_SECURITY_POLICY,
    DEFAULT_GLOBAL_ACCESS_POLICY,
    DEFAULT_TYPE_SAFETY_POLICY,
    DEFAULT_BLOCKED_HEADERS,
    type GlobalThisPolicyMode,
    type NetworkSecurityPolicy,
    type GlobalAccessPolicy,
    type TypeSafetyPolicy,
    type CompilerSecurityPolicy,
    type PartialCompilerSecurityPolicy,
    type FetchValidationResult
} from "./security-policy";

export {
    CapabilitySecurityManager,
    type CapabilitySecurityResult
} from "./capability-security";

// ==========================================
// 6. Default Export
// ==========================================

export {
    PowerScriptSecurityEngine as default
} from "./security-engine";
