// Shared Telnyx response classifier + retry-delay calculator.
//
// Repair #2: turn Telnyx 429 / rate-limit rejections into a structured
// "retryable" signal so the blast processor can safely release the claim
// back to pending with a calculated next_attempt_at, instead of marking
// the row failed or leaving it stuck in `claimed`.
//
// The classifier prefers structured fields (status, headers, error codes)
// over parsing free-form text, but falls back to text parsing if that is
// the only signal available.

// ---------- Types ----------

export type TelnyxErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'connection_error'
  | 'server_error'
  | 'invalid_destination'
  | 'destination_not_permitted'
  | 'invalid_sender'
  | 'malformed_request'
  | 'opt_out'
  | 'compliance'
  | 'unknown';

export interface TelnyxNormalizedError {
  is_rate_limited: boolean;
  is_retryable: boolean;
  is_permanent: boolean;
  category: TelnyxErrorCategory;
  retry_after_ms: number | null;
  provider_status: number | null;
  provider_error_code: string | null;
  provider_error_message: string | null;
  provider_request_id: string | null;
}

export interface ClassifyInput {
  status?: number | null;
  headers?: Record<string, string> | Headers | null;
  body?: unknown;
  networkError?: unknown; // set when the fetch itself threw (no HTTP response)
}

export interface BackoffConfig {
  baseMs: number;         // default 5000
  maxMs: number;          // default 15 * 60 * 1000
  minMs: number;          // default 1000
  jitterRatio: number;    // default 0.25 (±25%)
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 5_000,
  maxMs: 15 * 60 * 1000,
  minMs: 1_000,
  jitterRatio: 0.25,
};

// Existing retry ceiling is not defined elsewhere for blast items, so we set
// a conservative default. Consumer may override.
export const DEFAULT_RATE_LIMIT_RETRY_CEILING = 8;

// ---------- Header helpers ----------

function getHeader(headers: Headers | Record<string, string> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const lname = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(lname);
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lname && typeof v === 'string') return v;
  }
  return null;
}

// ---------- Retry-After parsing ----------
// Accepts:
//   * integer seconds        → "5"
//   * HTTP-date              → "Wed, 21 Oct 2015 07:28:00 GMT"
//   * structured retry_after_ms in body
//   * "Retry after 500ms" style free-form messages
export function parseRetryAfterHeader(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // integer seconds?
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  }
  // decimal seconds?
  if (/^\d+\.\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  }
  // HTTP-date
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return Math.max(0, delta);
  }
  return null;
}

