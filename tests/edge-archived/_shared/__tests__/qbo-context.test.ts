import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getQboContextForConnection,
  getQboContextForMode,
  qboCredentialAvailability,
  qboWebhookVerifiers,
} from "../qbo-context.ts";

function clearAll() {
  for (const k of [
    "QBO_CLIENT_ID","QBO_CLIENT_SECRET","QBO_REDIRECT_URI","QBO_WEBHOOK_VERIFIER_TOKEN","QBO_WEBHOOK_VERIFIER","QBO_ENVIRONMENT","QBO_DEFAULT_ENVIRONMENT",
    "QBO_CLIENT_ID_DEVELOPMENT","QBO_CLIENT_SECRET_DEVELOPMENT","QBO_WEBHOOK_VERIFIER_DEVELOPMENT","QBO_REDIRECT_URI_DEVELOPMENT",
    "QBO_CLIENT_ID_PRODUCTION","QBO_CLIENT_SECRET_PRODUCTION","QBO_WEBHOOK_VERIFIER_PRODUCTION","QBO_REDIRECT_URI_PRODUCTION",
  ]) Deno.env.delete(k);
}

Deno.test("getQboContextForMode resolves split development credentials", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_DEVELOPMENT", "dev_id");
  Deno.env.set("QBO_CLIENT_SECRET_DEVELOPMENT", "dev_secret");
  Deno.env.set("QBO_REDIRECT_URI_DEVELOPMENT", "https://pitch-crm.ai/quickbooks-callback.html");
  Deno.env.set("QBO_WEBHOOK_VERIFIER_DEVELOPMENT", "dev_verifier");

  const ctx = getQboContextForMode("development");
  assertEquals(ctx.mode, "development");
  assertEquals(ctx.accountingBaseUrl, "https://sandbox-quickbooks.api.intuit.com");
  assertEquals(ctx.clientId, "dev_id");
  assertEquals(ctx.webhookVerifier, "dev_verifier");
  assertEquals(ctx.usedLegacyFallback, false);
});

Deno.test("getQboContextForMode resolves split production credentials", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_PRODUCTION", "prod_id");
  Deno.env.set("QBO_CLIENT_SECRET_PRODUCTION", "prod_secret");
  Deno.env.set("QBO_REDIRECT_URI_PRODUCTION", "https://pitch-crm.ai/quickbooks-callback.html");

  const ctx = getQboContextForMode("production");
  assertEquals(ctx.mode, "production");
  assertEquals(ctx.accountingBaseUrl, "https://quickbooks.api.intuit.com");
  assertEquals(ctx.clientId, "prod_id");
  assertEquals(ctx.redirectUri, "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback");
});

Deno.test("production uses the saved Supabase function redirect", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_PRODUCTION", "prod_id");
  Deno.env.set("QBO_CLIENT_SECRET_PRODUCTION", "prod_secret");
  Deno.env.set(
    "QBO_REDIRECT_URI_PRODUCTION",
    "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback",
  );

  const ctx = getQboContextForMode("production");
  assertEquals(ctx.redirectUri, "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback");
});

Deno.test("production ignores stale SPA fallback redirect secret", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_PRODUCTION", "prod_id");
  Deno.env.set("QBO_CLIENT_SECRET_PRODUCTION", "prod_secret");
  Deno.env.set("QBO_REDIRECT_URI_PRODUCTION", "https://pitch-crm.ai/quickbooks/callback");

  const ctx = getQboContextForMode("production");
  assertEquals(ctx.redirectUri, "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback");
});

Deno.test("production redirect matches Intuit saved callback even when configured secret is stale", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_PRODUCTION", "prod_id");
  Deno.env.set("QBO_CLIENT_SECRET_PRODUCTION", "prod_secret");
  Deno.env.set("QBO_REDIRECT_URI_PRODUCTION", "https://old.example.com/callback");

  const ctx = getQboContextForMode("production");
  assertEquals(ctx.redirectUri, "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback");
});

Deno.test("falls back to legacy single-pair env vars when split missing", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID", "legacy_id");
  Deno.env.set("QBO_CLIENT_SECRET", "legacy_secret");
  Deno.env.set("QBO_REDIRECT_URI", "https://pitch-crm.ai/quickbooks-callback.html");

  const ctx = getQboContextForMode("production");
  assertEquals(ctx.clientId, "legacy_id");
  assertEquals(ctx.usedLegacyFallback, true);
});

Deno.test("throws qbo_production_credentials_missing when nothing is set", () => {
  clearAll();
  assertThrows(
    () => getQboContextForMode("production"),
    Error,
    "qbo_production_credentials_missing",
  );
});

Deno.test("getQboContextForConnection prefers oauth_app_env over is_sandbox", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_DEVELOPMENT", "dev_id");
  Deno.env.set("QBO_CLIENT_SECRET_DEVELOPMENT", "dev_secret");
  Deno.env.set("QBO_REDIRECT_URI_DEVELOPMENT", "x");
  Deno.env.set("QBO_CLIENT_ID_PRODUCTION", "prod_id");
  Deno.env.set("QBO_CLIENT_SECRET_PRODUCTION", "prod_secret");
  Deno.env.set("QBO_REDIRECT_URI_PRODUCTION", "x");

  // Conflicting flags — oauth_app_env wins.
  const ctx = getQboContextForConnection({ oauth_app_env: "production", is_sandbox: true });
  assertEquals(ctx.mode, "production");
  assertEquals(ctx.clientId, "prod_id");

  // Fallback to is_sandbox when oauth_app_env absent.
  const ctx2 = getQboContextForConnection({ is_sandbox: true });
  assertEquals(ctx2.mode, "development");
});

Deno.test("qboCredentialAvailability + qboWebhookVerifiers reflect what is configured", () => {
  clearAll();
  Deno.env.set("QBO_CLIENT_ID_DEVELOPMENT", "dev_id");
  Deno.env.set("QBO_CLIENT_SECRET_DEVELOPMENT", "dev_secret");
  Deno.env.set("QBO_REDIRECT_URI_DEVELOPMENT", "x");
  Deno.env.set("QBO_WEBHOOK_VERIFIER_DEVELOPMENT", "dv");

  const avail = qboCredentialAvailability();
  assertEquals(avail.has_development_credentials, true);
  assertEquals(avail.has_production_credentials, false);

  const verifiers = qboWebhookVerifiers();
  assertEquals(verifiers.length, 1);
  assertEquals(verifiers[0].mode, "development");
  assertEquals(verifiers[0].verifier, "dv");
});
