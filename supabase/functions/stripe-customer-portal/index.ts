import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0';
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { contactId, returnUrl } = await req.json();

    // Get user's active tenant (supports multi-company switching)
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error('Profile not found');
    }

    // Get contact with Stripe customer ID
    const { data: contact } = await supabase
      .from('contacts')
      .select('stripe_customer_id, email, first_name, last_name')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .single();

    if (!contact) {
      throw new Error('Contact not found');
    }

    let stripeCustomerId = contact.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!stripeCustomerId && contact.email) {
      const customer = await stripe.customers.create({
        email: contact.email,
        name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
        metadata: {
          contact_id: contactId,
          tenant_id: tenantId,
        },
      });
      
      stripeCustomerId = customer.id;
      
      // Update contact with Stripe customer ID
      await supabase
        .from('contacts')
        .update({ stripe_customer_id: customer.id })
        .eq('id', contactId);
    }

    if (!stripeCustomerId) {
      throw new Error('Cannot create customer portal without email');
    }

    // Create Stripe customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl || `${supabaseUrl}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error creating customer portal session:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to create customer portal session',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
