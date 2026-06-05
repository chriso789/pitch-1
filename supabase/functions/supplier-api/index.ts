// supplier-api — routed Edge Function.
// Legacy ABC/QXO/SRS/Billtrust supplier functions forward here.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import { handle as abcProxyHandle } from "./abc-proxy-handler.ts";
import { handle as billtrustAuthHandle } from "./billtrust-auth-handler.ts";
import { handle as billtrustPricingHandle } from "./billtrust-pricing-handler.ts";

const app = createRouter("supplier-api");

app.get("/__health", (c) => jsonOk(c, { fn: "supplier-api", ok: true }));

// Migrated routes — legacy handlers manage auth/role checks themselves.
app.all("/abc/proxy", (c) => abcProxyHandle(c.req.raw));
app.post("/billtrust/auth", (c) => billtrustAuthHandle(c.req.raw));
app.post("/billtrust/pricing", (c) => billtrustPricingHandle(c.req.raw));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/qxo/proxy", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/credentials/save", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/orders", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quotes", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/push", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/submit", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quote-order/submit", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/invoices", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/proxy", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/abc/oauth/callback", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/quote/parse", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/create", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/fulfillment", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

// Supabase delivers requests with the function name as the first path segment
// (e.g. `/supplier-api/abc/proxy`). Strip it so Hono routes defined as
// `/abc/proxy` match correctly. Root invokes (via supabase.functions.invoke)
// arrive as `/` or `/supplier-api` and pass through unchanged.
Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/supplier-api/")) {
    url.pathname = url.pathname.slice("/supplier-api".length) || "/";
    return app.fetch(new Request(url.toString(), req));
  }
  if (url.pathname === "/supplier-api") {
    url.pathname = "/";
    return app.fetch(new Request(url.toString(), req));
  }
  return app.fetch(req);
});
