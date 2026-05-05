import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function hasItem(items: any[], keywords: string[]) {
  return items.some((item) => {
    const text = `${item.code ?? ""} ${item.description ?? ""}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });
}

function buildDisputes(measurements: any, carrierItems: any[]) {
  const disputes: any[] = [];
  const eaves = Number(measurements.eaves || 0);
  const rakes = Number(measurements.rakes || 0);
  const hips = Number(measurements.hips || 0);
  const ridges = Number(measurements.ridges || 0);
  const valleys = Number(measurements.valleys || 0);
  const stepFlashing = Number(measurements.step_flashing || 0);
  const pitch = Number(measurements.pitch || 0);
  const squares = Number(measurements.squares || 0);
  const facets = Number(measurements.facets || 0);

  const dripEdgeQty = eaves + rakes;
  const ridgeQty = hips + ridges;

  const addMissing = (code: string, desc: string, qty: number, unit: string, kw: string[], reason: string) => {
    if (!hasItem(carrierItems, kw)) {
      disputes.push({ dispute_type: "missing_item", xactimate_code: code, description: desc, requested_quantity: qty, unit, reason });
    }
  };

  addMissing("RFG DRIP", "Drip edge / edge metal", dripEdgeQty, "LF", ["drip edge", "edge metal", "metal edge"], "Roof perimeter includes eaves/rakes requiring edge metal.");
  addMissing("RFG START", "Starter shingle course", dripEdgeQty, "LF", ["starter", "starter strip"], "Starter course required along eaves/rakes for proper wind resistance.");
  addMissing("RFG RIDGE", "Hip and ridge cap shingles", ridgeQty, "LF", ["ridge cap", "hip and ridge", "cap shingle"], "Hips and ridges require separate cap material and labor.");

  if (valleys > 0) addMissing("RFG VALLEY", "Valley metal / valley treatment", valleys, "LF", ["valley", "valley metal", "w-valley"], "Valley runs require valley treatment.");
  if (stepFlashing > 0) addMissing("RFG FLASH", "Step flashing", stepFlashing, "LF", ["step flashing", "flashing"], "Wall/roof intersections require flashing.");

  addMissing("PERMIT", "Roofing permit allowance", 1, "EA", ["permit"], "Roof replacement requires permitting.");
  addMissing("DEBRIS", "Debris removal / disposal", 1, "EA", ["debris", "dump", "haul", "disposal"], "Tear-off generates debris requiring removal.");

  if (pitch >= 7) addMissing("RFG STEEP", "Steep roof charge", squares, "SQ", ["steep", "high charge"], "Pitch meets steep-slope conditions requiring additional labor/safety.");
  if (facets >= 20) {
    disputes.push({ dispute_type: "scope_clarification", xactimate_code: "RFG COMPLEX", description: "Complex roof labor consideration", requested_quantity: squares, unit: "SQ", reason: "High facet count indicates additional cutting, staging, and detail work." });
  }

  return disputes;
}

function buildNarrative(caseData: any, disputes: any[]) {
  const lines = disputes.map((d: any, i: number) => `${i + 1}. ${d.description} — Requested: ${d.requested_quantity ?? ""} ${d.unit ?? ""}. Reason: ${d.reason}`).join("\n");
  return `Supplement Review Summary\n\nCarrier: ${caseData.carrier_name ?? "N/A"}\nClaim Number: ${caseData.claim_number ?? "N/A"}\nPolicy Number: ${caseData.policy_number ?? "N/A"}\nLoss Date: ${caseData.loss_date ?? "N/A"}\n\nAfter reviewing the carrier estimate, roof measurement data, and project scope, the following items appear to be missing, under-scoped, or requiring clarification.\n\n${lines}\n\nThese items should be reviewed against the measurement report, photos, applicable building requirements, and final field conditions.`;
}

function buildAdjusterEmail(caseData: any, disputes: any[]) {
  const list = disputes.map((d: any) => `- ${d.description}: ${d.requested_quantity ?? ""} ${d.unit ?? ""}`).join("\n");
  return `Hello,\n\nPlease review the attached supplement request for claim ${caseData.claim_number ?? ""}.\n\nDuring review, several items appear missing or under-scoped:\n\n${list}\n\nPlease review the attached documentation. Let us know if additional information is needed.\n\nThank you.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { supplement_case_id, measurements, carrier_items } = body;

    const { data: caseData, error: caseError } = await supabase.from("supplement_cases").select("*").eq("id", supplement_case_id).single();
    if (caseError) {
      return new Response(JSON.stringify({ error: caseError }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const disputes = buildDisputes(measurements, carrier_items || []);
    const narrative = buildNarrative(caseData, disputes);

    if (disputes.length > 0) {
      const { error: dErr } = await supabase.from("supplement_disputes").insert(disputes.map((d: any) => ({ supplement_case_id, ...d })));
      if (dErr) {
        return new Response(JSON.stringify({ error: dErr }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { error: nErr } = await supabase.from("supplement_narratives").insert({
      supplement_case_id,
      narrative,
      adjuster_email: buildAdjusterEmail(caseData, disputes),
    });
    if (nErr) {
      return new Response(JSON.stringify({ error: nErr }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("supplement_cases").update({ status: "review_ready", updated_at: new Date().toISOString() }).eq("id", supplement_case_id);

    return new Response(JSON.stringify({ disputes, narrative }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
