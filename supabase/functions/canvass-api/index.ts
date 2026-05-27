// canvass-api — routed Edge Function.
// Legacy `canvass-*` one-offs forward here via shims once their handlers move into _shared.
// NOTE: sibling-folder imports (../canvass-drop-pin/handler.ts, etc.) are not picked up by
// the edge-function bundler, so those routes stay served by their standalone functions
// (canvass-drop-pin/index.ts, canvass-dispositions/index.ts, ...) until their handler
// modules are relocated under supabase/functions/_shared/. This slice migrates only the
// scaffolded /auth and /pin/sync routes off 501.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { handleAuth } from "./auth.ts";
import { handlePinSync } from "./pin-sync.ts";

const app = createRouter("canvass-api");

app.get("/__health", (c) => jsonOk(c, { fn: "canvass-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/auth", handleAuth);
app.post("/pin/sync", handlePinSync);

// Still served by standalone functions for now:
//   /pin/drop          → canvass-drop-pin
//   /disposition       → canvass-dispositions
//   /area/auto-split   → canvass-area-auto-split
//   /area/heatmap      → canvass-area-build-heatmap
//   /area/membership   → canvass-area-build-membership
app.post("/route/plan", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/document/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/estimate/sync", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
