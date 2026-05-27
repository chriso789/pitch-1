// canvass-api — routed Edge Function.
// Legacy `canvass-*` one-offs forward here via shims.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { handle as dropPinHandle } from "../canvass-drop-pin/handler.ts";
import { handle as dispositionsHandle } from "../canvass-dispositions/handler.ts";
import { handle as autoSplitHandle } from "../canvass-area-auto-split/handler.ts";
import { handle as heatmapHandle } from "../canvass-area-build-heatmap/handler.ts";
import { handle as membershipHandle } from "../canvass-area-build-membership/handler.ts";
import { handleAuth } from "./auth.ts";
import { handlePinSync } from "./pin-sync.ts";

const app = createRouter("canvass-api");

app.get("/__health", (c) => jsonOk(c, { fn: "canvass-api", ok: true }));

// Migrated routes — legacy handlers manage their own auth/session tokens.
app.all("/pin/drop", (c) => dropPinHandle(c.req.raw));
app.all("/disposition", (c) => dispositionsHandle(c.req.raw));
app.post("/area/auto-split", (c) => autoSplitHandle(c.req.raw));
app.post("/area/heatmap", (c) => heatmapHandle(c.req.raw));
app.post("/area/membership", (c) => membershipHandle(c.req.raw));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/auth", handleAuth);
app.post("/pin/sync", handlePinSync);
app.post("/route/plan", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/document/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/estimate/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
