
/**
 * PowerScript Security Engine
 * Diagnostics Manager
 */

import {
    DiagnosticSeverity,
    SecurityDiagnostic,
    SourceLocation
} from "./types";

export class DiagnosticBag {

    private diagnostics: SecurityDiagnostic[] = [];

    // Add a diagnostic message
    add(diagnostic: SecurityDiagnostic): void {
        this.diagnostics.push(diagnostic);
    }

    // Report an error
    error(
        code: string,
        message: string,
        location?: SourceLocation,
        suggestion?: string
    ): void {
        this.add({
            code,
            message,
            severity: DiagnosticSeverity.ERROR,
            location,
            suggestion
        });
    }

    // Report a warning
    warning(
        code: string,
        message: string,
        location?: SourceLocation,
        suggestion?: string
    ): void {
        this.add({
            code,
            message,
            severity: DiagnosticSeverity.WARNING,
            location,
            suggestion
        });
    }

    // Report informational message
    info(
        code: string,
        message: string,
        location?: SourceLocation,
        suggestion?: string
    ): void {
        this.add({
            code,
            message,
            severity: DiagnosticSeverity.INFO,
            location,
            suggestion
        });
    }

    // Get all diagnostics
    getAll(): SecurityDiagnostic[] {
        return [...this.diagnostics];
    }

    // Get only errors
    getErrors(): SecurityDiagnostic[] {
        return this.diagnostics.filter(
            item => item.severity === DiagnosticSeverity.ERROR
        );
    }

    // Get only warnings
    getWarnings(): SecurityDiagnostic[] {
        return this.diagnostics.filter(
            item => item.severity === DiagnosticSeverity.WARNING
        );
    }

    // Get error count
    get errorCount(): number {
        return this.getErrors().length;
    }

    // Get warning count
    get warningCount(): number {
        return this.getWarnings().length;
    }

    // Check whether errors exist
    hasErrors(): boolean {
        return this.errorCount > 0;
    }

    // Clear all diagnostics
    clear(): void {
        this.diagnostics = [];
    }

    // Get total diagnostic count
    get size(): number {
        return this.diagnostics.length;
    }
          }
