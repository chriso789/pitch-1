import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { project_id, tenant_id } = await req.json();

    if (!project_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing project_id or tenant_id' }),
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

    // Get project with estimate and contact details
    const { data: project } = await supabase
      .from('projects')
      .select(`
        *,
        pipeline_entries(contact_id, contacts(*, locations(qbo_location_ref))),
        estimates(*)
      `)
      .eq('id', project_id)
      .single();

    if (!project) {
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contact = project.pipeline_entries?.contacts;
    if (!contact) {
      return new Response(
        JSON.stringify({ error: 'No contact associated with project' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure customer exists in QBO
    const { data: customerMapping } = await supabase
      .from('qbo_entity_mapping')
      .select('qbo_id')
      .eq('tenant_id', tenant_id)
      .eq('local_entity_type', 'contact')
      .eq('local_entity_id', contact.id)
      .single();

    let qboCustomerId = customerMapping?.qbo_id;

    // If no mapping, create customer first
    if (!qboCustomerId) {
      const syncResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/qbo-customer-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': req.headers.get('Authorization') ?? '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contact_id: contact.id,
            tenant_id,
          }),
        }
      );

      if (!syncResponse.ok) {
        throw new Error('Failed to sync customer to QBO');
      }

      const syncResult = await syncResponse.json();
      qboCustomerId = syncResult.qbo_customer_id;
    }

    // Get primary estimate for the project
    const estimate = project.estimates?.[0];
    if (!estimate) {
      return new Response(
        JSON.stringify({ error: 'No estimate found for project' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get job type mapping
    const { data: jobTypeMapping } = await supabase
      .from('job_type_qbo_mapping')
      .select('qbo_item_id, qbo_item_name')
      .eq('tenant_id', tenant_id)
      .eq('job_type', project.project_type || 'roof_repair')
      .single();

    if (!jobTypeMapping) {
      return new Response(
        JSON.stringify({ error: 'Job type not mapped to QBO Item. Please configure in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build invoice lines from estimate
    const lines: any[] = [];
    
    if (estimate.line_items && Array.isArray(estimate.line_items)) {
      estimate.line_items.forEach((item: any, index: number) => {
        lines.push({
          DetailType: 'SalesItemLineDetail',
          Amount: item.total || item.amount || 0,
          Description: item.description || item.name,
          SalesItemLineDetail: {
            ItemRef: {
              value: jobTypeMapping.qbo_item_id,
              name: jobTypeMapping.qbo_item_name,
            },
            Qty: item.quantity || 1,
            UnitPrice: item.rate || item.unit_price || 0,
          },
          LineNum: index + 1,
        });
      });
    } else {
      // Single line for total if no line items
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: estimate.selling_price || 0,
        Description: project.name || 'Job Invoice',
        SalesItemLineDetail: {
          ItemRef: {
            value: jobTypeMapping.qbo_item_id,
            name: jobTypeMapping.qbo_item_name,
          },
          Qty: 1,
          UnitPrice: estimate.selling_price || 0,
        },
        LineNum: 1,
      });
    }

    // Build invoice payload
    const invoicePayload: any = {
      CustomerRef: {
        value: qboCustomerId,
      },
      Line: lines,
      TxnDate: new Date().toISOString().split('T')[0],
      DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
      PrivateNote: `PITCH CRM Job: ${project.clj_formatted_number || project.id}`,
    };

    // Add location if available
    if (contact.locations?.qbo_location_ref) {
      invoicePayload.TxnLocationRef = {
        value: contact.locations.qbo_location_ref,
      };
    }

    // Create invoice in QBO
    const qboResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/invoice?minorversion=75`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(invoicePayload),
      }
    );

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      throw new Error(`QBO API error: ${errorText}`);
    }

    const qboData = await qboResponse.json();
    const invoice = qboData.Invoice;

    // Store invoice mapping
    await supabase
      .from('qbo_entity_mapping')
      .insert({
        tenant_id,
        local_entity_type: 'project',
        local_entity_id: project_id,
        qbo_entity_type: 'Invoice',
        qbo_id: invoice.Id,
        qbo_doc_number: invoice.DocNumber,
        last_synced_at: new Date().toISOString(),
      });

    // Store invoice AR mirror
    await supabase
      .from('invoice_ar_mirror')
      .insert({
        tenant_id,
        project_id,
        qbo_invoice_id: invoice.Id,
        doc_number: invoice.DocNumber,
        total_amount: parseFloat(invoice.TotalAmt),
        balance: parseFloat(invoice.Balance),
        qbo_status: invoice.EmailStatus || 'NotSent',
        last_qbo_pull_at: new Date().toISOString(),
      });

    console.log(`Invoice created: ${invoice.DocNumber} (${invoice.Id})`);

    return new Response(
      JSON.stringify({
        success: true,
        qbo_invoice_id: invoice.Id,
        doc_number: invoice.DocNumber,
        total: invoice.TotalAmt,
        balance: invoice.Balance,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-invoice-create:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
