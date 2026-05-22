// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvass-dispositions` invocations to the grouped `canvass-api` route `/disposition`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "canvass-api", "/disposition", "canvass-dispositions"));
