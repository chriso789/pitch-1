// ============================================
// CENTRALIZED ENVIRONMENT VARIABLES
// ============================================

export function mustGetEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function getEnv(name: string, defaultValue: string = ''): string {
  return Deno.env.get(name) ?? defaultValue;
}

export const ENV = {
  // Supabase
  SUPABASE_URL: mustGetEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: mustGetEnv('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: mustGetEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // Telnyx
  get TELNYX_API_KEY() { return mustGetEnv('TELNYX_API_KEY'); },
  get TELNYX_PUBLIC_KEY() { return getEnv('TELNYX_PUBLIC_KEY', ''); },
  get TELNYX_CONNECTION_ID() { return getEnv('TELNYX_CONNECTION_ID', ''); },
  get TELNYX_SMS_PROFILE_ID() { return getEnv('TELNYX_SMS_PROFILE_ID', ''); },
  get TELNYX_PHONE_NUMBER() { return getEnv('TELNYX_PHONE_NUMBER', ''); },

  // Security settings
  TELNYX_MAX_SKEW_SECONDS: Number(getEnv('TELNYX_MAX_SKEW_SECONDS', '300')),

  // AI (optional)
  get OPENAI_API_KEY() { return getEnv('OPENAI_API_KEY', ''); },
  get ANTHROPIC_API_KEY() { return getEnv('ANTHROPIC_API_KEY', ''); },
};
