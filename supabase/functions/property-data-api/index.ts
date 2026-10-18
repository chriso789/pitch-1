// property-data-api — routed Edge Function.
// Legacy `canvassiq-*` skip-trace/enrichment functions forward here.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serveRouter } from "../_shared/router.ts";
import { handle as skipTraceHandle } from "../_shared/skip-trace/handler.ts";

const app = createRouter("property-data-api");

app.get("/__health", (c) => jsonOk(c, { fn: "property-data-api", ok: true }));

// Handler verifies JWT, active company membership and stored property ownership.
app.post("/skip-trace", (c) => skipTraceHandle(c.req.raw));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/property/add", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/detect", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/enrich", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/parcels/load", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/properties/geojson", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/buildings/snap", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/enrich/details", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/skip-trace/lookup", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

serveRouter(app);
