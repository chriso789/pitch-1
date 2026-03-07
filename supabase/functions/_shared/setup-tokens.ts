/**
 * Shared helper for creating custom setup tokens
 * Bypasses Supabase OTP expiry (which is not configurable in this project)
 * Tokens are valid for 24 hours by default
 */

const APP_URL = "https://pitch-1.lovable.app";

/**
 * Generate a cryptographically random setup token, store it in the
 * setup_tokens table, and return the URL for the user to set their password.
 */
export async function createSetupToken(
  supabaseAdmin: any,
  userId: string,
  expiryHours: number = 24
): Promise<{ token: string; setupUrl: string }> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');

  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from('setup_tokens')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt,
    });

  if (error) {
    console.error('[createSetupToken] Insert error:', error);
    throw new Error(`Failed to create setup token: ${error.message}`);
  }

  const setupUrl = `${APP_URL}/setup-account?setup_token=${encodeURIComponent(token)}&type=setup`;
  console.log('[createSetupToken] Token created for user:', userId, 'expires:', expiresAt);
  return { token, setupUrl };
}
