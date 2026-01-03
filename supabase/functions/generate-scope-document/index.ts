import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface XactimateLineItem {
  code: string;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

interface DamageToXactimateMapping {
  [key: string]: {
    code: string;
    description: string;
    category: string;
    unit: string;
    base_price: number;
  };
}

// Xactimate-compatible line item codes for roofing
const DAMAGE_MAPPINGS: DamageToXactimateMapping = {
  "missing_shingles": { code: "RFG SHGL", description: "Remove & replace shingles", category: "Roofing", unit: "SQ", base_price: 285.00 },
  "damaged_shingles": { code: "RFG SHGL", description: "Remove & replace damaged shingles", category: "Roofing", unit: "SQ", base_price: 285.00 },
  "curled_shingles": { code: "RFG SHGL", description: "Remove & replace curled shingles", category: "Roofing", unit: "SQ", base_price: 285.00 },
  "granule_loss": { code: "RFG SHGL", description: "Replace shingles with granule loss", category: "Roofing", unit: "SQ", base_price: 285.00 },
  "hail_damage": { code: "RFG SHGL", description: "Replace hail damaged shingles", category: "Roofing", unit: "SQ", base_price: 295.00 },
  "wind_damage": { code: "RFG SHGL", description: "Replace wind damaged shingles", category: "Roofing", unit: "SQ", base_price: 295.00 },
  "damaged_flashing": { code: "RFG FLSH", description: "Replace roof flashing", category: "Roofing", unit: "LF", base_price: 12.50 },
  "damaged_drip_edge": { code: "RFG DRPE", description: "Replace drip edge", category: "Roofing", unit: "LF", base_price: 8.75 },
  "damaged_ridge_cap": { code: "RFG RDGC", description: "Replace ridge cap", category: "Roofing", unit: "LF", base_price: 15.00 },
  "damaged_valley": { code: "RFG VALY", description: "Replace valley flashing", category: "Roofing", unit: "LF", base_price: 18.50 },
  "damaged_vent": { code: "RFG VENT", description: "Replace roof vent", category: "Roofing", unit: "EA", base_price: 125.00 },
  "damaged_pipe_boot": { code: "RFG BOOT", description: "Replace pipe boot", category: "Roofing", unit: "EA", base_price: 85.00 },
  "damaged_skylight": { code: "RFG SKLT", description: "Replace skylight", category: "Roofing", unit: "EA", base_price: 850.00 },
  "damaged_gutter": { code: "GTR ALUM", description: "Replace aluminum gutter", category: "Gutters", unit: "LF", base_price: 9.50 },
  "damaged_downspout": { code: "GTR DSPW", description: "Replace downspout", category: "Gutters", unit: "LF", base_price: 7.25 },
  "damaged_fascia": { code: "FASC WD", description: "Replace fascia board", category: "Exterior", unit: "LF", base_price: 11.00 },
  "damaged_soffit": { code: "SOFF ALU", description: "Replace soffit", category: "Exterior", unit: "SF", base_price: 8.50 },
  "damaged_siding": { code: "SDG VNYL", description: "Replace vinyl siding", category: "Siding", unit: "SF", base_price: 6.75 },
  "ice_dam_damage": { code: "RFG ICEW", description: "Install ice & water shield", category: "Roofing", unit: "SQ", base_price: 125.00 },
  "deck_damage": { code: "RFG DECK", description: "Replace roof decking", category: "Roofing", unit: "SF", base_price: 3.25 },
  "underlayment": { code: "RFG FELT", description: "Install underlayment", category: "Roofing", unit: "SQ", base_price: 45.00 },
  "tear_off": { code: "RFG TOFF", description: "Tear off existing roofing", category: "Roofing", unit: "SQ", base_price: 65.00 },
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

    const { job_id, damage_analysis, photos, insurance_claim_id } = await req.json();

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

    // Get job details for measurements
    const { data: job } = await supabase
      .from("jobs")
      .select("*, projects(*)")
      .eq("id", job_id)
      .single();

    // Generate line items from damage analysis
    const lineItems: XactimateLineItem[] = [];
    let totalAmount = 0;

    if (damage_analysis?.damage_findings) {
      for (const finding of damage_analysis.damage_findings) {
        const damageType = finding.type?.toLowerCase().replace(/\s+/g, '_');
        const mapping = DAMAGE_MAPPINGS[damageType] || DAMAGE_MAPPINGS['damaged_shingles'];
        
        // Calculate quantity based on severity and area
        let quantity = 1;
        if (finding.area_sq_ft) {
          quantity = Math.ceil(finding.area_sq_ft / 100); // Convert to squares
        } else if (finding.linear_ft) {
          quantity = Math.ceil(finding.linear_ft);
        } else if (finding.severity === 'severe') {
          quantity = 5;
        } else if (finding.severity === 'moderate') {
          quantity = 3;
        }

        const total = quantity * mapping.base_price;
        totalAmount += total;

        lineItems.push({
          code: mapping.code,
          description: `${mapping.description} - ${finding.location || 'General area'}`,
          category: mapping.category,
          quantity,
          unit: mapping.unit,
          unit_price: mapping.base_price,
          total,
        });
      }
    }

    // Add standard line items for full roof replacement if needed
    if (damage_analysis?.recommendation === 'full_replacement' && job?.projects) {
      const roofArea = job.projects.total_roof_area || 2500; // Default sq ft
      const squares = Math.ceil(roofArea / 100);

      // Add tear-off
      const tearOffMapping = DAMAGE_MAPPINGS['tear_off'];
      lineItems.unshift({
        code: tearOffMapping.code,
        description: tearOffMapping.description,
        category: tearOffMapping.category,
        quantity: squares,
        unit: tearOffMapping.unit,
        unit_price: tearOffMapping.base_price,
        total: squares * tearOffMapping.base_price,
      });
      totalAmount += squares * tearOffMapping.base_price;

      // Add underlayment
      const underlaymentMapping = DAMAGE_MAPPINGS['underlayment'];
      lineItems.push({
        code: underlaymentMapping.code,
        description: underlaymentMapping.description,
        category: underlaymentMapping.category,
        quantity: squares,
        unit: underlaymentMapping.unit,
        unit_price: underlaymentMapping.base_price,
        total: squares * underlaymentMapping.base_price,
      });
      totalAmount += squares * underlaymentMapping.base_price;
    }

    // Generate document number
    const documentNumber = `SCOPE-${Date.now().toString(36).toUpperCase()}`;

    // Create scope document
    const { data: scopeDocument, error: insertError } = await supabase
      .from("scope_documents")
      .insert({
        tenant_id: tenantId,
        insurance_claim_id,
        job_id,
        document_number: documentNumber,
        document_type: "initial_scope",
        version: 1,
        status: "draft",
        line_items: lineItems,
        damage_assessment_data: damage_analysis,
        damage_photos: photos || [],
        total_amount: totalAmount,
        xactimate_compatible: true,
        xactimate_export_data: {
          format_version: "28.0",
          line_items: lineItems.map(item => ({
            ...item,
            xactimate_code: item.code,
          })),
        },
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        scope_document: scopeDocument,
        summary: {
          total_line_items: lineItems.length,
          total_amount: totalAmount,
          categories: [...new Set(lineItems.map(i => i.category))],
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-scope-document:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
