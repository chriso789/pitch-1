export function buildReferralUrl(referralCode: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ref/${referralCode}`;
}

export function buildReferralRewardUrl(referralCode: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ref/${referralCode}/reward`;
}

export function parseReferralCodeFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/ref\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function getReferralTrackingParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const keys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "msclkid",
    "ttclid",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = sp.get(k);
    if (v) out[k] = v;
  }
  return out;
}
