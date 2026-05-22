// email-worker — routed background worker for the email domain.
// Service-role / internal-secret guarded routes only.

import { createRouter, jsonOk, jsonErr } from "../_shared/router.ts";
import { delegate } from "../_shared/delegate.ts";
import { requireServiceRole, requireInternalSecret } from "../_shared/auth.ts";

const app = createRouter("email-worker");

app.get("/__health", (c) => jsonOk(c, { fn: "email-worker", ok: true }));

// Worker auth: either service-role bearer OR INTERNAL_WORKER_SECRET header.
app.use("/*", async (c, next) => {
  if (c.req.path === "/__health") return next();
  const ok = requireServiceRole(c.req.raw) || requireInternalSecret(c.req.raw);
  if (!ok) return jsonErr(c, "unauthorized", "Worker auth required", 401);
  await next();
});

app.post("/sequence/process", (c) =>
  delegate(c.req.raw, "email-sequence-engine", "email-worker", { serviceRole: true })
);
app.post("/statuses/backfill", (c) =>
  delegate(c.req.raw, "backfill-email-statuses", "email-worker", { serviceRole: true })
);

app.notFound((c) => jsonErr(c, "route_not_found", "Route not registered on email-worker.", 404));

Deno.serve(app.fetch);
