// Pure helper functions for create-lead-with-contact.
// Exported separately so they can be unit-tested without booting the function.

export const LEAD_SOURCE_ENUM = [
  "referral",
  "canvassing",
  "online",
  "advertisement",
  "social_media",
  "other",
] as const;

export const ROOF_TYPE_ENUM = [
  "shingle",
  "metal",
  "tile",
  "flat",
  "slate",
  "cedar",
  "other",
  "vinyl_siding",
  "fiber_cement_siding",
  "aluminum_siding",
  "wood_siding",
  "engineered_wood_siding",
  "stucco",
  "stone_veneer",
  "brick_veneer",
  "insulated_vinyl_siding",
] as const;

export const PIPELINE_STATUS_ENUM = [
  "lead",
  "legal_review",
  "contingency_signed",
  "project",
  "completed",
  "closed",
  "lost",
  "canceled",
  "duplicate",
  "hold_mgr_review",
  "legal",
  "contingency",
  "ready_for_approval",
  "production",
  "final_payment",
] as const;

export function mapLeadSource(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if ((LEAD_SOURCE_ENUM as readonly string[]).includes(v)) return v;
  const mapping: Record<string, string> = {
    google_ads: "online",
    "google ads": "online",
    facebook_ads: "social_media",
    "facebook ads": "social_media",
    facebook: "social_media",
    instagram: "social_media",
    tiktok: "social_media",
    door_knocking: "canvassing",
    "door knocking": "canvassing",
    knock: "canvassing",
    yard_sign: "advertisement",
    "yard sign": "advertisement",
    direct_mail: "advertisement",
    "direct mail": "advertisement",
    website: "online",
    web: "online",
    seo: "online",
  };
  return mapping[v] || "other";
}

export function mapRoofType(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if ((ROOF_TYPE_ENUM as readonly string[]).includes(v)) return v;
  const mapping: Record<string, string> = {
    asphalt: "shingle",
    asphalt_shingle: "shingle",
    "asphalt shingle": "shingle",
    "asphalt shingles": "shingle",
    shingles: "shingle",
    composition: "shingle",
    comp: "shingle",
    architectural: "shingle",
    "3-tab": "shingle",
    "three tab": "shingle",
    wood: "cedar",
    wood_shake: "cedar",
    "wood shake": "cedar",
    shake: "cedar",
    clay: "tile",
    concrete: "tile",
    "concrete tile": "tile",
    "clay tile": "tile",
    tpo: "flat",
    epdm: "flat",
    rubber: "flat",
    modified_bitumen: "flat",
    "modified bitumen": "flat",
    "built up": "flat",
    "low slope": "flat",
    vinyl: "vinyl_siding",
    siding: "vinyl_siding",
    "fiber cement": "fiber_cement_siding",
    hardie: "fiber_cement_siding",
    aluminum: "aluminum_siding",
    stone: "stone_veneer",
    brick: "brick_veneer",
  };
  return mapping[v] || "other";
}

export function mapStatus(value: string | null | undefined): string {
  if (!value) return "lead";
  const v = String(value).toLowerCase().trim();
  if ((PIPELINE_STATUS_ENUM as readonly string[]).includes(v)) return v;
  const mapping: Record<string, string> = {
    new: "lead",
    new_lead: "lead",
    "new lead": "lead",
    qualified: "lead",
    contracted: "contingency_signed",
    signed: "contingency_signed",
    in_production: "production",
    "in production": "production",
    done: "completed",
    won: "completed",
    paid: "final_payment",
  };
  return mapping[v] || "lead";
}

// Normalize phone to E.164-ish digits (strip everything non-digit; keep last 10)
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return null;
  // Keep last 10 digits for US matching; preserves uniqueness across +1 prefix variants
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Detect obvious placeholder / junk phone numbers that should NOT trigger
// duplicate-contact matching (e.g. 1111111111, 0000000000, 1234567890,
// 5555555555). Real customers never have these.
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  const n = normalizePhone(phone);
  if (!n) return true;
  if (/^(\d)\1+$/.test(n)) return true; // all same digit
  if (n === "1234567890" || n === "0123456789") return true;
  if (n === "9876543210") return true;
  if (/^555\d{7}$/.test(n)) return true; // 555-xxxxxxx test range
  return false;
}


export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// Structured error response shape used by the edge function.
export interface StructuredError {
  code: string;
  field?: string;
  message: string;
  details?: Record<string, unknown>;
}

export function errorResponse(
  err: StructuredError,
  status = 400,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ success: false, error: err }),
    {
      status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    },
  );
}
