// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvass-area-build-membership` invocations to the grouped `canvass-api` route `/area/membership`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "canvass-api", "/area/membership", "canvass-area-build-membership"));
