import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import Stripe from "npm:stripe@14.21.0";
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

    const {
      amount,
      currency = 'usd',
      description,
      contactId,
      projectId,
      paymentId,
      metadata = {},
    } = await req.json();

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

    // Get or create Stripe customer
    let stripeCustomerId: string | undefined;
    
    if (contactId) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('stripe_customer_id, email, first_name, last_name')
        .eq('id', contactId)
        .eq('tenant_id', tenantId)
        .single();

      if (contact) {
        if (contact.stripe_customer_id) {
          stripeCustomerId = contact.stripe_customer_id;
        } else if (contact.email) {
          // Create Stripe customer
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
      }
    }

    // Look up tenant's connected Stripe account so funds settle in their bank
    const { data: tenantStripe } = await supabase
      .from('tenant_stripe_accounts')
      .select('stripe_account_id, charges_enabled, onboarding_complete')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!tenantStripe?.stripe_account_id) {
      return new Response(
        JSON.stringify({
          error: 'This company has not connected a Stripe account yet. An owner or admin must complete Stripe onboarding under Settings → Payments before sending invoices.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!tenantStripe.charges_enabled) {
      return new Response(
        JSON.stringify({
          error: 'This company\'s Stripe account is not yet able to accept charges. Please finish Stripe onboarding under Settings → Payments.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 100% pass-through: no application fee. Funds route directly to the tenant's Stripe.
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: description || 'Payment',
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      on_behalf_of: tenantStripe.stripe_account_id,
      transfer_data: {
        destination: tenantStripe.stripe_account_id,
      },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message: 'Thank you for your payment!',
        },
      },
      metadata: {
        tenant_id: tenantId,
        contact_id: contactId || '',
        project_id: projectId || '',
        payment_id: paymentId || '',
        connected_account: tenantStripe.stripe_account_id,
        ...metadata,
      },
    });

    // Store payment link in database
    const { data: paymentLinkRecord, error: insertError } = await supabase
      .from('payment_links')
      .insert({
        tenant_id: tenantId,
        payment_id: paymentId,
        contact_id: contactId,
        project_id: projectId,
        stripe_payment_link_id: paymentLink.id,
        stripe_payment_link_url: paymentLink.url,
        amount,
        currency,
        description,
        status: 'active',
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting payment link:', insertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentLink: {
          id: paymentLink.id,
          url: paymentLink.url,
          amount,
          currency,
        },
        recordId: paymentLinkRecord?.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error creating payment link:', error);
    return new Response(
      JSON.stringify({
        error: (error instanceof Error ? error.message : String(error)) || 'Failed to create payment link',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
