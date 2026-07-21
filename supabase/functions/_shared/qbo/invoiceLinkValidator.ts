// QBO hosted InvoiceLink safety validator.
//
// Rules (Phase 1B, item 3 "URL SAFETY"):
//   - Must be a well-formed absolute https:// URL.
//   - Host must match the configured Intuit hosted-domain allowlist.
//   - Reject javascript:, data:, file:, localhost, private IPs, IP literals.
//   - Never guess or construct a URL — this validator only accepts what QBO returned.
//
// The allowlist is configurable at runtime via the QBO_INVOICE_LINK_ALLOWED_HOSTS
// env var (comma-separated). Intuit occasionally rotates hosted domains; changing
// the env var must not require a DB migration.

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  // Known Intuit / QuickBooks hosted invoice / payment surfaces.
  ".intuit.com",
  ".quickbooks.intuit.com",
  ".quickbooks.com",
  ".payments.intuit.com",
];

const PRIVATE_IPV4_PREFIXES = [
  "10.",
  "127.",
  "169.254.",
  "192.168.",
];

function loadAllowedSuffixes(): string[] {
  const raw = Deno.env.get("QBO_INVOICE_LINK_ALLOWED_HOSTS") ?? "";
  const configured = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(".") ? s : `.${s}`));
  const merged = new Set<string>([...DEFAULT_ALLOWED_HOST_SUFFIXES, ...configured]);
  return Array.from(merged);
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (PRIVATE_IPV4_PREFIXES.some((p) => h.startsWith(p))) return true;
    // 172.16.0.0/12
    const parts = h.split(".").map((n) => Number(n));
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // Bare IP literal — never allowed for a hosted invoice link.
    return true;
  }
  if (h.startsWith("[") && h.endsWith("]")) return true; // bracketed IPv6 literal
  return false;
}

export type InvoiceLinkValidation =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string };

export function validateInvoiceLink(input: unknown): InvoiceLinkValidation {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "empty_or_non_string" };
  }
  const trimmed = input.trim();
  if (trimmed.length > 2048) return { ok: false, reason: "url_too_long" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed_url" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "protocol_not_https" };
  if (parsed.username || parsed.password) return { ok: false, reason: "embedded_credentials" };

  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "missing_host" };
  if (isPrivateOrLoopbackHost(host)) return { ok: false, reason: "private_or_loopback_host" };

  const suffixes = loadAllowedSuffixes();
  const dotted = `.${host}`;
  const allowed = suffixes.some((suffix) => dotted.endsWith(suffix));
  if (!allowed) return { ok: false, reason: "host_not_in_allowlist" };

  return { ok: true, url: parsed.toString(), host };
}

export function allowedInvoiceLinkSuffixes(): string[] {
  return loadAllowedSuffixes();
}
