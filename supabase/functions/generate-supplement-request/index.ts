import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { insurance_claim_id, original_scope_id, additional_damages, reason, photos } = await req.json();

    // Get user's tenant
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    const tenantId = userProfile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get original scope document
    const { data: originalScope } = await supabase
      .from("scope_documents")
      .select("*")
      .eq("id", original_scope_id)
      .single();

    if (!originalScope) {
      return new Response(JSON.stringify({ error: "Original scope document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map additional damages to line items
    const additionalItems = [];
    let requestedAmount = 0;

    for (const damage of additional_damages || []) {
      const item = {
        code: damage.code || "RFG MISC",
        description: damage.description,
        category: damage.category || "Roofing",
        quantity: damage.quantity || 1,
        unit: damage.unit || "EA",
        unit_price: damage.unit_price || 100,
        total: (damage.quantity || 1) * (damage.unit_price || 100),
        reason: damage.reason || "Discovered during installation",
        original_scope_included: false,
      };
      requestedAmount += item.total;
      additionalItems.push(item);
    }

    // Generate supplement number
    const supplementNumber = `SUPP-${Date.now().toString(36).toUpperCase()}`;

    // Create supplement request
    const { data: supplement, error: insertError } = await supabase
      .from("supplement_requests")
      .insert({
        tenant_id: tenantId,
        insurance_claim_id,
        scope_document_id: original_scope_id,
        supplement_number: supplementNumber,
        reason,
        additional_items: additionalItems,
        supporting_photos: photos || [],
        original_amount: originalScope.total_amount,
        requested_amount: requestedAmount,
        status: "draft",
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // Create new scope document version for supplement
    const supplementScopeNumber = `${originalScope.document_number}-S1`;
    const { data: supplementScope } = await supabase
      .from("scope_documents")
      .insert({
        tenant_id: tenantId,
        insurance_claim_id,
        job_id: originalScope.job_id,
        document_number: supplementScopeNumber,
        document_type: "supplement",
        version: (originalScope.version || 1) + 1,
        status: "draft",
        line_items: additionalItems,
        damage_photos: photos || [],
        total_amount: requestedAmount,
        xactimate_compatible: true,
        created_by: user.id,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        supplement_request: supplement,
        supplement_scope: supplementScope,
        summary: {
          original_amount: originalScope.total_amount,
          supplement_amount: requestedAmount,
          new_total: (originalScope.total_amount || 0) + requestedAmount,
          additional_items_count: additionalItems.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-supplement-request:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
