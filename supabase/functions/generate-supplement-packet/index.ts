import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { supplement_case_id } = await req.json();

    const { data: caseData, error: caseError } = await supabase
      .from("supplement_cases")
      .select("*")
      .eq("id", supplement_case_id)
      .single();

    if (caseError) {
      return new Response(JSON.stringify({ error: caseError }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: disputes } = await supabase
      .from("supplement_disputes")
      .select("*")
      .eq("supplement_case_id", supplement_case_id);

    const { data: narrative } = await supabase
      .from("supplement_narratives")
      .select("*")
      .eq("supplement_case_id", supplement_case_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: carrierItems } = await supabase
      .from("carrier_estimate_line_items")
      .select("*")
      .eq("supplement_case_id", supplement_case_id);

    const requestedTotal = (disputes ?? []).reduce((sum: number, d: any) => {
      return sum + (d.requested_quantity ?? 0);
    }, 0);

    await supabase
      .from("supplement_cases")
      .update({ supplement_requested_total: requestedTotal })
      .eq("id", supplement_case_id);

    const packet = {
      title: "Roofing Supplement Request",
      case: caseData,
      carrier_items: carrierItems ?? [],
      disputes: disputes ?? [],
      narrative: narrative?.narrative ?? "",
      sections: [
        "Claim Summary",
        "Carrier Estimate Review",
        "Measurement-Based Scope Review",
        "Missing / Under-Scoped Items",
        "Supporting Justification",
        "Requested Review",
      ],
      generated_at: new Date().toISOString(),
    };

    await supabase.from("supplement_packet_exports").insert({
      supplement_case_id,
      file_url: null,
      export_type: "json_packet",
      status: "generated",
    });

    await supabase.from("supplement_activity_log").insert({
      supplement_case_id,
      activity_type: "packet_generated",
      notes: `Supplement packet generated with ${(disputes ?? []).length} disputes`,
    });

    return new Response(JSON.stringify({ packet }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
