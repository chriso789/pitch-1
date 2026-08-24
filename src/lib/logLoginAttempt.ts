import { supabase } from "@/integrations/supabase/client";

export interface LoginAttemptLog {
  email?: string;
  status: "attempted" | "success" | "failed";
  error_message?: string;
  error_code?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort login attempt logger (captures IP + geolocation server-side).
 * Never throws — logging must never block authentication.
 */
export function logLoginAttempt(entry: LoginAttemptLog): void {
  try {
    void supabase.functions
      .invoke("log-login-attempt", {
        body: {
          ...entry,
          source: entry.source || "web",
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        },
      })
      .catch(() => {});
  } catch {
    /* noop */
  }
}
