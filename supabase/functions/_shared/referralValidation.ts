import { normalizeEmail, normalizePhone, validateEmail } from "./referralSecurity.ts";

export interface ReferralLeadPayload {
  referral_code: string;
  referred_first_name: string;
  referred_last_name?: string;
  referred_email?: string;
  referred_phone: string;
  consent_to_contact: boolean;
  [k: string]: unknown;
}

export function validateReferralLeadPayload(payload: any): { ok: true; value: ReferralLeadPayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid_payload" };
  if (!payload.referral_code || typeof payload.referral_code !== "string") return { ok: false, error: "referral_code required" };
  if (!payload.referred_first_name || typeof payload.referred_first_name !== "string") return { ok: false, error: "referred_first_name required" };
  if (!payload.referred_phone || typeof payload.referred_phone !== "string") return { ok: false, error: "referred_phone required" };
  if (payload.consent_to_contact !== true) return { ok: false, error: "consent_to_contact required" };
  if (payload.referred_email && !validateEmail(String(payload.referred_email))) return { ok: false, error: "invalid_email" };

  const phone = normalizePhone(payload.referred_phone);
  if (!phone) return { ok: false, error: "invalid_phone" };

  const value: ReferralLeadPayload = {
    ...payload,
    referred_phone: phone,
    referred_email: normalizeEmail(payload.referred_email as string | undefined) ?? undefined,
    referred_first_name: String(payload.referred_first_name).trim().slice(0, 100),
    referred_last_name: payload.referred_last_name ? String(payload.referred_last_name).trim().slice(0, 100) : undefined,
  };
  return { ok: true, value };
}

export function validatePayoutPreferencePayload(payload: any, settings: any): { ok: true } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid_payload" };
  const method = payload.preferred_payout_method;
  if (!["venmo", "zelle", "gift_card", "stored_balance"].includes(method)) return { ok: false, error: "invalid_method" };
  if (payload.payout_terms_accepted !== true) return { ok: false, error: "terms_required" };
  if (payload.tax_acknowledgment !== true) return { ok: false, error: "tax_acknowledgment_required" };

  if (method === "venmo") {
    if (!settings?.allow_venmo) return { ok: false, error: "method_disabled" };
    if (!payload.venmo_handle) return { ok: false, error: "venmo_handle required" };
  } else if (method === "zelle") {
    if (!settings?.allow_zelle) return { ok: false, error: "method_disabled" };
    if (!payload.zelle_email && !payload.zelle_phone) return { ok: false, error: "zelle contact required" };
    if (payload.zelle_email && !validateEmail(String(payload.zelle_email))) return { ok: false, error: "invalid_zelle_email" };
  } else if (method === "gift_card") {
    if (!settings?.allow_gift_card) return { ok: false, error: "method_disabled" };
    if (!payload.gift_card_email || !validateEmail(String(payload.gift_card_email))) return { ok: false, error: "invalid_gift_card_email" };
  } else if (method === "stored_balance") {
    if (!settings?.allow_stored_balance) return { ok: false, error: "method_disabled" };
  }
  return { ok: true };
}

export function detectSelfReferral(referrerContact: any, payload: ReferralLeadPayload): boolean {
  if (!referrerContact) return false;
  const refPhone = normalizePhone(referrerContact.phone);
  const refEmail = normalizeEmail(referrerContact.email);
  if (refPhone && refPhone === payload.referred_phone) return true;
  if (refEmail && payload.referred_email && refEmail === payload.referred_email) return true;
  return false;
}

export async function detectDuplicateReferral(
  supabase: any,
  tenantId: string,
  payload: ReferralLeadPayload,
  duplicateWindowDays: number,
): Promise<boolean> {
  const sinceIso = new Date(Date.now() - duplicateWindowDays * 86400000).toISOString();
  let q = supabase
    .from("referral_submissions")
    .select("id")
    .eq("tenant_id", tenantId)
    .gte("created_at", sinceIso)
    .limit(1);
  // Match on phone OR email
  const orParts: string[] = [`referred_phone.eq.${payload.referred_phone}`];
  if (payload.referred_email) orParts.push(`referred_email.eq.${payload.referred_email}`);
  q = q.or(orParts.join(","));
  const { data } = await q;
  return !!(data && data.length);
}
