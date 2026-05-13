// Developer QA helpers — non-blocking warnings in dev only.

export function validateReferralBackendConfig(): string[] {
  const issues: string[] = [];
  if (typeof window === "undefined") return issues;
  if (!window.location.origin.startsWith("http")) issues.push("origin not http(s)");
  return issues;
}

export function validateReferralRoutes(): string[] {
  const issues: string[] = [];
  if (typeof window === "undefined") return issues;
  // Ensure /r/:token (PublicReportViewer) and /ref/:code coexist
  const path = window.location.pathname;
  if (/^\/r\/[^/]+$/.test(path) && /\/ref\//.test(path)) {
    issues.push("path matches both /r/ and /ref/ — routing conflict");
  }
  return issues;
}

export function validateReferralTrackingPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (!payload.referral_code) issues.push("referral_code missing");
  if (!payload.event_type) issues.push("event_type missing");
  return issues;
}

if (import.meta.env?.DEV) {
  const cfg = validateReferralBackendConfig();
  const routes = validateReferralRoutes();
  if (cfg.length) console.warn("[referralQa] config:", cfg);
  if (routes.length) console.warn("[referralQa] routes:", routes);
}
