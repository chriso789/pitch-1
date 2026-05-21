// Spec-named tracking helpers for the Company CRM Signup Referral System.
const VID_KEY = "crm_ref_visitor_id";
const SID_KEY = "crm_ref_session_id";
const ATTR_KEY = "crm_ref_attribution";

function uuid() {
  return (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateCrmReferralVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(VID_KEY);
  if (!id) { id = uuid(); localStorage.setItem(VID_KEY, id); }
  return id;
}

export function getOrCreateCrmReferralSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(SID_KEY);
  if (!id) { id = uuid(); sessionStorage.setItem(SID_KEY, id); }
  return id;
}

export function getCrmReferralTrackingParams() {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const fields = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
  const out: Record<string, string> = {};
  for (const f of fields) { const v = sp.get(f); if (v) out[f] = v; }
  return out;
}

export function storeCompanyReferralAttribution(partner_code: string, ttlDays = 90) {
  if (typeof window === "undefined") return;
  const payload = {
    partner_code,
    visitor_id: getOrCreateCrmReferralVisitorId(),
    session_id: getOrCreateCrmReferralSessionId(),
    clicked_at: Date.now(),
    expires_at: Date.now() + ttlDays * 86400000,
    ...getCrmReferralTrackingParams(),
  };
  localStorage.setItem(ATTR_KEY, JSON.stringify(payload));
}

export function getCompanyReferralAttribution(): any | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ATTR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.expires_at && parsed.expires_at < Date.now()) {
      localStorage.removeItem(ATTR_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

export function clearExpiredCompanyReferralAttribution() {
  const a = getCompanyReferralAttribution();
  if (!a) localStorage.removeItem(ATTR_KEY);
}
