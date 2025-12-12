// PITCH-CRM — Vendor PDF ingestion engine (Roofr + EagleView)
//
// Accepts either:
//   { file_url: "https://..." }
//   { bucket: "reports", path: "uploads/<file>.pdf" }   (Supabase Storage)
//   { base64_pdf: "<base64>" }                          (small PDFs only)
//
// Extracts text from PDF (via pdfjs), detects vendor, parses key measurements,
// then stores both raw+parsed output in Supabase tables.
//
// Requires env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "npm:pdfjs-dist@4.3.136/legacy/build/pdf.mjs";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function parseIntSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? Math.trunc(v) : null;
}

function parseFloatSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function feetInchesToFeet(ft: string, inch: string): number {
  const f = n(ft);
  const i = n(inch);
  return f + (i / 12);
}

function normalizeText(t: string): string {
  return t
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n");
}

function detectProvider(text: string): "roofr" | "eagleview" | "unknown" {
  const t = text.toLowerCase();
  if (t.includes("this report was prepared by roofr")) return "roofr";
  if (t.includes("eagle view technologies") || t.includes("eagleview")) return "eagleview";
  return "unknown";
}

function extractAllPagesText(pdfBytes: Uint8Array): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  return loadingTask.promise.then(async (pdf: any) => {
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map((it: any) => it.str);
      pages.push(strings.join("\n"));
    }
    return pages.join("\n");
  });
}

// -----------------------------
// Roofr parser
// -----------------------------
function parseRoofr(textRaw: string) {
  const text = normalizeText(textRaw);

  // Address: try the "Report summary" section header
  const addrMatch = text.match(/Report summary\s*\n([^\n]+)\n/i);
  const address = addrMatch?.[1]?.trim() ?? null;

  const totalRoofArea = parseIntSafe(text.match(/Total roof area\s+([\d,]+)\s*sqft/i)?.[1]);
  const totalPitchedArea = parseIntSafe(text.match(/Total pitched area\s+([\d,]+)\s*sqft/i)?.[1]);
  const totalFlatArea = parseIntSafe(text.match(/Total flat area\s+([\d,]+)\s*sqft/i)?.[1]);
  const facetCount = parseIntSafe(text.match(/Total roof facets\s+([\d,]+)\s*facets/i)?.[1]);
  const predominantPitch = text.match(/Predominant pitch\s+(\d+\/\d+)/i)?.[1] ?? null;

  // Linear features in "Total eaves 258ft 9in"
  function parseFtIn(key: string) {
    const m = text.match(new RegExp(`${key}\\s+(\\d+)\\s*ft\\s*(\\d+)\\s*in`, "i"));
    if (!m) return null;
    return feetInchesToFeet(m[1], m[2]);
  }

  const eaves = parseFtIn("Total eaves");
  const valleys = parseFtIn("Total valleys");
  const hips = parseFtIn("Total hips");
  const ridges = parseFtIn("Total ridges");
  const rakes = parseFtIn("Total rakes");
  const wallFlashing = parseFtIn("Total wall flashing");
  const stepFlashing = parseFtIn("Total step flashing");
  const transitions = parseFtIn("Total transitions");
  const parapetWall = parseFtIn("Total parapet wall");
  const unspecified = parseFtIn("Total unspecified");

  // Pitch rows: "Pitch 6/12 ... Area (sqft) 3,077"
  const pitchRows: Array<{ pitch: string; area_sqft: number }> = [];
  const pitchRe = /Pitch\s+(\d+\/\d+)\s+Area\s+\(sqft\)\s+([\d,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pitchRe.exec(text)) !== null) {
    const pitch = m[1];
    const area = parseIntSafe(m[2]);
    if (pitch && area !== null) pitchRows.push({ pitch, area_sqft: area });
  }

  // Waste table: parse 0/10/12/15/17/20/22
  const wastePercents = [0, 10, 12, 15, 17, 20, 22];
  const wasteAreaLine = text.match(/Area\s+\(sqft\)\s+([\d,\s]+)/i);
  const wasteSquaresLine = text.match(/Squares\s+([\d\.\s]+)/i);

  const wasteAreas = wasteAreaLine
    ? wasteAreaLine[1].trim().split(/\s+/).map((x) => parseIntSafe(x)).filter((x): x is number => x !== null)
    : [];
  const wasteSquares = wasteSquaresLine
    ? wasteSquaresLine[1].trim().split(/\s+/).map((x) => parseFloatSafe(x)).filter((x): x is number => x !== null)
    : [];

  const wasteTable = wastePercents.map((pct, i) => ({
    waste_pct: pct,
    area_sqft: wasteAreas[i] ?? null,
    squares: wasteSquares[i] ?? null,
  }));

  return {
    provider: "roofr",
    address,
    total_area_sqft: totalRoofArea,
    pitched_area_sqft: totalPitchedArea ?? totalRoofArea,
    flat_area_sqft: totalFlatArea,
    facet_count: facetCount,
    predominant_pitch: predominantPitch,
    ridges_ft: ridges,
    hips_ft: hips,
    valleys_ft: valleys,
    rakes_ft: rakes,
    eaves_ft: eaves,
    wall_flashing_ft: wallFlashing,
    step_flashing_ft: stepFlashing,
    transitions_ft: transitions,
    parapet_walls_ft: parapetWall,
    unspecified_ft: unspecified,
    pitches: pitchRows.length ? pitchRows : null,
    waste_table: wasteTable,
  };
}

