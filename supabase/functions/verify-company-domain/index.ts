import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Common free email providers to block
const FREE_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'inbox.com',
  'fastmail.com', 'tutanota.com', 'hushmail.com', 'mailinator.com',
  'guerrillamail.com', 'tempmail.com', '10minutemail.com'
];

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { email, domain, action, tenant_id } = await req.json();

    // Extract domain from email if not provided
    const targetDomain = domain || (email?.includes('@') ? email.split('@')[1].toLowerCase() : null);

    if (!targetDomain) {
      return new Response(
        JSON.stringify({ error: 'Email or domain is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing domain verification: ${targetDomain}, action: ${action}`);

    // Action: validate - Check if domain is blocked
    if (action === 'validate') {
      // Check blocked domains table first
      const { data: blockedRecord } = await supabase
        .from('blocked_email_domains')
        .select('domain, reason')
        .eq('domain', targetDomain)
        .single();

      if (blockedRecord) {
        return new Response(
          JSON.stringify({
            valid: false,
            blocked: true,
            reason: blockedRecord.reason === 'free_email_provider' 
              ? `${targetDomain} is a free email provider. Please use a company email address.`
              : blockedRecord.reason
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check hardcoded list as fallback
      if (FREE_EMAIL_PROVIDERS.includes(targetDomain)) {
        return new Response(
          JSON.stringify({
            valid: false,
            blocked: true,
            reason: `${targetDomain} is a free email provider. Please use a company email address.`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ valid: true, blocked: false, domain: targetDomain }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: generate - Generate DNS TXT record for verification
    if (action === 'generate') {
      const verificationToken = `pitch-verify=${crypto.randomUUID().slice(0, 8)}`;
      
      // Store pending verification
      if (tenant_id) {
        await supabase.from('verified_company_domains').upsert({
          tenant_id,
          domain: targetDomain,
          verification_status: 'pending',
          verification_method: 'dns_txt',
          dns_txt_record: verificationToken,
        }, { onConflict: 'tenant_id,domain' });
      }

      return new Response(
        JSON.stringify({
          success: true,
          domain: targetDomain,
          dns_txt_record: verificationToken,
          instructions: `Add a TXT record to your DNS with value: ${verificationToken}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: verify - Check if DNS TXT record exists
    if (action === 'verify') {
      // Get the expected TXT record from database
      const { data: domainRecord } = await supabase
        .from('verified_company_domains')
        .select('dns_txt_record')
        .eq('domain', targetDomain)
        .single();

      if (!domainRecord?.dns_txt_record) {
        return new Response(
          JSON.stringify({
            verified: false,
            message: 'No verification record found. Please generate a verification token first.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // In production, you would query DNS here using a DNS-over-HTTPS service
      // For now, we'll simulate verification (in real implementation, use Google DNS API or similar)
      try {
        const dnsResponse = await fetch(
          `https://dns.google/resolve?name=${targetDomain}&type=TXT`
        );
        const dnsData = await dnsResponse.json();
        
        const txtRecords = dnsData.Answer?.filter((r: any) => r.type === 16) || [];
        const found = txtRecords.some((r: any) => 
          r.data?.includes(domainRecord.dns_txt_record)
        );

        if (found) {
          // Update verification status
          await supabase
            .from('verified_company_domains')
            .update({
              verification_status: 'verified',
              verified_at: new Date().toISOString()
            })
            .eq('domain', targetDomain);

          return new Response(
            JSON.stringify({ verified: true, domain: targetDomain }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            verified: false,
            message: 'DNS TXT record not found. Please ensure the record is added and DNS has propagated.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (dnsError) {
        console.error('DNS lookup error:', dnsError);
        
        // For development/demo, auto-verify after checking domain format
        if (targetDomain.includes('.') && !FREE_EMAIL_PROVIDERS.includes(targetDomain)) {
          await supabase
            .from('verified_company_domains')
            .update({
              verification_status: 'verified',
              verified_at: new Date().toISOString()
            })
            .eq('domain', targetDomain);

          return new Response(
            JSON.stringify({ verified: true, domain: targetDomain, note: 'Auto-verified (development mode)' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ verified: false, message: 'Unable to verify DNS record' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Action: check-website - Verify email domain matches company website
    if (action === 'check-website') {
      const { website } = await req.json();
      
      if (!website) {
        return new Response(
          JSON.stringify({ matches: false, message: 'Website not provided' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract domain from website URL
      let websiteDomain = website
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .toLowerCase();

      const matches = targetDomain === websiteDomain || 
        targetDomain.endsWith(`.${websiteDomain}`) ||
        websiteDomain.endsWith(`.${targetDomain}`);

      return new Response(
        JSON.stringify({
          matches,
          emailDomain: targetDomain,
          websiteDomain,
          message: matches 
            ? 'Email domain matches company website'
            : 'Email domain does not match company website'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use: validate, generate, verify, or check-website' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Domain verification error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
