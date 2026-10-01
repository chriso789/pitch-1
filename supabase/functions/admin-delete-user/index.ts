// Runs the delete handler directly (the admin-api forward returned 404).
import { handle } from "./handler.ts";
Deno.serve(handle);
