// Stable ABC error-code mapping consumed by both handlers and by the frontend
// (`SupplierPriceState`, `AbcValidateDebug`, order preflight, etc.).
//
// The union type below is the exhaustive contract — do not return codes that
// are not listed here without updating every consumer.

export type AbcErrorCode =
  | "abc_waf_blocked"
  | "abc_network_error"
  | "abc_400_bad_payload"
  | "abc_401_unauthorized"
  | "abc_403_forbidden"
  | "abc_404_not_found"
  | "abc_429_rate_limited"
  | "abc_500_upstream"
  | "invalid_redirect_uri"
  | "invalid_client"
  | "missing_scope"
  | `abc_${number}`;

/** Map ABC/transport errors to stable codes the UI can act on. */
export function mapAbcError(status: number, body: any): string {
  if (status === 499) return "abc_waf_blocked"; // sentinel injected by callAbc on WAF detection
  if (status === 0) return "abc_network_error";
  if (status === 400) return "abc_400_bad_payload";
  if (status === 401) return "abc_401_unauthorized";
  if (status === 403) return "abc_403_forbidden";
  if (status === 404) return "abc_404_not_found";
  if (status === 429) return "abc_429_rate_limited";
  if (status >= 500) return "abc_500_upstream";
  const err = (body?.error || body?.code || "").toString().toLowerCase();
  if (err.includes("redirect_uri")) return "invalid_redirect_uri";
  if (err.includes("invalid_client")) return "invalid_client";
  if (err.includes("scope")) return "missing_scope";
  return `abc_${status}`;
}

/**
 * Human-readable interpretation of a mapped ABC error. Returns `null` when we
 * don't have a canned explanation — callers should fall back to `errorCode`
 * plus the raw upstream body.
 */
export function interpretAbcError(
  errorCode: string | null,
  status: number,
  body: any,
): string | null {
  if (errorCode === "abc_waf_blocked") {
    return "ABC/Imperva blocked the server-to-server request before ABC order validation. The sandbox payload shape is valid; ABC must allowlist the Supabase Edge Function egress/WAF path for this environment.";
  }
  const message = typeof body?.errorMessage === "string" ? body.errorMessage : "";
  if (status === 400 && message) return message;
  return null;
}
