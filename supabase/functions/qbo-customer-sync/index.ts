import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QBOCustomer {
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { contact_id, tenant_id } = await req.json();

    if (!contact_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing contact_id or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get QBO connection
    const { data: connection } = await supabase
      .from('qbo_connections')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: 'No active QuickBooks connection' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get contact details
    const { data: contact } = await supabase
      .from('contacts')
      .select('*, locations(qbo_location_ref)')
      .eq('id', contact_id)
      .single();

    if (!contact) {
      return new Response(
        JSON.stringify({ error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already mapped
    const { data: existingMapping } = await supabase
      .from('qbo_entity_mapping')
      .select('qbo_id')
      .eq('tenant_id', tenant_id)
      .eq('local_entity_type', 'contact')
      .eq('local_entity_id', contact_id)
      .single();

    let qboCustomerId = existingMapping?.qbo_id;
    let operation = 'update';

    // Build QBO Customer object
    const qboCustomer: QBOCustomer = {
      DisplayName: contact.company_name || 
        `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 
        'Unknown Customer',
      GivenName: contact.first_name,
      FamilyName: contact.last_name,
      CompanyName: contact.company_name,
    };

    if (contact.email) {
      qboCustomer.PrimaryEmailAddr = { Address: contact.email };
    }

    if (contact.phone) {
      qboCustomer.PrimaryPhone = { FreeFormNumber: contact.phone };
    }

    if (contact.address_street) {
      qboCustomer.BillAddr = {
        Line1: contact.address_street,
        City: contact.address_city,
        CountrySubDivisionCode: contact.address_state,
        PostalCode: contact.address_zip,
      };
    }

    let qboResponse;

    if (qboCustomerId) {
      // Update existing customer - need to fetch current SyncToken
      const fetchResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/customer/${qboCustomerId}?minorversion=75`,
        {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch customer: ${fetchResponse.statusText}`);
      }

      const currentCustomer = await fetchResponse.json();
      const updatePayload = {
        ...currentCustomer.Customer,
        ...qboCustomer,
      };

      // Sparse update
      qboResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/customer?minorversion=75`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(updatePayload),
        }
      );
    } else {
      // Create new customer
      operation = 'create';
      qboResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/customer?minorversion=75`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(qboCustomer),
        }
      );
    }

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      throw new Error(`QBO API error: ${errorText}`);
    }

    const qboData = await qboResponse.json();
    const customer = qboData.Customer;

    // Store mapping
    await supabase
      .from('qbo_entity_mapping')
      .upsert({
        tenant_id,
        local_entity_type: 'contact',
        local_entity_id: contact_id,
        qbo_entity_type: 'Customer',
        qbo_id: customer.Id,
        last_synced_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,local_entity_type,local_entity_id',
      });

    console.log(`Customer ${operation}: ${customer.Id}`);

    return new Response(
      JSON.stringify({
        success: true,
        operation,
        qbo_customer_id: customer.Id,
        display_name: customer.DisplayName,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-customer-sync:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
