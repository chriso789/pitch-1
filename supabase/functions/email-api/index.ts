// email-api — routed Edge Function (consolidated email domain).
// Phase 1: routes delegate to legacy functions to preserve external integrations
// (Resend, suppression handling, signature emails, etc). Legacy logic is ported
// inline in a later phase. Frontends migrate to this grouped function NOW via
// `edgeApi("email-api", "/path", body)`.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serveRouter } from "../_shared/router.ts";
import { delegate } from "../_shared/delegate.ts";

const app = createRouter("email-api");

// ---- public routes (no auth) ----
app.get("/__health", (c) => jsonOk(c, { fn: "email-api", ok: true }));
app.post("/unsubscribe", (c) => delegate(c.req.raw, "handle-email-unsubscribe", "email-api", { anon: true }));
app.post("/suppression", (c) => delegate(c.req.raw, "handle-email-suppression", "email-api", { anon: true }));
app.post("/password-reset", (c) => delegate(c.req.raw, "send-password-reset", "email-api", { anon: true }));
app.post("/demo-request", (c) => delegate(c.req.raw, "send-demo-request-emails", "email-api", { anon: true }));

// ---- authenticated routes ----
app.use("/*", requireAuth);
app.use("/*", requireTenant);

// Generic send
app.post("/send", (c) => delegate(c.req.raw, "send-email", "email-api"));
app.post("/send/raw", (c) => delegate(c.req.raw, "email-send", "email-api"));

// Transactional
app.post("/transactional/send", (c) => delegate(c.req.raw, "send-transactional-email", "email-api"));
app.post("/transactional/preview", (c) => delegate(c.req.raw, "preview-transactional-email", "email-api"));

// User lifecycle
app.post("/user/invite", (c) => delegate(c.req.raw, "resend-user-invitation", "email-api"));
app.post("/user/invite/resend", (c) => delegate(c.req.raw, "resend-user-invitation", "email-api"));
app.post("/user/sync", (c) => delegate(c.req.raw, "sync-user-email", "email-api"));

// Company onboarding
app.post("/company/onboarding", (c) => delegate(c.req.raw, "send-company-onboarding-email", "email-api"));
app.post("/company/onboarding/test", (c) => delegate(c.req.raw, "test-company-onboarding-email", "email-api"));

// Document / quote / order delivery
app.post("/quote/send", (c) => delegate(c.req.raw, "send-quote-email", "email-api"));
app.post("/material-order/send", (c) => delegate(c.req.raw, "material-order-send-email", "email-api"));
app.post("/labor-order/send", (c) => delegate(c.req.raw, "labor-order-send-email", "email-api"));
app.post("/report-packet/send", (c) => delegate(c.req.raw, "report-packet-send-resend", "email-api"));
app.post("/signature/send", (c) => delegate(c.req.raw, "email-signature-request", "email-api"));

// Sequences
app.post("/sequence/manage", (c) => delegate(c.req.raw, "email-sequence-manager", "email-api"));

// Domain & status admin
app.post("/domain/verify", (c) => delegate(c.req.raw, "verify-email-domain", "email-api"));
app.post("/statuses/backfill", (c) => delegate(c.req.raw, "backfill-email-statuses", "email-api"));

app.notFound((c) => jsonErr(c, "route_not_found", "Route not registered on email-api.", 404));

serveRouter(app);
