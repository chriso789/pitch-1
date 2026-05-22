// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvass-area-build-heatmap` invocations to the grouped `canvass-api` route `/area/heatmap`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "canvass-api", "/area/heatmap", "canvass-area-build-heatmap"));
