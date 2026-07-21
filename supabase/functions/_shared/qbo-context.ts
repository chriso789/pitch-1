// Per-connection QBO environment context.
//
// Each qbo_connections row carries an oauth_app_env marker ('development' | 'production').
// Every QBO API call — OAuth code exchange, refresh, revoke, accounting REST, webhook
// verification — must resolve its host + client_id + client_secret + webhook verifier from
// THIS connection's environment, never from a single global env var.
//
// Legacy single-pair env vars (QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_WEBHOOK_VERIFIER_TOKEN,
// QBO_REDIRECT_URI) are still consulted as a fallback when the split *_DEVELOPMENT /
// *_PRODUCTION secrets are not present. A console.warn is emitted on every fallback so we
// can spot non-split deployments in logs.

export type QboMode = "development" | "production";

export interface QboContext {
  mode: QboMode;
  accountingBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookVerifier: string;
  usedLegacyFallback: boolean;
}

const PROD_HOST = "https://quickbooks.api.intuit.com";
const SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";
const PRODUCTION_BRANDED_CALLBACK = "https://pitch-crm.ai/quickbooks-callback.html";

function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.length > 0 ? v : undefined;
}

function hostForMode(mode: QboMode): string {
  return mode === "development" ? SANDBOX_HOST : PROD_HOST;
}

function suffix(mode: QboMode): "DEVELOPMENT" | "PRODUCTION" {
  return mode === "development" ? "DEVELOPMENT" : "PRODUCTION";
}

/**
 * Resolve credentials for an explicit mode. Throws if neither split nor legacy creds exist.
 */
export function getQboContextForMode(mode: QboMode): QboContext {
  const s = suffix(mode);
  const splitClientId = env(`QBO_CLIENT_ID_${s}`);
  const splitClientSecret = env(`QBO_CLIENT_SECRET_${s}`);
  const splitVerifier = env(`QBO_WEBHOOK_VERIFIER_${s}`);
  const splitRedirect = env(`QBO_REDIRECT_URI_${s}`);

  const legacyClientId = env("QBO_CLIENT_ID");
  const legacyClientSecret = env("QBO_CLIENT_SECRET");
  const legacyVerifier = env("QBO_WEBHOOK_VERIFIER_TOKEN") ?? env("QBO_WEBHOOK_VERIFIER");
  const legacyRedirect = env("QBO_REDIRECT_URI");

  const clientId = splitClientId ?? legacyClientId;
  const clientSecret = splitClientSecret ?? legacyClientSecret;
  const webhookVerifier = splitVerifier ?? legacyVerifier ?? "";
  const configuredRedirectUri = splitRedirect ?? legacyRedirect;
  // Intuit's production app settings can reject raw Supabase Edge Function URLs
  // and has also been flaky with SPA fallback-only routes. For production OAuth,
  // advertise the real static callback file registered with Intuit; that page
  // forwards the returned code to qbo-oauth-connect/callback so the exchange
  // still happens server-side with the same redirect_uri value.
  const redirectUri = mode === "production"
    ? PRODUCTION_BRANDED_CALLBACK
    : configuredRedirectUri;

  const usedLegacyFallback =
    (!splitClientId && !!legacyClientId) ||
    (!splitClientSecret && !!legacyClientSecret) ||
    (!splitVerifier && !!legacyVerifier) ||
    (!splitRedirect && !!legacyRedirect);

  if (usedLegacyFallback) {
    console.warn("qbo_context_legacy_fallback", { mode });
  }

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      `qbo_${mode}_credentials_missing: need QBO_CLIENT_ID_${s} / QBO_CLIENT_SECRET_${s} / QBO_REDIRECT_URI_${s} (or legacy single-pair fallback)`,
    );
  }

  return {
    mode,
    accountingBaseUrl: hostForMode(mode),
    clientId,
    clientSecret,
    redirectUri,
    webhookVerifier,
    usedLegacyFallback,
  };
}

/**
 * Resolve credentials for a saved connection row. Prefers oauth_app_env, falls back to
 * is_sandbox, defaults to production.
 */
export function getQboContextForConnection(
  conn: { oauth_app_env?: string | null; is_sandbox?: boolean | null } | null | undefined,
): QboContext {
  const mode: QboMode =
    conn?.oauth_app_env === "development" || conn?.oauth_app_env === "production"
      ? conn.oauth_app_env
      : conn?.is_sandbox === true
        ? "development"
        : "production";
  return getQboContextForMode(mode);
}

/**
 * Default mode used for a brand-new OAuth initiation when the caller did not specify one.
 * Reads QBO_DEFAULT_ENVIRONMENT, then legacy QBO_ENVIRONMENT, then 'development' (safe default
 * during the rollout — flip to 'production' only after smoke testing).
 */
export function getDefaultQboMode(): QboMode {
  const raw =
    (env("QBO_DEFAULT_ENVIRONMENT") ?? env("QBO_ENVIRONMENT") ?? "production").toLowerCase();
  return raw === "development" ? "development" : "production";
}

export function getDefaultQboContext(): QboContext {
  return getQboContextForMode(getDefaultQboMode());
}

/**
 * Probe which environments have credentials available (used by the `verify` action).
 */
export function qboCredentialAvailability(): {
  has_development_credentials: boolean;
  has_production_credentials: boolean;
  has_legacy_credentials: boolean;
} {
  const has = (mode: QboMode) => {
    const s = suffix(mode);
    return !!env(`QBO_CLIENT_ID_${s}`) && !!env(`QBO_CLIENT_SECRET_${s}`);
  };
  return {
    has_development_credentials: has("development"),
    has_production_credentials: has("production"),
    has_legacy_credentials: !!env("QBO_CLIENT_ID") && !!env("QBO_CLIENT_SECRET"),
  };
}

/**
 * Both webhook verifiers, in [development, production] order, with mode tags.
 * Used by the webhook handler to try-verify a signature against both keys.
 */
export function qboWebhookVerifiers(): Array<{ mode: QboMode; verifier: string }> {
  const out: Array<{ mode: QboMode; verifier: string }> = [];
  for (const mode of ["development", "production"] as QboMode[]) {
    try {
      const ctx = getQboContextForMode(mode);
      if (ctx.webhookVerifier) out.push({ mode, verifier: ctx.webhookVerifier });
    } catch {
      // missing creds for this mode — skip
    }
  }
  return out;
}

export const QBO_PROD_HOST = PROD_HOST;
export const QBO_SANDBOX_HOST = SANDBOX_HOST;
