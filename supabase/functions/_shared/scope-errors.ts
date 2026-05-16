// ============================================================
// Structured error envelope for every scope edge function.
// ============================================================

export type ScopeErrorCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_NOT_PARSED'
  | 'PARSER_NO_LINE_ITEMS'
  | 'PARSER_LAYOUT_UNKNOWN'
  | 'PARSER_RECONCILIATION_FAILED'
  | 'COMPARE_NO_CARRIER_LINES'
  | 'COMPARE_NO_CONTRACTOR_LINES'
  | 'COMPARE_LOW_CONFIDENCE'
  | 'TENANT_ACCESS_DENIED'
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

export interface ScopeErrorBody {
  success: false;
  error_code: ScopeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

const HTTP_STATUS: Record<ScopeErrorCode, number> = {
  UNAUTHORIZED: 401,
  TENANT_ACCESS_DENIED: 403,
  DOCUMENT_NOT_FOUND: 404,
  DOCUMENT_NOT_PARSED: 409,
  PARSER_NO_LINE_ITEMS: 422,
  PARSER_LAYOUT_UNKNOWN: 422,
  PARSER_RECONCILIATION_FAILED: 422,
  COMPARE_NO_CARRIER_LINES: 422,
  COMPARE_NO_CONTRACTOR_LINES: 422,
  COMPARE_LOW_CONFIDENCE: 422,
  INVALID_INPUT: 400,
  INTERNAL_ERROR: 500,
};

export function scopeError(
  code: ScopeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): { body: ScopeErrorBody; status: number } {
  return {
    body: { success: false, error_code: code, message, details },
    status: HTTP_STATUS[code] ?? 500,
  };
}

export function scopeErrorResponse(
  code: ScopeErrorCode,
  message: string,
  headers: HeadersInit,
  details?: Record<string, unknown>,
): Response {
  const { body, status } = scopeError(code, message, details);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(headers as Record<string, string>), 'Content-Type': 'application/json' },
  });
}
