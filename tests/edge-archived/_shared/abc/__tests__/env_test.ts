import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ABC,
  AUTH_URLS,
  DEFAULT_SCOPES,
  canonicalRedirectUri,
  normalizeEnv,
} from "../env.ts";

Deno.test("normalizeEnv defaults to sandbox", () => {
  assertEquals(normalizeEnv(undefined), "sandbox");
  assertEquals(normalizeEnv(null), "sandbox");
  assertEquals(normalizeEnv(""), "sandbox");
  assertEquals(normalizeEnv("staging"), "sandbox");
  assertEquals(normalizeEnv("prod"), "sandbox");
});

Deno.test("normalizeEnv only accepts exact 'production'", () => {
  assertEquals(normalizeEnv("production"), "production");
  assertEquals(normalizeEnv("Production"), "sandbox");
  assertEquals(normalizeEnv("PRODUCTION"), "sandbox");
});

Deno.test("ABC base URLs match the ABC Okta app registration", () => {
  assertEquals(ABC.sandbox.apiBase, "https://partners-sb.abcsupply.com/api");
  assertEquals(ABC.production.apiBase, "https://partners.abcsupply.com/api");
  assertEquals(
    AUTH_URLS.sandbox,
    "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize",
  );
  assertEquals(
    AUTH_URLS.production,
    "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize",
  );
});

Deno.test("DEFAULT_SCOPES includes every scope ABC granted", () => {
  for (
    const scope of [
      "pricing.read",
      "order.read",
      "order.write",
      "product.read",
      "account.read",
      "location.read",
      "offline_access",
    ]
  ) {
    if (!DEFAULT_SCOPES.split(" ").includes(scope)) {
      throw new Error(`DEFAULT_SCOPES missing ${scope}`);
    }
  }
});

Deno.test("canonicalRedirectUri points at the callback function", () => {
  assertEquals(
    canonicalRedirectUri("https://example.supabase.co"),
    "https://example.supabase.co/functions/v1/abc-oauth-callback",
  );
});