// -----------------------------
// EagleView parser
// -----------------------------
function parseEagleView(textRaw: string) {
  const text = normalizeText(textRaw);

  // Address + report number commonly appear near "Report:" on summary pages
  const reportNo = text.match(/Report:\s*([0-9]{6,})/i)?.[1] ?? null;

  // A best-effort address line: "... , ST 12345 ... Report:"
  const addrMatch = text.match(/([^\n]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)\s+Report:\s*[0-9]{6,}/i);
  const address = addrMatch?.[1]?.trim() ?? null;

  const facetCount = parseIntSafe(text.match(/Total Roof Facets\s*=\s*([0-9]+)/i)?.[1]);
  const totalArea = parseIntSafe(text.match(/Total Area\s*=\s*([\d,]+)\s*sq ft/i)?.[1]);
  const predominantPitch = text.match(/Predominant Pitch\s*=\s*(\d+\/\d+)/i)?.[1] ?? null;

  const longitude = parseFloatSafe(text.match(/Longitude\s*=\s*([\-\d\.]+)/i)?.[1]);
  const latitude = parseFloatSafe(text.match(/Latitude\s*=\s*([\-\d\.]+)/i)?.[1]);

  function parseLen(label: string) {
    const re = new RegExp(`${label}\\s*=\\s*([\\d,]+)\\s*ft`, "i");
    const m = text.match(re);
    if (!m) return null;
    return n(parseFloatSafe(m[1]));
  }

  const ridges = parseLen("Ridges");
  const hips = parseLen("Hips");
  const valleys = parseLen("Valleys");
  const rakes = parseLen("Rakes\\*");
  const eaves = parseLen("Eaves\/Starter\\*\\*");
  const dripEdge = parseLen("Drip Edge \\(Eaves \\+ Rakes\\)");
  const parapet = parseLen("Parapet Walls");
  const flashing = parseLen("Flashing");
  const stepFlashing = parseLen("Step flashing");

  // Pitch breakdown block:
  // - a line with multiple pitches like "0/12 4/12 5/12 ..."
  // - next line areas
  // - next line percents
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  let pitches: string[] | null = null;
  let pitchAreas: number[] | null = null;
  let pitchPercents: number[] | null = null;

  for (let i = 0; i < lines.length - 2; i++) {
    const p = lines[i].match(/\b\d+\/\d+\b/g);
    if (p && p.length >= 1) {
      const a = lines[i + 1].match(/[\d]+\.[\d]+|[\d]+/g);
      const pc = lines[i + 2].match(/[\d]+\.[\d]+%|[\d]+%/g);
      if (a && a.length >= p.length && pc && pc.length >= p.length) {
        pitches = p;
        pitchAreas = a.slice(0, p.length).map((x) => Number(x));
        pitchPercents = pc.slice(0, p.length).map((x) => Number(x.replace("%", "")));
        break;
      }
    }
  }

  const pitchRows = pitches && pitchAreas
    ? pitches.map((pitch, idx) => ({
        pitch,
        area_sqft: pitchAreas![idx],
        percent: pitchPercents ? pitchPercents[idx] : null,
      }))
    : null;

  // Waste table
  const wastePercents = [0, 10, 12, 15, 17, 20, 22];
  const wasteAreaMatch = text.match(/Area\s+\(sq ft\)\s+([\d,\s]+)/i);
  const wasteSquaresMatch = text.match(/Squares\s+([\d\.\s]+)/i);

  const wasteAreas = wasteAreaMatch
    ? wasteAreaMatch[1].trim().split(/\s+/).map((x) => parseIntSafe(x)).filter((x): x is number => x !== null)
    : [];
  const wasteSquares = wasteSquaresMatch
    ? wasteSquaresMatch[1].trim().split(/\s+/).map((x) => parseFloatSafe(x)).filter((x): x is number => x !== null)
    : [];

  const wasteTable = wastePercents.map((pct, i) => ({
    waste_pct: pct,
    area_sqft: wasteAreas[i] ?? null,
    squares: wasteSquares[i] ?? null,
  }));

  return {
    provider: "eagleview",
    report_number: reportNo,
    address,
    total_area_sqft: totalArea,
    facet_count: facetCount,
    predominant_pitch: predominantPitch,
    longitude,
    latitude,
    // linears
    ridges_ft: ridges,
    hips_ft: hips,
    valleys_ft: valleys,
    rakes_ft: rakes,
    eaves_ft: eaves,
    drip_edge_ft: dripEdge,
    parapet_walls_ft: parapet,
    flashing_ft: flashing,
    step_flashing_ft: stepFlashing,
    pitches: pitchRows,
    waste_table: wasteTable,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) {
      return new Response(
        JSON.stringify({ error: "missing_env", message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRole);

    let pdfBytes: Uint8Array | null = null;
    let file_url: string | null = body.file_url ?? null;
    const bucket: string | null = body.bucket ?? null;
    const path: string | null = body.path ?? null;
    const base64: string | null = body.base64_pdf ?? null;

    console.log("roof-report-ingest: Processing request", { 
      has_file_url: !!file_url, 
      has_bucket: !!bucket, 
      has_path: !!path, 
      has_base64: !!base64 
    });

    if (!file_url && bucket && path) {
      const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
      if (error) throw new Error(`createSignedUrl_failed: ${error.message}`);
      file_url = signed.signedUrl;
    }

    if (file_url) {
      const res = await fetch(file_url);
      if (!res.ok) throw new Error(`fetch_pdf_failed: ${res.status} ${res.statusText}`);
      pdfBytes = new Uint8Array(await res.arrayBuffer());
    } else if (base64) {
      // base64 to bytes (works for small PDFs)
      const bin = atob(base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      pdfBytes = arr;
    } else {
      return new Response(
        JSON.stringify({ error: "missing_input", message: "Provide file_url OR (bucket+path) OR base64_pdf" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    console.log("roof-report-ingest: Extracting text from PDF...");
    const extractedTextRaw = await extractAllPagesText(pdfBytes);
    const extractedText = normalizeText(extractedTextRaw);

    const provider = detectProvider(extractedText);
    console.log("roof-report-ingest: Detected provider:", provider);

    let parsed: any;
    if (provider === "roofr") parsed = parseRoofr(extractedText);
    else if (provider === "eagleview") parsed = parseEagleView(extractedText);
    else parsed = { provider: "unknown" };

    // Store raw + parsed
    const lead_id = body.lead_id ?? null;

    const insertPayload = {
      lead_id,
      provider,
      report_number: parsed.report_number ?? null,
      address: parsed.address ?? null,
      file_bucket: bucket,
      file_path: path,
      file_url,
      extracted_text: extractedText,
      parsed,
    };

    console.log("roof-report-ingest: Inserting into roof_vendor_reports...");
    const { data: reportRow, error: insertErr } = await supabase
      .from("roof_vendor_reports")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr) throw new Error(`db_insert_failed: ${insertErr.message}`);

    // Also upsert a normalized measurements row (best-effort)
    const m = {
      report_id: reportRow.id,
      provider,
      report_number: parsed.report_number ?? null,
      address: parsed.address ?? null,
      total_area_sqft: parsed.total_area_sqft ?? null,
      pitched_area_sqft: parsed.pitched_area_sqft ?? null,
      flat_area_sqft: parsed.flat_area_sqft ?? null,
      facet_count: parsed.facet_count ?? null,
      predominant_pitch: parsed.predominant_pitch ?? null,
      ridges_ft: parsed.ridges_ft ?? null,
      hips_ft: parsed.hips_ft ?? null,
      valleys_ft: parsed.valleys_ft ?? null,
      rakes_ft: parsed.rakes_ft ?? null,
      eaves_ft: parsed.eaves_ft ?? null,
      drip_edge_ft: parsed.drip_edge_ft ?? null,
      parapet_walls_ft: parsed.parapet_walls_ft ?? null,
      flashing_ft: parsed.flashing_ft ?? null,
      step_flashing_ft: parsed.step_flashing_ft ?? null,
      wall_flashing_ft: parsed.wall_flashing_ft ?? null,
      transitions_ft: parsed.transitions_ft ?? null,
      unspecified_ft: parsed.unspecified_ft ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      pitches: parsed.pitches ?? null,
      waste_table: parsed.waste_table ?? null,
    };

    const { error: measErr } = await supabase.from("roof_measurements_truth").insert(m);
    // Don't fail hard if this insert fails; the raw row is the important part.
    if (measErr) console.warn("roof_measurements_truth insert failed:", measErr.message);

    console.log("roof-report-ingest: Successfully processed report", { provider, address: parsed.address });

    return new Response(
      JSON.stringify({ ok: true, provider, parsed, report_row: reportRow }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("roof-report-ingest error:", err);
    return new Response(
      JSON.stringify({ error: "roof-report-ingest_failed", message: err instanceof Error ? err.message : String(err) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
