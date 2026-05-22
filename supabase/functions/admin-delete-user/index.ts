// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `admin-delete-user` invocations to the grouped `admin-api` route `/user/delete`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "admin-api", "/user/delete", "admin-delete-user"));
