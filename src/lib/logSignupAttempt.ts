import { supabase } from "@/integrations/supabase/client";

export interface SignupAttemptLog {
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  status: "attempted" | "success" | "error";
  error_message?: string;
  error_code?: string;
  source: string;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort logger for signup form submissions.
 * Never throws — failures are swallowed so logging issues can't break signup.
 */
export async function logSignupAttempt(entry: SignupAttemptLog): Promise<void> {
  try {
    await supabase.from("signup_attempts").insert({
      email: entry.email || null,
      first_name: entry.first_name || null,
      last_name: entry.last_name || null,
      company_name: entry.company_name || null,
      phone: entry.phone || null,
      status: entry.status,
      error_message: entry.error_message || null,
      error_code: entry.error_code || null,
      source: entry.source,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      metadata: entry.metadata || {},
    });
  } catch (err) {
    // Intentional — never block signup on telemetry
    console.warn("[logSignupAttempt] failed to log:", err);
  }
}