export function parseRetryFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  // "Retry after 500ms", "retry after 2s", "please retry in 30 seconds"
  const msMatch = text.match(/retry[^0-9]{0,20}(\d+)\s*ms/i);
  if (msMatch) return Number(msMatch[1]);
  const secMatch = text.match(/retry[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (secMatch) return Math.round(Number(secMatch[1]) * 1000);
  const inMatch = text.match(/in\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (inMatch) return Math.round(Number(inMatch[1]) * 1000);
  return null;
}

// ---------- Body inspection ----------
function extractFromBody(body: unknown): {
  code: string | null;
  title: string | null;
  detail: string | null;
  retry_after_ms: number | null;
} {
  if (!body || typeof body !== 'object') return { code: null, title: null, detail: null, retry_after_ms: null };
  const b = body as Record<string, any>;
  // Telnyx v2 error shape: { errors: [{ code, title, detail, meta: {...} }], ... }
  const errArr = Array.isArray(b.errors) ? b.errors : [];
  const first = errArr[0] || {};
  const code = first.code != null ? String(first.code) : null;
  const title = first.title != null ? String(first.title) : null;
  const detail = first.detail != null ? String(first.detail) : null;

  // Structured retry hints Telnyx has been observed to return.
  let retry_after_ms: number | null = null;
  const meta = first.meta && typeof first.meta === 'object' ? first.meta : null;
  // [value, unit] — unit tells us whether a numeric value is already ms or seconds.
  const candidates: Array<[unknown, 'ms' | 'sec' | 'auto']> = [
    [b.retry_after_ms, 'ms'], [b.retryAfterMs, 'ms'], [b.retry_after, 'auto'],
    [meta?.retry_after_ms, 'ms'], [meta?.retryAfterMs, 'ms'], [meta?.retry_after, 'auto'],
    [first.retry_after_ms, 'ms'], [first.retryAfterMs, 'ms'], [first.retry_after, 'auto'],
  ];
  for (const [c, unit] of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
      if (unit === 'ms') retry_after_ms = Math.round(c);
      else if (unit === 'sec') retry_after_ms = Math.round(c * 1000);
      else retry_after_ms = c < 1000 ? Math.round(c * 1000) : Math.round(c); // auto
      break;
    }
    if (typeof c === 'string') {
      const parsed = parseRetryAfterHeader(c) ?? parseRetryFromText(c);
      if (parsed != null) { retry_after_ms = parsed; break; }
    }
  }
  return { code, title, detail, retry_after_ms };
}

// ---------- Category detection ----------

const PERMANENT_CODE_HINTS = new Set([
  '40001', // Bad request / malformed
  '40002', '40003', '40004',
  '40300', // Forbidden by profile
  '40301',
  '40004',
]);

function isKnownPermanentCategory(code: string | null, text: string | null): TelnyxErrorCategory | null {
  const hay = `${code || ''} ${text || ''}`.toLowerCase();
  if (/opted\s*out|stop keyword|stop\s*received/.test(hay)) return 'opt_out';
  if (/canadian|not permitted for destination|destination not permitted|country not allowed/.test(hay)) return 'destination_not_permitted';
  if (/invalid (destination|to number|recipient)|invalid phone number/.test(hay)) return 'invalid_destination';
  if (/invalid (source|from) number|invalid sender/.test(hay)) return 'invalid_sender';
  if (/malformed|invalid request|schema/.test(hay)) return 'malformed_request';
  if (/compliance|10dlc|brand rejected/.test(hay)) return 'compliance';
  return null;
}

function isRateLimitSignal(status: number | null, code: string | null, text: string | null): boolean {
  if (status === 429) return true;
  const hay = `${code || ''} ${text || ''}`.toLowerCase();
  // Telnyx codes commonly seen for throttling / rate limiting.
  if (code && /^(10000|10008|10009|40004(2)?|429\d*)$/.test(code)) {
    // 40004 alone can be generic; require text confirmation.
    if (code === '40004' && !/rate\s*limit|throttl/i.test(hay)) return false;
    return true;
  }
  return /rate[\s-]?limit(ed)?|throttl(ed|ing)?|too many requests|slow down/.test(hay);
}

// ---------- Main classifier ----------

export function classifyTelnyxResponse(input: ClassifyInput): TelnyxNormalizedError {
  const { status = null, headers = null, body = null, networkError = null } = input;

  // Network / fetch-level failure before any HTTP response
  if (networkError) {
    const msg = String((networkError as any)?.message || networkError);
    const isTimeout = /timeout|timed? out|deadline|ETIMEDOUT/i.test(msg);
    return {
      is_rate_limited: false,
      is_retryable: true, // treat transport failures as retryable
      is_permanent: false,
      category: isTimeout ? 'timeout' : 'connection_error',
      retry_after_ms: null,
      provider_status: null,
      provider_error_code: null,
      provider_error_message: msg.slice(0, 500),
      provider_request_id: null,
    };
  }

  const parsed = extractFromBody(body);
  const bodyText = [parsed.title, parsed.detail].filter(Boolean).join(' ') || null;
  const requestId =
    getHeader(headers, 'x-request-id') ||
    getHeader(headers, 'x-telnyx-request-id') ||
    (body && typeof body === 'object' ? String((body as any).request_id || '') || null : null);

  const headerRetry = parseRetryAfterHeader(getHeader(headers, 'retry-after'));
  const rateLimited = isRateLimitSignal(status, parsed.code, bodyText);

  if (rateLimited) {
    const retry =
      headerRetry ??
      parsed.retry_after_ms ??
      parseRetryFromText(bodyText);
    return {
      is_rate_limited: true,
      is_retryable: true,
      is_permanent: false,
      category: 'rate_limit',
      retry_after_ms: retry,
      provider_status: status,
      provider_error_code: parsed.code,
      provider_error_message: (bodyText || 'rate_limited').slice(0, 500),
      provider_request_id: requestId,
    };
  }

  // Permanent categories
  const permanent = isKnownPermanentCategory(parsed.code, bodyText);
  if (permanent) {
    return {
      is_rate_limited: false,
      is_retryable: false,
      is_permanent: true,
      category: permanent,
      retry_after_ms: null,
      provider_status: status,
      provider_error_code: parsed.code,
      provider_error_message: (bodyText || permanent).slice(0, 500),
      provider_request_id: requestId,
    };
  }

  // 5xx → retryable
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return {
      is_rate_limited: false,
      is_retryable: true,
      is_permanent: false,
      category: 'server_error',
      retry_after_ms: headerRetry,
      provider_status: status,
      provider_error_code: parsed.code,
      provider_error_message: (bodyText || `HTTP ${status}`).slice(0, 500),
      provider_request_id: requestId,
    };
  }

  // Success
  if (typeof status === 'number' && status >= 200 && status < 300) {
    return {
      is_rate_limited: false,
      is_retryable: false,
      is_permanent: false,
      category: 'unknown',
      retry_after_ms: null,
      provider_status: status,
      provider_error_code: null,
      provider_error_message: null,
      provider_request_id: requestId,
    };
  }

  // Everything else: treat as permanent unknown (do not requeue by default).
  return {
    is_rate_limited: false,
    is_retryable: false,
    is_permanent: true,
    category: 'unknown',
    retry_after_ms: null,
    provider_status: status,
    provider_error_code: parsed.code,
    provider_error_message: (bodyText || `HTTP ${status ?? 'unknown'}`).slice(0, 500),
    provider_request_id: requestId,
  };
}

