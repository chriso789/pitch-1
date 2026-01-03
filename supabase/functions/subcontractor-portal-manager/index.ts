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
    console.log(`[subcontractor-portal-manager] Action: ${action}`, data);

    switch (action) {
      case 'onboard': {
        const { tenant_id, company_name, contact_name, email, phone, trades, insurance_info } = data;
        
        const { data: subcontractor, error } = await supabase
          .from('subcontractors')
          .insert({
            tenant_id,
            company_name,
            contact_name,
            email,
            phone,
            trades,
            status: 'pending_verification',
            onboarded_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        // Create document requirements
        const requiredDocs = ['w9', 'insurance_certificate', 'license'];
        for (const docType of requiredDocs) {
          await supabase
            .from('subcontractor_documents')
            .insert({
              tenant_id,
              subcontractor_id: subcontractor.id,
              document_type: docType,
              status: 'required'
            });
        }

        console.log(`[subcontractor-portal-manager] Onboarded subcontractor: ${company_name}`);
        return new Response(JSON.stringify({ success: true, subcontractor }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upload_document': {
        const { tenant_id, subcontractor_id, document_type, file_url, expiry_date } = data;
        
        const { data: doc, error } = await supabase
          .from('subcontractor_documents')
          .upsert({
            tenant_id,
            subcontractor_id,
            document_type,
            file_url,
            expiry_date,
            status: 'pending_review',
            uploaded_at: new Date().toISOString()
          }, { onConflict: 'subcontractor_id,document_type' })
          .select()
          .single();

        if (error) throw error;
        console.log(`[subcontractor-portal-manager] Uploaded document: ${document_type}`);
        return new Response(JSON.stringify({ success: true, document: doc }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'verify_documents': {
        const { subcontractor_id } = data;
        
        const { data: docs } = await supabase
          .from('subcontractor_documents')
          .select('*')
          .eq('subcontractor_id', subcontractor_id);

        const allVerified = docs?.every(doc => doc.status === 'verified');
        const expiringSoon = docs?.filter(doc => {
          if (!doc.expiry_date) return false;
          const expiry = new Date(doc.expiry_date);
          const now = new Date();
          const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return daysUntilExpiry <= 30 && daysUntilExpiry >= 0;
        });

        if (allVerified) {
          await supabase
            .from('subcontractors')
            .update({ status: 'verified' })
            .eq('id', subcontractor_id);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          verification: {
            all_verified: allVerified,
            documents: docs,
            expiring_soon: expiringSoon
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'assign_work_order': {
        const { tenant_id, subcontractor_id, job_id, scope, amount, due_date } = data;
        
        // Create work order assignment
        const workOrder = {
          tenant_id,
          subcontractor_id,
          job_id,
          scope,
          amount,
          due_date,
          status: 'assigned',
          assigned_at: new Date().toISOString()
        };

        console.log(`[subcontractor-portal-manager] Assigned work order to sub: ${subcontractor_id}`);
        return new Response(JSON.stringify({ success: true, work_order: workOrder }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'rate_subcontractor': {
        const { tenant_id, subcontractor_id, job_id, rating, feedback } = data;
        
        const { data: ratingRecord, error } = await supabase
          .from('subcontractor_ratings')
          .insert({
            tenant_id,
            subcontractor_id,
            job_id,
            rating,
            feedback,
            rated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        // Update average rating
        const { data: allRatings } = await supabase
          .from('subcontractor_ratings')
          .select('rating')
          .eq('subcontractor_id', subcontractor_id);

        const avgRating = allRatings?.reduce((sum, r) => sum + r.rating, 0) / (allRatings?.length || 1);
        
        await supabase
          .from('subcontractors')
          .update({ average_rating: avgRating })
          .eq('id', subcontractor_id);

        console.log(`[subcontractor-portal-manager] Rated subcontractor: ${rating}/5`);
        return new Response(JSON.stringify({ success: true, rating: ratingRecord, average: avgRating }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[subcontractor-portal-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
