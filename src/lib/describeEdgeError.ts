/**
 * describeEdgeFunctionError
 * -------------------------
 * Turns a Supabase `functions.invoke()` failure into a human-readable
 * identifier that always includes:
 *   - the function name (so we know WHICH function failed)
 *   - the HTTP status (or "network" if the fetch itself never got a response)
 *   - the underlying message
 *   - a short correlation id we can grep in edge-function logs
 *
 * Use this in every `functions.invoke` call site so toasts stop saying the
 * useless "Failed to send a request to the Edge Function" and instead say
 * something like:
 *   "[create-lead-with-contact] 404 Not Found — function is not deployed (err_a3f1)"
 */

export interface DescribedEdgeError {
  functionName: string;
  status: number | "network";
  code: string;
  message: string;
  correlationId: string;
  /** Short one-line label safe to show in a toast. */
  toastMessage: string;
  /** Original error for logging. */
  original: unknown;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function describeEdgeFunctionError(
  functionName: string,
  error: unknown,
  data?: unknown,
): DescribedEdgeError {
  const correlationId = `err_${shortId()}`;
  const anyErr = error as any;

  // Supabase FunctionsFetchError => the browser fetch itself failed (CORS,
  // function not deployed, network blocked, etc.). This is the case that used
  // to show as the useless "Failed to send a request to the Edge Function".
  const name: string | undefined = anyErr?.name;
  const message: string = anyErr?.message || "Unknown error";
  const contextMessage: string | undefined = anyErr?.context?.message;

  // Attempt to read HTTP status from FunctionsHttpError context.
  const status: number | "network" =
    typeof anyErr?.context?.status === "number"
      ? anyErr.context.status
      : typeof anyErr?.status === "number"
      ? anyErr.status
      : "network";

  // Prefer the server-provided error body if present (our edge functions
  // return { code, message } via `errorResponse`).
  const bodyCode: string | undefined =
    (data as any)?.code || (data as any)?.error?.code;
  const bodyMsg: string | undefined =
    (data as any)?.message ||
    (data as any)?.error?.message ||
    (data as any)?.error;

  const code =
    bodyCode ||
    (name === "FunctionsFetchError"
      ? "network_or_not_deployed"
      : name === "FunctionsHttpError"
      ? `http_${status}`
      : name || "unknown");

  let hint = "";
  if (status === "network" || name === "FunctionsFetchError") {
    hint = "function may not be deployed, blocked by network, or CORS failed";
  } else if (status === 401) {
    hint = "session expired — sign in again";
  } else if (status === 403) {
    hint = "not authorized for this action";
  } else if (status === 404) {
    hint = "function is not deployed";
  } else if (status === 409) {
    hint = "conflict (often a duplicate)";
  } else if (typeof status === "number" && status >= 500) {
    hint = "server error — check function logs";
  }

  const toastMessage = `[${functionName}] ${status} — ${
    bodyMsg || contextMessage || message
  }${hint ? ` · ${hint}` : ""} (${correlationId})`;

  return {
    functionName,
    status,
    code,
    message: bodyMsg || contextMessage || message,
    correlationId,
    toastMessage,
    original: error,
  };
}
