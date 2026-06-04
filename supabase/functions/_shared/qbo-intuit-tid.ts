// Shared helper for capturing Intuit's `intuit_tid` response header for QBO
// API calls. This ID is required by Intuit support to debug any failed/odd
// API responses, so we log it for every QBO request and include it in
// structured error metadata.
//
// IMPORTANT: never log or include access_token / refresh_token values.

export function getIntuitTid(res: Response | null | undefined): string | null {
  if (!res) return null;
  try {
    // Header lookup is case-insensitive; check common casings just in case.
    return (
      res.headers.get("intuit_tid") ??
      res.headers.get("Intuit-Tid") ??
      res.headers.get("intuit-tid") ??
      null
    );
  } catch {
    return null;
  }
}

export interface QboApiLogFields {
  fn: string;            // logical operation name, e.g. "qbo_invoice_create"
  op?: string;           // sub-op, e.g. "fetch_invoice", "create"
  status: number;
  intuit_tid: string | null;
  realm_id?: string | null;
  tenant_id?: string | null;
  qbo_entity?: string | null;
  qbo_entity_id?: string | null;
  ok: boolean;
}

/**
 * Build a token-safe log payload for a QBO API response.
 * Strips anything that could leak credentials.
 */
export function buildQboApiLog(
  fn: string,
  res: Response,
  extras: Omit<Partial<QboApiLogFields>, "fn" | "status" | "intuit_tid" | "ok"> = {},
): QboApiLogFields {
  return {
    fn,
    op: extras.op,
    status: res.status,
    ok: res.ok,
    intuit_tid: getIntuitTid(res),
    realm_id: extras.realm_id ?? null,
    tenant_id: extras.tenant_id ?? null,
    qbo_entity: extras.qbo_entity ?? null,
    qbo_entity_id: extras.qbo_entity_id ?? null,
  };
}

/**
 * Build an Error whose message embeds the `intuit_tid` and HTTP status, plus
 * a structured metadata object suitable for JSON error responses.
 * Body text is included but truncated; callers should ensure body never
 * contains tokens (QBO API error bodies do not).
 */
export interface QboApiError {
  error: Error;
  metadata: {
    fn: string;
    op?: string;
    status: number;
    intuit_tid: string | null;
    realm_id?: string | null;
    tenant_id?: string | null;
    qbo_entity?: string | null;
    qbo_entity_id?: string | null;
    body_excerpt: string;
  };
}

export function buildQboApiError(
  fn: string,
  res: Response,
  body: string,
  extras: Omit<Partial<QboApiLogFields>, "fn" | "status" | "intuit_tid" | "ok"> = {},
): QboApiError {
  const tid = getIntuitTid(res);
  const excerpt = (body ?? "").slice(0, 500);
  const message =
    `QBO ${fn}${extras.op ? `:${extras.op}` : ""} failed ` +
    `[status=${res.status} intuit_tid=${tid ?? "none"}]: ${excerpt}`;
  return {
    error: new Error(message),
    metadata: {
      fn,
      op: extras.op,
      status: res.status,
      intuit_tid: tid,
      realm_id: extras.realm_id ?? null,
      tenant_id: extras.tenant_id ?? null,
      qbo_entity: extras.qbo_entity ?? null,
      qbo_entity_id: extras.qbo_entity_id ?? null,
      body_excerpt: excerpt,
    },
  };
}
