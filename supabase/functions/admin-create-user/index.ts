// admin-create-user — serves its own handler directly.
// (Previously forwarded to `admin-api`, which cannot bundle cross-function
// imports and is therefore not deployed — that caused "edge function failed".)
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req));
