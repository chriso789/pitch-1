import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function parseMoney(value?: string | null): number | null {
  if (!value) return null;
  return Number(value.replace(/[$,]/g, ""));
}

function detectCategory(line: string): string {
  const t = line.toLowerCase();
  if (t.includes("shingle") || t.includes("ridge") || t.includes("valley") || t.includes("drip")) return "roofing";
  if (t.includes("permit")) return "permit";
  if (t.includes("debris") || t.includes("dump") || t.includes("haul")) return "debris";
  if (t.includes("gutter")) return "gutter";
  if (t.includes("flashing")) return "flashing";
  return "other";
}

function parseCarrierLines(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const parsed: any[] = [];
  for (const line of lines) {
    const qtyMatch = line.match(/(\d+(\.\d+)?)\s?(SQ|LF|EA|SF|HR|CY|YD|FT)\b/i);
    const moneyMatches = [...line.matchAll(/\$?[\d,]+\.\d{2}/g)].map((m) => m[0]);
    const possibleCode = line.match(/\b[A-Z]{2,5}\s?[A-Z0-9]{2,8}\b/);
    parsed.push({
      raw_text: line,
      code: possibleCode?.[0] ?? null,
      description: line
        .replace(possibleCode?.[0] ?? "", "")
        .replace(qtyMatch?.[0] ?? "", "")
        .replace(/\$?[\d,]+\.\d{2}/g, "")
        .trim(),
      quantity: qtyMatch ? Number(qtyMatch[1]) : null,
      unit: qtyMatch ? qtyMatch[3].toUpperCase() : null,
      unit_price: moneyMatches.length >= 2 ? parseMoney(moneyMatches[0]) : null,
      total_price: moneyMatches.length >= 1 ? parseMoney(moneyMatches[moneyMatches.length - 1]) : null,
      category: detectCategory(line),
    });
  }
  return parsed.filter((x) => x.description.length > 2);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { supplement_case_id, raw_text } = body;

    if (!supplement_case_id || !raw_text) {
      return new Response(
        JSON.stringify({ error: "Missing supplement_case_id or raw_text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = parseCarrierLines(raw_text);
    const rows = parsed.map((item) => ({ supplement_case_id, ...item }));

    const { error } = await supabase
      .from("carrier_estimate_line_items")
      .insert(rows);

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log activity
    await supabase.from("supplement_activity_log").insert({
      supplement_case_id,
      activity_type: "carrier_parsed",
      notes: `Parsed ${parsed.length} line items from carrier estimate`,
    });

    return new Response(JSON.stringify({ parsed_items: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
