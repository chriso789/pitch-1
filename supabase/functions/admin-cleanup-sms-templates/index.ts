// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `admin-cleanup-sms-templates` invocations to the grouped `admin-api` route `/sms-templates/cleanup`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "admin-api", "/sms-templates/cleanup", "admin-cleanup-sms-templates"));
