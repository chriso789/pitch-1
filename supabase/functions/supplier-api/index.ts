// supplier-api — routed Edge Function.
// Legacy ABC/QXO/SRS/Billtrust supplier functions forward here.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { handle as abcProxyHandle } from "../abc-api-proxy/handler.ts";
import { handle as billtrustAuthHandle } from "../billtrust-auth/handler.ts";
import { handle as billtrustPricingHandle } from "../billtrust-pricing/handler.ts";

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

Deno.serve(app.fetch);
