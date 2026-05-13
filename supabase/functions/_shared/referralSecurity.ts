// Shared utilities for referral edge functions.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

export const referralCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function getSupabaseAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...referralCors, "Content-Type": "application/json" },
  });
}

export function getRequestIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("REFERRAL_IP_HASH_SALT") ?? "pitch-default-salt";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function makeVisitorSafeMetadata(metadata: any): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.length > 2000) continue;
    safe[k] = v;
  }
  return safe;
}

export async function resolveReferralLinkByCode(supabase: any, referralCode: string) {
  const { data, error } = await supabase
    .from("referral_codes")
    .select("*")
    .eq("code", referralCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function assertCompanyAccess(
  supabase: any,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, active_tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.tenant_id === tenantId || profile?.active_tenant_id === tenantId) return true;

  const { data: access } = await supabase
    .from("user_company_access")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (access) return true;

  const { data: master } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  return !!master;
}

export function parseUaLite(ua?: string | null) {
  if (!ua) return { device_type: null, browser: null, os: null };
  const u = ua.toLowerCase();
  const device_type = /mobile|iphone|android.*mobile/.test(u)
    ? "mobile"
    : /ipad|tablet/.test(u)
      ? "tablet"
      : "desktop";
  const browser = /edg/.test(u)
    ? "edge"
    : /chrome/.test(u)
      ? "chrome"
      : /safari/.test(u)
        ? "safari"
        : /firefox/.test(u)
          ? "firefox"
          : null;
  const os = /windows/.test(u)
    ? "windows"
    : /mac os/.test(u)
      ? "macos"
      : /android/.test(u)
        ? "android"
        : /iphone|ipad|ios/.test(u)
          ? "ios"
          : /linux/.test(u)
            ? "linux"
            : null;
  return { device_type, browser, os };
}
