// Parcel resolution. Requires a county/state parcel provider — none configured yet.
// Refuses to fabricate a parcel; throws so downstream is blocked correctly.

import type { ExecutorContext, ExecutorResult } from "../runner.ts";

export async function runResolveParcel(_ctx: ExecutorContext): Promise<ExecutorResult> {
  throw new Error(
    "resolve_parcel: no county/state parcel provider configured for this request. " +
    "Add a provider integration before this skill can complete (refusing stub completion).",
  );
}