// ---------- Backoff ----------

export function computeRetryDelayMs(
  providerRetryMs: number | null,
  attemptCount: number,
  config: Partial<BackoffConfig> = {},
  rand: () => number = Math.random,
): number {
  const cfg = { ...DEFAULT_BACKOFF, ...config };

  // 1. Provider-directed delay wins if present.
  if (providerRetryMs != null && Number.isFinite(providerRetryMs) && providerRetryMs >= 0) {
    return Math.max(cfg.minMs, Math.min(cfg.maxMs, Math.round(providerRetryMs)));
  }

  // 2. Bounded exponential backoff with jitter.
  const n = Math.max(1, Math.min(attemptCount || 1, 20));
  const raw = cfg.baseMs * Math.pow(2, n - 1);
  const capped = Math.min(cfg.maxMs, raw);
  const jitterAmp = capped * cfg.jitterRatio;
  const jitter = (rand() * 2 - 1) * jitterAmp; // ±jitterAmp
  const delay = Math.round(capped + jitter);
  return Math.max(cfg.minMs, Math.min(cfg.maxMs, delay));
}

export function computeNextAttemptAt(
  providerRetryMs: number | null,
  attemptCount: number,
  config: Partial<BackoffConfig> = {},
): { nextAttemptAt: Date; delayMs: number } {
  const delayMs = computeRetryDelayMs(providerRetryMs, attemptCount, config);
  return {
    nextAttemptAt: new Date(Date.now() + delayMs),
    delayMs,
  };
}

// ---------- Repair #3: Destination country helpers ----------
//
// Telnyx returns permanent-destination rejections (e.g. Canadian NANP numbers
// on a US-only messaging profile) that must never be retried. We derive a
// coarse ISO country code from the E.164 recipient so the processor can
// tag quarantined rows for reporting.

// Non-exhaustive list of Canadian NANP area codes (as of 2025). If a `+1`
// number matches this set we treat it as CA. Everything else defaults to US.
const CA_AREA_CODES = new Set<string>([
  '204','226','236','249','250','263','289','306','343','354','365','367','368',
  '382','387','403','416','418','428','431','437','438','450','468','474','506',
  '514','519','548','579','581','584','587','604','613','639','647','672','683',
  '705','709','742','753','778','780','782','807','819','825','867','873','879',
  '902','905',
]);

export function deriveCountryFromE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const p = String(phone).trim();
  if (!p.startsWith('+')) return null;
  const digits = p.slice(1).replace(/\D/g, '');
  if (!digits) return null;
  // NANP (+1)
  if (digits.startsWith('1') && digits.length >= 4) {
    const area = digits.slice(1, 4);
    return CA_AREA_CODES.has(area) ? 'CA' : 'US';
  }
  // Fallback: return the calling code as pseudo-ISO so we still record something.
  // Most single-digit / two-digit CCs map to a single country; the operator will
  // enrich in reporting if needed.
  const cc = digits.slice(0, 3);
  return `+${cc}`;
}

// Try to pull an explicit country hint out of a provider error message when
// the classifier tagged it as `destination_not_permitted`.
export function extractCountryFromErrorText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/canad(a|ian)/.test(t)) return 'CA';
  if (/mexic(o|an)/.test(t)) return 'MX';
  if (/united kingdom|\bu\.?k\.?\b/.test(t)) return 'GB';
  return null;
}
