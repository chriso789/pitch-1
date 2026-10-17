// ai-api — routed Edge Function.
// Legacy `ai-*` one-offs forward here via shims.

import { createRouter, serveRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { handle as errorFixerHandle } from "../ai-error-fixer/handler.ts";
import { handle as imageAnalyzerHandle } from "../ai-image-analyzer/handler.ts";
import { handle as commandProcessorHandle } from "../ai-command-processor/handler.ts";
import { handle as adminAgentHandle } from "../ai-admin-agent/handler.ts";

const app = createRouter("ai-api");

app.get("/__health", (c) => jsonOk(c, { fn: "ai-api", ok: true }));

// Migrated routes.
app.post("/error/fix", (c) => errorFixerHandle(c.req.raw));
app.post("/command/process", (c) => commandProcessorHandle(c.req.raw));
app.post("/admin", (c) => adminAgentHandle(c.req.raw));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

// Image analysis requires an authenticated user with tenant access.
app.post("/image/analyze", (c) => imageAnalyzerHandle(c.req.raw));

app.post("/appointment/schedule", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/context/build", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/followup/generate", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/inbound/route", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/lead/score", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/project/status-answer", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/sales/advisor", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/sales/coach", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/crm-agent", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/homeowner/chat", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

// serveRouter dispatches x-route / __route to the Hono routes — bare
// app.fetch returns 404 for every shim and edgeApi caller.
serveRouter(app);
