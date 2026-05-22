// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvass-area-auto-split` invocations to the grouped `canvass-api` route `/area/auto-split`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "canvass-api", "/area/auto-split", "canvass-area-auto-split"));
