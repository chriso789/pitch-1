// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "email-api", "/invoice/share", "invoice-share"));
