// Shared ABC environment configuration.
//
// Phase 1A — Shared ABC Core. This module is the single source of truth for
// ABC OAuth + API base URLs used by both `abc-api-proxy` (legacy) and
// `supplier-api/abc/proxy` (v2). Neither handler imports this yet; extraction
// happens in Phase 1B once we have production-equivalence tests (Phase 1C).
//
// Every constant here was copied verbatim from the two existing handlers so a
// diff shows byte-for-byte equality with the current production code.

export type Env = "sandbox" | "production";

export interface AbcEnvConfig {
  tokenUrl: string;
  metaUrl: string;
  apiBase: string;
}

export const ABC: Record<Env, AbcEnvConfig> = {
  sandbox: {
    tokenUrl:
      "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
    metaUrl:
      "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/.well-known/oauth-authorization-server",
    apiBase: "https://partners-sb.abcsupply.com/api",
  },
  production: {
    tokenUrl:
      "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
    metaUrl:
      "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/.well-known/oauth-authorization-server",
    apiBase: "https://partners.abcsupply.com/api",
  },
};

export const AUTH_URLS: Record<Env, string> = {
  sandbox:
    "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize",
  production:
    "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize",
};

export const DEFAULT_SCOPES =
  "pricing.read order.read order.write product.read account.read location.read offline_access";

/**
 * Compute the canonical redirect URI for the ABC Okta app.
 * Must match the URL handled by `abc-oauth-callback`.
 */
export function canonicalRedirectUri(
  supabaseUrl: string = Deno.env.get("SUPABASE_URL") ??
    "https://alxelfrbjzkmtnsulcei.supabase.co",
): string {
  return `${supabaseUrl}/functions/v1/abc-oauth-callback`;
}

/** Coerce arbitrary strings into a valid ABC environment. */
export function normalizeEnv(env?: string | null): Env {
  return env === "production" ? "production" : "sandbox";
}
