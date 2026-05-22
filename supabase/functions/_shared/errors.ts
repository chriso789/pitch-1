// Standard error codes + HTTP mapping for routed Edge Functions.
// Use with router's jsonErr(c, code, message, status).

export const ErrorCodes = {
  // 4xx
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  no_tenant: 403,
  not_found: 404,
  route_not_found: 404,
  conflict: 409,
  rate_limited: 429,
  // 5xx
  internal_error: 500,
  not_migrated: 501,
  upstream_error: 502,
  shim_forward_failed: 502,
  unavailable: 503,
  timeout: 504,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export function httpFromCode(code: string): number {
  return (ErrorCodes as Record<string, number>)[code] ?? 400;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: ErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = httpFromCode(code);
    this.details = details;
  }
}
