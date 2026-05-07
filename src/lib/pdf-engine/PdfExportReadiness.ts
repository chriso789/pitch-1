/**
 * PITCH PDF Export Readiness Checker
 * Validates that a document is safe to export as finalized PDF.
 * Returns blockers (hard stops) and warnings (allow with confirmation).
 */

export interface ExportReadinessInput {
  unresolvedSmartFields: string[];
  redactionVerificationPassed: boolean | null;
  hasRedactions: boolean;
  ocrPendingPages: number[];
  missingFonts: string[];
  overflowWarnings: number;
  lockedRequiredFields: string[];
  emptyRequiredFormFields: string[];
  totalOperations: number;
  documentTitle: string;
}

export interface ExportReadinessResult {
  ready: boolean;
  blockers: ExportBlocker[];
  warnings: ExportWarning[];
}

export interface ExportBlocker {
  code: string;
  message: string;
  severity: 'critical';
}

export interface ExportWarning {
  code: string;
  message: string;
  severity: 'warning';
}

export class PdfExportReadiness {
  static check(input: ExportReadinessInput): ExportReadinessResult {
    const blockers: ExportBlocker[] = [];
    const warnings: ExportWarning[] = [];

    // BLOCKERS — prevent export

    if (input.hasRedactions && input.redactionVerificationPassed === false) {
      blockers.push({
        code: 'REDACTION_FAILED',
        message: 'Redaction verification failed — redacted text may still be accessible',
        severity: 'critical',
      });
    }

    if (input.hasRedactions && input.redactionVerificationPassed === null) {
      blockers.push({
        code: 'REDACTION_UNVERIFIED',
        message: 'Redactions have not been verified — run verification before export',
        severity: 'critical',
      });
    }

    if (input.lockedRequiredFields.length > 0) {
      blockers.push({
        code: 'LOCKED_FIELDS',
        message: `${input.lockedRequiredFields.length} required field(s) are locked without values`,
        severity: 'critical',
      });
    }

    if (input.emptyRequiredFormFields.length > 0) {
      blockers.push({
        code: 'EMPTY_FORM_FIELDS',
        message: `${input.emptyRequiredFormFields.length} required form field(s) are empty: ${input.emptyRequiredFormFields.slice(0, 3).join(', ')}`,
        severity: 'critical',
      });
    }

    // WARNINGS — allow with confirmation

    if (input.unresolvedSmartFields.length > 0) {
      warnings.push({
        code: 'UNRESOLVED_FIELDS',
        message: `${input.unresolvedSmartFields.length} smart field(s) unresolved: ${input.unresolvedSmartFields.slice(0, 3).join(', ')}`,
        severity: 'warning',
      });
    }

    if (input.ocrPendingPages.length > 0) {
      warnings.push({
        code: 'OCR_PENDING',
        message: `OCR pending on ${input.ocrPendingPages.length} page(s)`,
        severity: 'warning',
      });
    }

    if (input.missingFonts.length > 0) {
      warnings.push({
        code: 'MISSING_FONTS',
        message: `${input.missingFonts.length} font(s) missing — fallbacks will be used`,
        severity: 'warning',
      });
    }

    if (input.overflowWarnings > 0) {
      warnings.push({
        code: 'TEXT_OVERFLOW',
        message: `${input.overflowWarnings} text overflow warning(s) — text may be clipped`,
        severity: 'warning',
      });
    }

    if (input.totalOperations === 0) {
      warnings.push({
        code: 'NO_OPERATIONS',
        message: 'No operations applied — exporting original document',
        severity: 'warning',
      });
    }

    return {
      ready: blockers.length === 0,
      blockers,
      warnings,
    };
  }
}
