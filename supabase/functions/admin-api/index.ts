// admin-api — routed Edge Function.
// Owns admin user/account management. Legacy `admin-*` functions are shims forwarding here.
// See docs/EDGE_FUNCTION_RULES.md.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { handle as createUserHandle } from "../admin-create-user/handler.ts";
import { handle as deleteUserHandle } from "../admin-delete-user/handler.ts";
import { handle as updatePasswordHandle } from "../admin-update-password/handler.ts";
import { handle as cleanupSmsTemplatesHandle } from "../admin-cleanup-sms-templates/handler.ts";

const app = createRouter("admin-api");

app.get("/__health", (c) => jsonOk(c, { fn: "admin-api", ok: true }));

// Migrated routes — legacy handlers do their own auth, so register BEFORE the auth middleware.
app.post("/user/create", (c) => createUserHandle(c.req.raw));
app.post("/user/delete", (c) => deleteUserHandle(c.req.raw));
app.post("/user/password/update", (c) => updatePasswordHandle(c.req.raw));
app.post("/sms-templates/cleanup", (c) => cleanupSmsTemplatesHandle(c.req.raw));

// Routes below still gated by router auth.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/user/role/update", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/platform/operator/create", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
