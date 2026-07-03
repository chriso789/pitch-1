/**
 * Canonical public app URL for client-facing links (SMS, email, portal).
 *
 * Never returns a lovable.app / lovableproject.com host — those preview URLs
 * must NEVER appear in messages sent to customers. If the configured env
 * points at a lovable domain (leftover from preview), we fall back to the
 * production domain.
 */
const PROD_APP_URL = "https://pitch-crm.ai";

function isLovableHost(url: string): boolean {
  return /lovable\.app|lovableproject\.com/i.test(url);
}

export function getPublicAppUrl(): string {
  const candidates = [
    Deno.env.get("FRONTEND_URL"),
    Deno.env.get("APP_URL"),
    Deno.env.get("PUBLIC_APP_URL"),
  ];
  for (const c of candidates) {
    if (c && !isLovableHost(c)) return c.replace(/\/+$/, "");
  }
  return PROD_APP_URL;
}

export function sanitizePublicUrl(url: string | null | undefined): string {
  if (!url) return PROD_APP_URL;
  return isLovableHost(url) ? PROD_APP_URL : url.replace(/\/+$/, "");
}
