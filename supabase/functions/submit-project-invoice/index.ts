import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { 
      project_id,
      pipeline_entry_id,
      change_order_id,
      invoice_type,
      vendor_name,
      crew_name,
      overhead_category,
      invoice_number,
      invoice_date,
      invoice_amount,
      subtotal,
      tax_amount,
      document_url,
      document_name,
      notes,
      line_items,
      allow_duplicate
    } = await req.json();

    if (!project_id && !pipeline_entry_id) {
      throw new Error('Either project_id or pipeline_entry_id is required');
    }

    if (!invoice_type || !invoice_amount) {
      throw new Error('invoice_type and invoice_amount are required');
    }

    if (!['material', 'labor', 'overhead'].includes(invoice_type)) {
      throw new Error('invoice_type must be "material", "labor", or "overhead"');
    }

    const targetId = project_id || pipeline_entry_id;
    const targetType = project_id ? 'project' : 'pipeline_entry';
    console.log(`[submit-project-invoice] Submitting ${invoice_type} invoice for ${targetType}: ${targetId}`);

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User has no tenant');
    }

    // Get project's pipeline_entry_id if project_id is provided
    let effectivePipelineEntryId = pipeline_entry_id;
    if (project_id && !effectivePipelineEntryId) {
      const { data: project } = await supabase
        .from('projects')
        .select('pipeline_entry_id')
        .eq('id', project_id)
        .single();
      effectivePipelineEntryId = project?.pipeline_entry_id;
    }

    // ----- Duplicate detection (tenant-wide) -----
    // Tier 1: vendor + invoice_number match (case-insensitive) → duplicate
    // Tier 2: vendor + amount + identical line-item fingerprint → duplicate
    // Tier 3: vendor + invoice_date + amount → duplicate
    let duplicateOf: string | null = null;
    let duplicateReason = '';
    const amt = parseFloat(invoice_amount);

    const buildFingerprint = (items: any[]): string => {
      if (!Array.isArray(items) || items.length === 0) return '';
      const norm = items
        .map((li: any) => ({
          d: String(li.description || '').toLowerCase().replace(/\s+/g, ' ').trim(),
          q: li.quantity != null ? Number(li.quantity) : null,
          t: li.line_total != null ? Number(Number(li.line_total).toFixed(2)) : null,
        }))
        .filter((x) => x.d.length > 0)
        .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      return JSON.stringify(norm);
    };

    if (vendor_name) {
      // Tier 1: vendor + invoice_number
      if (invoice_number) {
        const { data: dupes } = await supabase
          .from('project_cost_invoices')
          .select('id, invoice_number, invoice_date, invoice_amount, project_id, pipeline_entry_id')
          .eq('tenant_id', profile.tenant_id)
          .ilike('vendor_name', vendor_name)
          .ilike('invoice_number', invoice_number)
          .is('duplicate_of', null)
          .limit(1);
        if (dupes && dupes.length > 0) {
          duplicateOf = dupes[0].id;
          duplicateReason = `same invoice number #${invoice_number}`;
        }
      }

      // Tier 2: vendor + amount + line-item fingerprint
      if (!duplicateOf && Array.isArray(line_items) && line_items.length > 0) {
        const newFp = buildFingerprint(line_items);
        if (newFp) {
          const { data: candidates } = await supabase
            .from('project_cost_invoices')
            .select('id, invoice_number, invoice_date, invoice_amount, project_id, pipeline_entry_id')
            .eq('tenant_id', profile.tenant_id)
            .ilike('vendor_name', vendor_name)
            .eq('invoice_amount', amt)
            .is('duplicate_of', null)
            .limit(20);
          if (candidates && candidates.length > 0) {
            const ids = candidates.map((c) => c.id);
            const { data: existingLI } = await supabase
              .from('project_cost_invoice_line_items')
              .select('invoice_id, description, quantity, line_total')
              .in('invoice_id', ids);
            const grouped = new Map<string, any[]>();
            (existingLI || []).forEach((li: any) => {
              const arr = grouped.get(li.invoice_id) || [];
              arr.push(li);
              grouped.set(li.invoice_id, arr);
            });
            for (const cand of candidates) {
              const fp = buildFingerprint(grouped.get(cand.id) || []);
              if (fp && fp === newFp) {
                duplicateOf = cand.id;
                duplicateReason = `identical line items and total ($${amt.toFixed(2)})`;
                Object.assign(dupes_first_match, cand);
                break;
              }
            }
          }
        }
      }

      // Tier 3: vendor + date + amount
      if (!duplicateOf && invoice_date) {
        const { data: dupes } = await supabase
          .from('project_cost_invoices')
          .select('id, invoice_number, invoice_date, invoice_amount, project_id, pipeline_entry_id')
          .eq('tenant_id', profile.tenant_id)
          .ilike('vendor_name', vendor_name)
          .eq('invoice_date', invoice_date)
          .eq('invoice_amount', amt)
          .is('duplicate_of', null)
          .limit(1);
        if (dupes && dupes.length > 0) {
          duplicateOf = dupes[0].id;
          duplicateReason = `same vendor, date, and amount`;
        }
      }

      if (duplicateOf && !allow_duplicate) {
        const { data: dupRow } = await supabase
          .from('project_cost_invoices')
          .select('id, invoice_number, invoice_date, invoice_amount, project_id, pipeline_entry_id')
          .eq('id', duplicateOf)
          .single();
        return new Response(
          JSON.stringify({
            duplicate: true,
            duplicate_invoice: dupRow,
            duplicate_reason: duplicateReason,
            message: `Duplicate invoice detected from ${vendor_name} (${duplicateReason}). Re-submit with allow_duplicate=true to save anyway.`
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Create invoice record
    const { data: invoice, error: invoiceError } = await supabase
      .from('project_cost_invoices')
      .insert({
        tenant_id: profile.tenant_id,
        project_id: project_id || null,
        pipeline_entry_id: effectivePipelineEntryId || null,
        change_order_id: change_order_id || null,
        invoice_type,
        vendor_name: vendor_name || null,
        crew_name: crew_name || null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date || null,
        invoice_amount: amt,
        subtotal: subtotal ? parseFloat(subtotal) : null,
        tax_amount: tax_amount ? parseFloat(tax_amount) : null,
        document_url: document_url || null,
        document_name: document_name || null,
        notes: notes || null,
        status: document_url ? 'verified' : 'pending',
        duplicate_of: duplicateOf,
        created_by: user.id
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('[submit-project-invoice] Error creating invoice:', invoiceError);
      throw new Error('Failed to create invoice record');
    }

    console.log(`[submit-project-invoice] Created invoice: ${invoice.id}${duplicateOf ? ` (marked duplicate of ${duplicateOf})` : ''}`);

    // Persist line items for searchable color/style/brand history
    if (Array.isArray(line_items) && line_items.length > 0) {
      const rows = line_items.map((li: any, idx: number) => ({
        tenant_id: profile.tenant_id,
        invoice_id: invoice.id,
        project_id: project_id || null,
        pipeline_entry_id: effectivePipelineEntryId || null,
        vendor_name: vendor_name || null,
        line_number: idx + 1,
        description: String(li.description || '').slice(0, 2000) || '(no description)',
        normalized_description: String(li.description || '').toLowerCase().trim(),
        quantity: li.quantity != null ? Number(li.quantity) : null,
        unit_price: li.unit_price != null ? Number(li.unit_price) : null,
        line_total: li.line_total != null ? Number(li.line_total) : null,
        unit_of_measure: li.unit_of_measure || null,
        sku: li.sku || null,
        brand: li.brand || null,
        color: li.color || null,
        style: li.style || null,
        material_category: li.material_category || null,
        raw_json: li,
      }));
      const { error: liErr } = await supabase
        .from('project_cost_invoice_line_items')
        .insert(rows);
      if (liErr) {
        console.error('[submit-project-invoice] Failed to insert line items:', liErr);
      } else {
        console.log(`[submit-project-invoice] Inserted ${rows.length} line items`);
      }
    }

    // Create document record if a file was attached (so it shows in Documents tab)
    if (document_url) {
      const docType = invoice_type === 'material' ? 'invoice_material' 
        : invoice_type === 'labor' ? 'invoice_labor' 
        : 'invoice_overhead';
      
      const { data: docRecord, error: docError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: effectivePipelineEntryId || null,
          project_id: project_id || null,
          document_type: docType,
          filename: document_name || 'Invoice Document',
          file_path: document_url,
          mime_type: 'application/pdf',
          invoice_amount: parseFloat(invoice_amount),
          vendor_name: vendor_name || null,
          invoice_number: invoice_number || null,
          linked_invoice_id: invoice.id,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (docError) {
        console.error('[submit-project-invoice] Error creating document record:', docError);
        // Non-fatal - invoice was still created
      } else {
        console.log(`[submit-project-invoice] Created document record: ${docRecord.id}`);
      }
    }

    // Calculate new totals from all invoices (by project_id or pipeline_entry_id)
    let invoiceQuery = supabase
      .from('project_cost_invoices')
      .select('invoice_type, invoice_amount')
      .in('status', ['pending', 'approved']);
    
    if (project_id) {
      invoiceQuery = invoiceQuery.eq('project_id', project_id);
    } else if (effectivePipelineEntryId) {
      invoiceQuery = invoiceQuery.eq('pipeline_entry_id', effectivePipelineEntryId);
    }
    
    const { data: allInvoices } = await invoiceQuery;

    const materialTotal = (allInvoices || [])
      .filter(inv => inv.invoice_type === 'material')
      .reduce((sum, inv) => sum + parseFloat(inv.invoice_amount), 0);

    const laborTotal = (allInvoices || [])
      .filter(inv => inv.invoice_type === 'labor')
      .reduce((sum, inv) => sum + parseFloat(inv.invoice_amount), 0);

    // Update reconciliation with new actual costs (only if project_id exists)
    let reconciliation = null;
    if (project_id) {
      const { data: reconData, error: reconError } = await supabase
        .from('project_cost_reconciliation')
        .update({
          actual_material_cost: materialTotal,
          actual_labor_cost: laborTotal,
          status: 'in_progress',
          updated_at: new Date().toISOString()
        })
        .eq('project_id', project_id)
        .select()
        .single();

      if (reconError) {
        console.error('[submit-project-invoice] Error updating reconciliation:', reconError);
        // Don't fail - reconciliation might not exist yet
      } else {
        reconciliation = reconData;
      }

      // Update production workflow status
      await supabase
        .from('production_workflows')
        .update({
          cost_verification_status: 'in_progress'
        })
        .eq('project_id', project_id);
    }

    console.log(`[submit-project-invoice] Updated reconciliation - Materials: $${materialTotal}, Labor: $${laborTotal}`);

    return new Response(
      JSON.stringify({
        success: true,
        invoice,
        reconciliation,
        totals: {
          material: materialTotal,
          labor: laborTotal
        },
        message: 'Invoice submitted successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[submit-project-invoice] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
