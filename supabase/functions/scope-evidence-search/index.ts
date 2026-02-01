// ============================================================
// SCOPE EVIDENCE SEARCH
// Find prior paid examples for disputed line items
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SearchRequest {
  canonical_item_id: string;
  carrier_normalized?: string;
  state_code?: string;
  include_network?: boolean;
  conditions?: {
    pitch_category?: string;
    story_count?: number;
    is_tearoff?: boolean;
  };
  limit?: number;
}

interface PriorPaidExample {
  id: string;
  document_id: string;
  carrier_normalized: string;
  state_code: string | null;
  loss_year: number | null;
  quantity: number | null;
  unit_price: number | null;
  total_rcv: number | null;
  snippet_text?: string;
  page_number?: number;
}

interface PriceStats {
  median: number;
  p25: number;
  p75: number;
  avg: number;
  min: number;
  max: number;
  paid_rate: number;
  sample_count: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", user.id)
      .single();
    
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error("User has no tenant");
    }

    const body: SearchRequest = await req.json();
    const limit = body.limit || 25;

    console.log("[evidence-search] Searching:", {
      canonical_item_id: body.canonical_item_id,
      carrier: body.carrier_normalized,
      state: body.state_code,
      include_network: body.include_network
    });

    // Search internal examples (same tenant)
    let internalQuery = supabase
      .from("insurance_scope_line_items")
      .select(`
        id,
        quantity,
        unit_price,
        total_rcv,
        total_acv,
        raw_description,
        raw_code,
        document:insurance_scope_documents!inner(
          id,
          tenant_id,
          carrier_normalized,
          loss_date_detected,
          property_state,
          property_address
        )
      `)
      .eq("canonical_item_id", body.canonical_item_id)
      .eq("document.tenant_id", tenantId)
      .not("unit_price", "is", null)
      .order("unit_price", { ascending: false })
      .limit(limit);

    if (body.carrier_normalized) {
      internalQuery = internalQuery.eq("document.carrier_normalized", body.carrier_normalized);
    }

    if (body.state_code) {
      internalQuery = internalQuery.eq("document.property_state", body.state_code);
    }

    const { data: internalResults, error: internalError } = await internalQuery;
    
    if (internalError) {
      console.error("[evidence-search] Internal query error:", internalError);
      throw internalError;
    }

    // Transform internal results
    const internalExamples: PriorPaidExample[] = (internalResults || []).map(item => {
      const doc = item.document as any;
      const lossDate = doc?.loss_date_detected ? new Date(doc.loss_date_detected) : null;
      
      return {
        id: item.id,
        document_id: doc?.id,
        carrier_normalized: doc?.carrier_normalized || 'unknown',
        state_code: doc?.property_state || null,
        loss_year: lossDate ? lossDate.getFullYear() : null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_rcv: item.total_rcv,
        snippet_text: item.raw_description,
      };
    });

    // Get evidence snippets for each example
    const evidenceMap = new Map<string, { snippet_text: string; page_number: number }>();
    
    if (internalExamples.length > 0) {
      const lineItemIds = internalExamples.map(e => e.id);
      const { data: evidence } = await supabase
        .from("insurance_scope_line_item_evidence")
        .select("line_item_id, snippet_text, page_number")
        .in("line_item_id", lineItemIds)
        .eq("field_type", "description");

      for (const ev of evidence || []) {
        if (!evidenceMap.has(ev.line_item_id)) {
          evidenceMap.set(ev.line_item_id, {
            snippet_text: ev.snippet_text,
            page_number: ev.page_number
          });
        }
      }
    }

    // Enrich examples with evidence
    for (const example of internalExamples) {
      const ev = evidenceMap.get(example.id);
      if (ev) {
        example.snippet_text = ev.snippet_text;
        example.page_number = ev.page_number;
      }
    }

    // Search network contributions if requested
    let networkExamples: PriorPaidExample[] = [];
    
    if (body.include_network) {
      let networkQuery = supabase
        .from("insurance_network_contributions")
        .select("*")
        .eq("canonical_item_id", body.canonical_item_id)
        .eq("was_paid", true)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (body.carrier_normalized) {
        networkQuery = networkQuery.eq("carrier_normalized", body.carrier_normalized);
      }
      if (body.state_code) {
        networkQuery = networkQuery.eq("state_code", body.state_code);
      }
      if (body.conditions?.pitch_category) {
        networkQuery = networkQuery.eq("pitch_category", body.conditions.pitch_category);
      }
      if (body.conditions?.story_count) {
        networkQuery = networkQuery.eq("story_count", body.conditions.story_count);
      }
      if (body.conditions?.is_tearoff !== undefined) {
        networkQuery = networkQuery.eq("is_tearoff", body.conditions.is_tearoff);
      }

      const { data: networkResults } = await networkQuery;
      
      // Note: Network examples don't have document_id (anonymized)
      networkExamples = (networkResults || []).map(item => ({
        id: item.id,
        document_id: '', // Anonymized
        carrier_normalized: item.carrier_normalized,
        state_code: item.state_code,
        loss_year: item.loss_year,
        quantity: null, // Bucketed in network contributions
        unit_price: null, // Bucketed in network contributions
        total_rcv: null,
        snippet_text: item.redacted_snippet || undefined,
      }));
    }

    // Calculate price statistics from internal examples
    const prices = internalExamples
      .map(e => e.unit_price)
      .filter((p): p is number => p !== null && p > 0)
      .sort((a, b) => a - b);

    const priceStats: PriceStats = {
      median: 0,
      p25: 0,
      p75: 0,
      avg: 0,
      min: 0,
      max: 0,
      paid_rate: 1.0, // Internal examples are all paid
      sample_count: prices.length
    };

    if (prices.length > 0) {
      priceStats.min = prices[0];
      priceStats.max = prices[prices.length - 1];
      priceStats.median = prices[Math.floor(prices.length / 2)];
      priceStats.avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      
      if (prices.length >= 4) {
        priceStats.p25 = prices[Math.floor(prices.length * 0.25)];
        priceStats.p75 = prices[Math.floor(prices.length * 0.75)];
      } else {
        priceStats.p25 = priceStats.min;
        priceStats.p75 = priceStats.max;
      }
    }

    // Get canonical item details
    const { data: canonicalItem } = await supabase
      .from("insurance_canonical_items")
      .select("*")
      .eq("id", body.canonical_item_id)
      .single();

    console.log("[evidence-search] Results:", {
      internal_count: internalExamples.length,
      network_count: networkExamples.length,
      price_stats: priceStats
    });

    return new Response(JSON.stringify({
      success: true,
      canonical_item: canonicalItem,
      internal_examples: internalExamples,
      network_examples: networkExamples,
      price_stats: priceStats,
      total_examples: internalExamples.length + networkExamples.length
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[evidence-search] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
