const VISITOR_KEY = "pitch_referral_visitor_id";
const SESSION_KEY = "pitch_referral_session_id";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getOrCreateReferralVisitorId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

export function getOrCreateReferralSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = uuid();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}
