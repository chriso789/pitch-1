import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

  try {
    const { action, token, project_id, contact_id, message, amount } = await req.json();

    // Action: Generate new portal access token
    if (action === 'generate') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('Authorization required');
      }

      const jwtToken = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(jwtToken);
      if (userError || !user) {
        throw new Error('Unauthorized');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) {
        throw new Error('Tenant not found');
      }

      // Generate unique token
      const accessToken = generateToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const { data: tokenRecord, error: insertError } = await supabase
        .from('customer_portal_tokens')
        .insert({
          tenant_id: profile.tenant_id,
          project_id,
          contact_id,
          token: accessToken,
          expires_at: expiresAt.toISOString(),
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const portalUrl = `${req.headers.get('origin') || supabaseUrl.replace('.supabase.co', '')}/customer/${accessToken}`;

      return new Response(JSON.stringify({
        success: true,
        token: accessToken,
        portal_url: portalUrl,
        expires_at: expiresAt.toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Validate token and get project data
    if (action === 'validate') {
      if (!token) {
        throw new Error('Token required');
      }

      // Get token record
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('customer_portal_tokens')
        .select('*, projects(*), contacts(*)')
        .eq('token', token)
        .single();

      if (tokenError || !tokenRecord) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid or expired access link',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }

      // Check expiration
      if (new Date(tokenRecord.expires_at) < new Date()) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Access link has expired',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }

      // Update access count
      await supabase
        .from('customer_portal_tokens')
        .update({
          last_accessed_at: new Date().toISOString(),
          access_count: (tokenRecord.access_count || 0) + 1,
        })
        .eq('id', tokenRecord.id);

      // Get project details with related data
      const { data: project } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates(*),
          payments(*)
        `)
        .eq('id', tokenRecord.project_id)
        .single();

      // Get payment links
      const { data: paymentLinks } = await supabase
        .from('payment_links')
        .select('*')
        .eq('project_id', tokenRecord.project_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      // Get customer messages
      const { data: messages } = await supabase
        .from('customer_messages')
        .select('*')
        .eq('project_id', tokenRecord.project_id)
        .order('created_at', { ascending: true });

      // Get documents (excluding internal)
      const { data: documents } = await supabase
        .from('documents')
        .select('*')
        .eq('pipeline_entry_id', project?.pipeline_entry_id)
        .not('document_type', 'ilike', '%internal%')
        .order('created_at', { ascending: false });

      // Get company info
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, logo_url, primary_color, secondary_color, phone, email, website')
        .eq('id', tokenRecord.tenant_id)
        .single();

      return new Response(JSON.stringify({
        success: true,
        project,
        contact: tokenRecord.contacts,
        payment_links: paymentLinks || [],
        messages: messages || [],
        documents: documents || [],
        company: tenant,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Send customer message
    if (action === 'send_message') {
      if (!token || !message) {
        throw new Error('Token and message required');
      }

      // Validate token
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('customer_portal_tokens')
        .select('*')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (tokenError || !tokenRecord) {
        throw new Error('Invalid or expired access link');
      }

      // Insert message
      const { data: newMessage, error: msgError } = await supabase
        .from('customer_messages')
        .insert({
          tenant_id: tokenRecord.tenant_id,
          project_id: tokenRecord.project_id,
          contact_id: tokenRecord.contact_id,
          sender_type: 'customer',
          message,
        })
        .select()
        .single();

      if (msgError) throw msgError;

      return new Response(JSON.stringify({
        success: true,
        message: newMessage,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Request payment link
    if (action === 'request_payment_link') {
      if (!token) {
        throw new Error('Token required');
      }

      // Validate token
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('customer_portal_tokens')
        .select('*, projects(*), contacts(*)')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (tokenError || !tokenRecord) {
        throw new Error('Invalid or expired access link');
      }

      if (!stripeSecretKey) {
        throw new Error('Payment processing is not configured');
      }

      // Dynamic import of Stripe
      const { default: Stripe } = await import('https://esm.sh/stripe@14.21.0?target=deno');
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient(),
      });

      const projectName = tokenRecord.projects?.name || 'Project Payment';
      const contactEmail = tokenRecord.contacts?.email;
      const paymentAmount = amount || 0;

      if (paymentAmount <= 0) {
        throw new Error('Invalid payment amount');
      }

      // Create or get Stripe customer
      let stripeCustomerId: string | undefined;
      if (contactEmail) {
        const existingCustomers = await stripe.customers.list({
          email: contactEmail,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id;
        } else {
          const customer = await stripe.customers.create({
            email: contactEmail,
            name: `${tokenRecord.contacts?.first_name || ''} ${tokenRecord.contacts?.last_name || ''}`.trim() || undefined,
            metadata: {
              contact_id: tokenRecord.contact_id,
              tenant_id: tokenRecord.tenant_id,
              project_id: tokenRecord.project_id,
            },
          });
          stripeCustomerId = customer.id;

          // Update contact with Stripe customer ID
          await supabase
            .from('contacts')
            .update({ stripe_customer_id: customer.id })
            .eq('id', tokenRecord.contact_id);
        }
      }

      // Create Stripe Payment Link
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Payment for ${projectName}`,
              },
              unit_amount: Math.round(paymentAmount * 100),
            },
            quantity: 1,
          },
        ],
        after_completion: {
          type: 'hosted_confirmation',
          hosted_confirmation: {
            custom_message: 'Thank you for your payment! Your payment has been received and will be processed.',
          },
        },
        metadata: {
          tenant_id: tokenRecord.tenant_id,
          contact_id: tokenRecord.contact_id || '',
          project_id: tokenRecord.project_id || '',
          source: 'customer_portal',
        },
      });

      // Save payment link to database
      const { data: paymentLinkRecord, error: plError } = await supabase
        .from('payment_links')
        .insert({
          tenant_id: tokenRecord.tenant_id,
          contact_id: tokenRecord.contact_id,
          project_id: tokenRecord.project_id,
          stripe_payment_link_id: paymentLink.id,
          stripe_payment_link_url: paymentLink.url,
          amount: paymentAmount,
          currency: 'usd',
          description: `Payment for ${projectName}`,
          status: 'active',
        })
        .select()
        .single();

      if (plError) {
        console.error('Error saving payment link:', plError);
      }

      // Log the payment request
      await supabase.from('customer_messages').insert({
        tenant_id: tokenRecord.tenant_id,
        project_id: tokenRecord.project_id,
        contact_id: tokenRecord.contact_id,
        sender_type: 'system',
        message: `Customer requested payment link for $${paymentAmount.toLocaleString()}`,
      });

      return new Response(JSON.stringify({
        success: true,
        payment_link_id: paymentLink.id,
        payment_link_url: paymentLink.url,
        amount: paymentAmount,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('Customer portal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'An error occurred',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});