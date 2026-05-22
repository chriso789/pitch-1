// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `admin-update-password` invocations to the grouped `admin-api` route `/user/password/update`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "admin-api", "/user/password/update", "admin-update-password"));
