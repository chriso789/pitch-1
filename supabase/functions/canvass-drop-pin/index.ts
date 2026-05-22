// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvass-drop-pin` invocations to the grouped `canvass-api` route `/pin/drop`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "canvass-api", "/pin/drop", "canvass-drop-pin"));
