// canvass-api — routed Edge Function.
// Legacy `canvass-*` one-offs forward here via shims once their handlers move into _shared.
// Drop Pin lives in _shared so shims and grouped requests share one save route.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serveRouter } from "../_shared/router.ts";
import { handleAuth } from "./auth.ts";
import { handlePinSync } from "./pin-sync.ts";

import { handleDropPin } from "../_shared/canvass-drop-pin.ts";

const app = createRouter("canvass-api");

app.get("/__health", (c) => jsonOk(c, { fn: "canvass-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/auth", handleAuth);
app.post("/pin/sync", handlePinSync);
// Auth mode: authenticated tenant route (middleware above).
app.post("/pin/drop", handleDropPin);

// Still served by standalone functions for now:
//   /disposition       → canvass-dispositions
//   /area/auto-split   → canvass-area-auto-split
//   /area/heatmap      → canvass-area-build-heatmap
//   /area/membership   → canvass-area-build-membership
app.post("/route/plan", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/document/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/estimate/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

serveRouter(app);
