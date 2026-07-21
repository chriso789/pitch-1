/**
 * QBO Multi-Tenant Isolation — Test Configuration
 *
 * All tenant values are loaded from environment variables. Nothing is hardcoded.
 * A missing value for a given tenant marks its live-connection tests as BLOCKED
 * instead of failing.
 *
 * Required for DB-only isolation tests (PHASE M3):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Required for authenticated worker tests (PHASE M5):
 *   TENANT_A_JWT, TENANT_A_TENANT_ID, TENANT_A_QBO_CONNECTION_ID,
 *   TENANT_A_REALM_ID, TENANT_A_OAUTH_APP_ENV
 *   (same for TENANT_B_*)
 *
 * Required for webhook signature tests (PHASE M4):
 *   QBO_WEBHOOK_VERIFIER_DEVELOPMENT and/or QBO_WEBHOOK_VERIFIER_PRODUCTION
 */

export interface TenantConfig {
  label: "A" | "B";
  jwt: string | null;
  tenantId: string | null;
  qboConnectionId: string | null;
  realmId: string | null;
  oauthAppEnv: "development" | "production" | null;
}

function readTenant(label: "A" | "B"): TenantConfig {
  const prefix = `TENANT_${label}_`;
  const env = (k: string) => process.env[prefix + k] ?? null;
  const oauth = env("OAUTH_APP_ENV");
  return {
    label,
    jwt: env("JWT"),
    tenantId: env("TENANT_ID"),
    qboConnectionId: env("QBO_CONNECTION_ID"),
    realmId: env("REALM_ID"),
    oauthAppEnv:
      oauth === "development" || oauth === "production" ? oauth : null,
  };
}

export const TENANT_A = readTenant("A");
export const TENANT_B = readTenant("B");

export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const WEBHOOK_VERIFIER_DEV = process.env.QBO_WEBHOOK_VERIFIER_DEVELOPMENT ?? null;
export const WEBHOOK_VERIFIER_PROD = process.env.QBO_WEBHOOK_VERIFIER_PRODUCTION ?? null;

export function edgeUrl(fn: string): string {
  return `${SUPABASE_URL}/functions/v1/${fn}`;
}

export function tenantIsLiveReady(t: TenantConfig): boolean {
  return !!(t.jwt && t.tenantId && t.qboConnectionId && t.realmId && t.oauthAppEnv);
}

export function requireServiceRole(): { url: string; key: string } | null {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  return { url: SUPABASE_URL, key: SERVICE_ROLE_KEY };
}
