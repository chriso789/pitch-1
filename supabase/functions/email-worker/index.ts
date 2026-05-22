// email-worker — routed background worker for the email domain.
// Service-role / internal-secret guarded routes only.

import { createRouter, jsonOk, jsonErr } from "../_shared/router.ts";
import { delegate } from "../_shared/delegate.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

const app = createRouter("email-worker");

app.get("/__health", (c) => jsonOk(c, { fn: "email-worker", ok: true }));

// Worker auth: service-role bearer OR INTERNAL_WORKER_SECRET header.
app.use("/*", async (c, next) => {
  if (c.req.path === "/__health") return next();
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const internal = c.req.header("x-internal-secret") ?? "";
  const ok =
    (SERVICE_KEY && token === SERVICE_KEY) ||
    (INTERNAL_SECRET && internal === INTERNAL_SECRET);
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
