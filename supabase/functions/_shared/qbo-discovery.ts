// QBO OpenID Connect discovery-document loader.
//
// Intuit's publishing requirements state:
//   "Use the discovery document to get the latest endpoints for the OAuth2.0 flow."
//
// Rather than hardcoding `authorize` / `token` / `revoke` URLs (which Intuit
// may relocate), we fetch the endpoints from Intuit's OpenID discovery
// document once per function instance and cache them for 24h. On failure we
// fall back to the historical constants so a transient discovery outage
// cannot break a live connection.
//
// Sandbox and production have separate discovery documents. Pick by
// `QboMode` (matches oauth_app_env stored on qbo_connections).

import type { QboMode } from "./qbo-context.ts";

const DISCOVERY_URLS: Record<QboMode, string> = {
  production:
    "https://developer.api.intuit.com/.well-known/openid_configuration",
  development:
    "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};

// Historical fallbacks — Intuit's long-standing endpoints. Only used if the
// discovery fetch fails; the discovery values take precedence when available.
const FALLBACK_ENDPOINTS: QboOAuthEndpoints = {
  issuer: "https://oauth.platform.intuit.com/op/v1",
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint:
    "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  userinfo_endpoint:
    "https://accounts.platform.intuit.com/v1/openid_connect/userinfo",
  jwks_uri:
    "https://oauth.platform.intuit.com/op/v1/jwks",
  source: "fallback",
};

export interface QboOAuthEndpoints {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  /** "discovery" when fetched from Intuit, "fallback" when hardcoded. */
  source: "discovery" | "fallback";
}

interface CacheEntry {
  value: QboOAuthEndpoints;
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map<QboMode, CacheEntry>();

/**
 * Resolve the current OAuth 2.0 endpoints for the given QBO mode.
 *
 * - First request per mode fetches Intuit's discovery document.
 * - Subsequent requests within 24h return the cached value.
 * - On any error we return the historical fallback so the OAuth flow
 *   remains functional. The `source` field lets logs surface which path
 *   was used.
 */
export async function getQboOAuthEndpoints(
  mode: QboMode,
): Promise<QboOAuthEndpoints> {
  const cached = cache.get(mode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const url = DISCOVERY_URLS[mode];
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      console.warn("[qbo-discovery] non-2xx from discovery doc", {
        mode,
        status: res.status,
      });
      cache.set(mode, { value: FALLBACK_ENDPOINTS, fetchedAt: Date.now() });
      return FALLBACK_ENDPOINTS;
    }

    const body = (await res.json()) as Partial<QboOAuthEndpoints>;
    // Every endpoint we consume must be present and https — otherwise fall back.
    const endpoints: QboOAuthEndpoints = {
      issuer: body.issuer ?? FALLBACK_ENDPOINTS.issuer,
      authorization_endpoint:
        body.authorization_endpoint ?? FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: body.token_endpoint ?? FALLBACK_ENDPOINTS.token_endpoint,
      revocation_endpoint:
        body.revocation_endpoint ?? FALLBACK_ENDPOINTS.revocation_endpoint,
      userinfo_endpoint:
        body.userinfo_endpoint ?? FALLBACK_ENDPOINTS.userinfo_endpoint,
      jwks_uri: body.jwks_uri ?? FALLBACK_ENDPOINTS.jwks_uri,
      source: "discovery",
    };

    for (const key of [
      "authorization_endpoint",
      "token_endpoint",
      "revocation_endpoint",
    ] as const) {
      if (!/^https:\/\//i.test(endpoints[key])) {
        console.warn("[qbo-discovery] non-https endpoint, using fallback", {
          mode,
          key,
        });
        cache.set(mode, { value: FALLBACK_ENDPOINTS, fetchedAt: Date.now() });
        return FALLBACK_ENDPOINTS;
      }
    }

    cache.set(mode, { value: endpoints, fetchedAt: Date.now() });
    console.log("[qbo-discovery] fetched", {
      mode,
      authorization_endpoint: endpoints.authorization_endpoint,
      token_endpoint: endpoints.token_endpoint,
      revocation_endpoint: endpoints.revocation_endpoint,
    });
    return endpoints;
  } catch (e) {
    console.warn("[qbo-discovery] fetch failed, using fallback", {
      mode,
      error: e instanceof Error ? e.message : String(e),
    });
    cache.set(mode, { value: FALLBACK_ENDPOINTS, fetchedAt: Date.now() });
    return FALLBACK_ENDPOINTS;
  }
}

/** Test-only: clear the in-memory discovery cache. */
export function _resetQboDiscoveryCache() {
  cache.clear();
}
