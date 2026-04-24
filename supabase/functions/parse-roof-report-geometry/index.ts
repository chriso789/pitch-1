import { parseReportText, toCanonicalJSON } from "./parser.ts";
import { analyzeReportDiagram } from "./diagram.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const reportText: string | undefined = body?.reportText;
    const diagramImageBase64: string | undefined = body?.diagramImageBase64;
    const location = body?.location as
      | { address?: string | null; lat?: number | null; lng?: number | null }
      | undefined;

    if (!reportText) throw new Error("reportText is required");

    console.log("Parsing roof report text...");
    const measurements = parseReportText(reportText);

    let diagramGeometry: unknown | null = null;
    if (diagramImageBase64) {
      diagramGeometry = await analyzeReportDiagram(diagramImageBase64);
    }

    const canonical = toCanonicalJSON(measurements, diagramGeometry, location);

    return new Response(
      JSON.stringify({
        success: true,
        measurements,
        diagramGeometry,
        canonical,
        source: measurements.source === "unknown" ? "vendor_pdf" : measurements.source,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Parse error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
