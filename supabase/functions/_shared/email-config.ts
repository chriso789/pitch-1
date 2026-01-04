/**
 * Centralized email configuration for PITCH CRM
 * All edge functions should import from here for consistent branding
 */

export const EMAIL_CONFIG = {
  // From addresses by type
  from: {
    onboarding: 'onboarding@pitch-crm.ai',
    support: 'support@pitch-crm.ai',
    notifications: 'notifications@pitch-crm.ai',
    demos: 'demos@pitch-crm.ai',
    noreply: 'noreply@pitch-crm.ai',
  },
  
  // BCC for admin copies
  bcc: {
    admin: 'admin@pitch-crm.ai',
  },
  
  // Reply-to addresses
  replyTo: 'support@pitch-crm.ai',
  
  // Branding
  brand: {
    name: 'PITCH CRM',
    tagline: 'The #1 Construction Sales Platform',
    primaryColor: '#2563eb',
    secondaryColor: '#3b82f6',
    logo: 'https://pitch-1.lovable.app/lovable-uploads/pitch-logo.png',
  },
  
  // Link expiration (in hours)
  linkExpiration: {
    passwordSetup: 24,
    passwordReset: 1,
  },
  
  // App URLs
  urls: {
    app: 'https://pitch-1.lovable.app',
    login: 'https://pitch-1.lovable.app/login',
    resetPassword: 'https://pitch-1.lovable.app/reset-password',
    settings: 'https://pitch-1.lovable.app/settings',
  }
};

/**
 * Get the "from" email address with domain override from environment
 */
export function getFromEmail(type: keyof typeof EMAIL_CONFIG.from = 'onboarding'): string {
  const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN");
  if (fromDomain) {
    const emailType = type === 'onboarding' ? 'onboarding' : type;
    return `${emailType}@${fromDomain}`;
  }
  // Fallback to Resend test domain
  return 'onboarding@resend.dev';
}

/**
 * Get formatted "from" header with name
 */
export function getFromHeader(name: string = EMAIL_CONFIG.brand.name, type: keyof typeof EMAIL_CONFIG.from = 'onboarding'): string {
  const sanitizedName = name.replace(/[<>'"]/g, '');
  return `${sanitizedName} <${getFromEmail(type)}>`;
}

/**
 * Generate password setup link that redirects to settings after setup
 */
export function getPasswordSetupUrl(token: string, isOnboarding: boolean = true): string {
  const baseUrl = EMAIL_CONFIG.urls.resetPassword;
  const params = new URLSearchParams();
  params.set('access_token', token);
  params.set('type', 'recovery');
  if (isOnboarding) {
    params.set('onboarding', 'true');
  }
  return `${baseUrl}?${params.toString()}`;
}
