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
    console.log(`[permit-application-generator] Action: ${action}`, data);

    switch (action) {
      case 'generate_application': {
        const { tenant_id, job_id, permit_type } = data;
        
        // Get job and contact details
        const { data: job } = await supabase
          .from('jobs')
          .select('*, contacts(*), estimates(*)')
          .eq('id', job_id)
          .single();

        if (!job) {
          return new Response(JSON.stringify({ success: false, error: 'Job not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Generate permit application data
        const applicationData = {
          property_owner: {
            name: `${job.contacts?.first_name} ${job.contacts?.last_name}`,
            address: job.contacts?.address,
            city: job.contacts?.city,
            state: job.contacts?.state,
            zip: job.contacts?.zip_code,
            phone: job.contacts?.phone,
            email: job.contacts?.email
          },
          property_address: job.contacts?.address,
          work_description: job.job_type || 'Roofing repair/replacement',
          estimated_value: job.estimates?.[0]?.total || 0,
          permit_type,
          contractor_info: {
            // Would pull from tenant settings
            company_name: 'Contractor Company',
            license_number: 'CL-12345',
            insurance_info: 'General Liability $1M'
          }
        };

        // Create permit application record
        const { data: application, error } = await supabase
          .from('permit_applications')
          .insert({
            tenant_id,
            job_id,
            permit_type,
            status: 'draft',
            application_data: applicationData,
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        console.log(`[permit-application-generator] Generated permit application for job: ${job_id}`);
        return new Response(JSON.stringify({ success: true, application, application_data: applicationData }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'estimate_fees': {
        const { county, permit_type, project_value } = data;
        
        // Fee estimation based on typical county structures
        const feeStructures: Record<string, any> = {
          roofing: {
            base_fee: 75,
            per_thousand: 8.50,
            minimum: 100,
            maximum: 2500
          },
          general_construction: {
            base_fee: 150,
            per_thousand: 12.00,
            minimum: 200,
            maximum: 10000
          }
        };

        const structure = feeStructures[permit_type] || feeStructures.roofing;
        let estimatedFee = structure.base_fee + (project_value / 1000) * structure.per_thousand;
        estimatedFee = Math.max(structure.minimum, Math.min(structure.maximum, estimatedFee));

        return new Response(JSON.stringify({ 
          success: true, 
          fee_estimate: {
            county,
            permit_type,
            project_value,
            estimated_fee: Math.round(estimatedFee * 100) / 100,
            fee_structure: structure,
            disclaimer: 'This is an estimate. Actual fees may vary by jurisdiction.'
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_county_requirements': {
        const { county, state, permit_type } = data;
        
        // Return typical requirements (would be customized per county)
        const requirements = {
          documents_required: [
            'Completed permit application form',
            'Property survey or site plan',
            'Scope of work description',
            'Contractor license copy',
            'Insurance certificate',
            'Product specifications'
          ],
          processing_time: '5-10 business days',
          inspection_types: [
            { name: 'Initial inspection', when: 'Before work begins' },
            { name: 'Progress inspection', when: 'Midway through project' },
            { name: 'Final inspection', when: 'Upon completion' }
          ],
          submission_methods: ['Online portal', 'In-person', 'Mail'],
          office_hours: 'Monday-Friday 8:00 AM - 5:00 PM',
          contact_info: {
            phone: '(555) 123-4567',
            email: 'permits@county.gov',
            address: '123 Government Center'
          }
        };

        return new Response(JSON.stringify({ success: true, county, requirements }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'submit_application': {
        const { application_id } = data;
        
        const { data: application, error } = await supabase
          .from('permit_applications')
          .update({
            status: 'submitted',
            submitted_at: new Date().toISOString()
          })
          .eq('id', application_id)
          .select()
          .single();

        if (error) throw error;

        console.log(`[permit-application-generator] Submitted application: ${application_id}`);
        return new Response(JSON.stringify({ success: true, application }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'track_status': {
        const { tenant_id, job_id } = data;
        
        const { data: applications } = await supabase
          .from('permit_applications')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('job_id', job_id)
          .order('created_at', { ascending: false });

        return new Response(JSON.stringify({ success: true, applications }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[permit-application-generator] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
