// Imperva / Incapsula WAF challenge detection.
//
// When ABC's WAF blocks a server-to-server request the upstream response is
// not a real ABC API error — it's an HTML challenge page. `callAbc` uses this
// to inject a stable `499` sentinel status so `mapAbcError` can return
// `abc_waf_blocked` instead of leaking `403` / `503` HTML into audit logs.

export function detectWaf(status: number, text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes("_incapsula_resource")) return true;
  if (t.includes("incident_id") && t.includes("incapsula")) return true;
  if (
    t.includes("incident id") &&
    (t.includes("imperva") || t.includes("incapsula"))
  ) {
    return true;
  }
  if (
    (status === 403 || status === 406 || status === 503) &&
    t.includes("<html") &&
    (t.includes("incapsula") ||
      t.includes("imperva") ||
      t.includes("request unsuccessful"))
  ) {
    return true;
  }
  return false;
}
