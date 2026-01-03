import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[subcontractor-payment-processor] Action: ${action}`, data);

    switch (action) {
      case 'submit_payment_request': {
        const { tenant_id, subcontractor_id, job_id, amount, description, invoice_number } = data;
        
        const { data: request, error } = await supabase
          .from('subcontractor_payment_requests')
          .insert({
            tenant_id,
            subcontractor_id,
            job_id,
            amount,
            description,
            invoice_number,
            status: 'pending',
            submitted_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        console.log(`[subcontractor-payment-processor] Payment request submitted: $${amount}`);
        return new Response(JSON.stringify({ success: true, request }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'approve_payment': {
        const { request_id, approved_by } = data;
        
        const { data: request, error } = await supabase
          .from('subcontractor_payment_requests')
          .update({
            status: 'approved',
            approved_by,
            approved_at: new Date().toISOString()
          })
          .eq('id', request_id)
          .select()
          .single();

        if (error) throw error;
        console.log(`[subcontractor-payment-processor] Payment approved: ${request_id}`);
        return new Response(JSON.stringify({ success: true, request }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'process_payment': {
        const { request_id, payment_method, reference_number } = data;
        
        const { data: request, error } = await supabase
          .from('subcontractor_payment_requests')
          .update({
            status: 'paid',
            payment_method,
            reference_number,
            paid_at: new Date().toISOString()
          })
          .eq('id', request_id)
          .select()
          .single();

        if (error) throw error;
        console.log(`[subcontractor-payment-processor] Payment processed: ${request_id}`);
        return new Response(JSON.stringify({ success: true, request }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'request_lien_waiver': {
        const { tenant_id, subcontractor_id, job_id, waiver_type, amount } = data;
        
        // Generate lien waiver request
        const waiverRequest = {
          tenant_id,
          subcontractor_id,
          job_id,
          waiver_type, // 'partial', 'final', 'conditional', 'unconditional'
          amount,
          status: 'requested',
          requested_at: new Date().toISOString()
        };

        console.log(`[subcontractor-payment-processor] Lien waiver requested: ${waiver_type}`);
        return new Response(JSON.stringify({ success: true, waiver: waiverRequest }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'generate_1099_data': {
        const { tenant_id, tax_year } = data;
        
        // Get all subcontractors with payments for the year
        const { data: payments } = await supabase
          .from('subcontractor_payment_requests')
          .select('*, subcontractors(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'paid')
          .gte('paid_at', `${tax_year}-01-01`)
          .lte('paid_at', `${tax_year}-12-31`);

        // Aggregate by subcontractor
        const subTotals: Record<string, any> = {};
        payments?.forEach(payment => {
          const subId = payment.subcontractor_id;
          if (!subTotals[subId]) {
            subTotals[subId] = {
              subcontractor: payment.subcontractors,
              total_paid: 0,
              payment_count: 0
            };
          }
          subTotals[subId].total_paid += payment.amount;
          subTotals[subId].payment_count++;
        });

        // Filter for 1099 threshold ($600+)
        const requiresForm = Object.values(subTotals).filter(s => s.total_paid >= 600);

        console.log(`[subcontractor-payment-processor] 1099 data generated for ${requiresForm.length} subs`);
        return new Response(JSON.stringify({ 
          success: true, 
          data: {
            tax_year,
            subcontractors_requiring_1099: requiresForm.length,
            total_payments: Object.values(subTotals).reduce((sum, s) => sum + s.total_paid, 0),
            details: requiresForm
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_payment_history': {
        const { tenant_id, subcontractor_id } = data;
        
        const { data: payments, error } = await supabase
          .from('subcontractor_payment_requests')
          .select('*, jobs(*)')
          .eq('tenant_id', tenant_id)
          .eq('subcontractor_id', subcontractor_id)
          .order('submitted_at', { ascending: false });

        if (error) throw error;

        const summary = {
          total_paid: payments?.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0) || 0,
          pending: payments?.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0) || 0,
          approved: payments?.filter(p => p.status === 'approved').reduce((sum, p) => sum + p.amount, 0) || 0
        };

        return new Response(JSON.stringify({ success: true, payments, summary }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[subcontractor-payment-processor] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
