// PITCH-CRM — Universal PDF ingestion engine
// Supports: Roofr, EagleView, RoofScope, Hover, Google Maps, and generic formats
//
// Accepts either:
//   { file_url: "https://..." }
//   { bucket: "reports", path: "uploads/<file>.pdf" }   (Supabase Storage)
//   { base64_pdf: "<base64>" }                          (small PDFs only)
//
// Extracts text from PDF (via pdfjs), detects vendor, parses key measurements,
// then stores both raw+parsed output in Supabase tables.
// Falls back to AI extraction for unknown formats.

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

// Safe base64 conversion for large byte arrays (avoids stack overflow)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192; // Process 8KB at a time
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
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

type Provider = "roofr" | "eagleview" | "roofscope" | "hover" | "google" | "generic";

function detectProvider(text: string): Provider {
  const t = text.toLowerCase();
  if (t.includes("this report was prepared by roofr")) return "roofr";
  if (t.includes("eagle view technologies") || t.includes("eagleview")) return "eagleview";
  if (t.includes("roofscope")) return "roofscope";
  if (t.includes("hover.to") || t.includes("hover inc")) return "hover";
  if (t.includes("google maps") || t.includes("imagery ©") || t.includes("map data ©")) return "google";
  return "generic";
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
// Generic parser - works with any format
// -----------------------------
function parseGeneric(textRaw: string) {
  const text = normalizeText(textRaw);
  
  // Multiple patterns for area detection
  const areaPatterns = [
    /(?:total\s*)?(?:roof\s*)?area\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i,
    /A\s*\|\s*([\d,]+(?:\.\d+)?)\s*sq\s*ft/i,  // Pattern: "A | 3,897.07 sq ft"
    /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft)\s*(?:total|area)?/i,
    /(?:area|size)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  
  let totalArea: number | null = null;
  for (const pattern of areaPatterns) {
    const match = text.match(pattern);
    if (match) {
      totalArea = parseFloatSafe(match[1]);
      if (totalArea && totalArea > 100) break; // Valid area found
    }
  }
  
  // Multiple patterns for perimeter
  const perimeterPatterns = [
    /(?:perimeter|perim\.?)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /P\s*\|\s*([\d,]+(?:\.\d+)?)\s*ft/i,  // Pattern: "P | 303.83 ft"
    /(?:total\s*)?perimeter\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  
  let perimeter: number | null = null;
  for (const pattern of perimeterPatterns) {
    const match = text.match(pattern);
    if (match) {
      perimeter = parseFloatSafe(match[1]);
      if (perimeter && perimeter > 10) break;
    }
  }
  
  // Ridge detection
  const ridgePatterns = [
    /(?:ridge|ridges)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /(?:ridge|ridges)\s*(?:length)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  let ridges: number | null = null;
  for (const pattern of ridgePatterns) {
    const match = text.match(pattern);
    if (match) {
      ridges = parseFloatSafe(match[1]);
      if (ridges) break;
    }
  }
  
  // Hip detection
  const hipPatterns = [
    /(?:hip|hips)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /(?:hip|hips)\s*(?:length)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  let hips: number | null = null;
  for (const pattern of hipPatterns) {
    const match = text.match(pattern);
    if (match) {
      hips = parseFloatSafe(match[1]);
      if (hips) break;
    }
  }
  
  // Valley detection
  const valleyPatterns = [
    /(?:valley|valleys)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /(?:valley|valleys)\s*(?:length)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  let valleys: number | null = null;
  for (const pattern of valleyPatterns) {
    const match = text.match(pattern);
    if (match) {
      valleys = parseFloatSafe(match[1]);
      if (valleys) break;
    }
  }
  
  // Eave detection
  const eavePatterns = [
    /(?:eave|eaves)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /(?:eave|eaves)\s*(?:length)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  let eaves: number | null = null;
  for (const pattern of eavePatterns) {
    const match = text.match(pattern);
    if (match) {
      eaves = parseFloatSafe(match[1]);
      if (eaves) break;
    }
  }
  
  // Rake detection
  const rakePatterns = [
    /(?:rake|rakes)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i,
    /(?:rake|rakes)\s*(?:length)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  let rakes: number | null = null;
  for (const pattern of rakePatterns) {
    const match = text.match(pattern);
    if (match) {
      rakes = parseFloatSafe(match[1]);
      if (rakes) break;
    }
  }
  
  // Pitch detection
  const pitchPatterns = [
    /(?:predominant\s*)?pitch\s*[:=]?\s*(\d+\/\d+)/i,
    /(\d+\/\d+)\s*pitch/i,
    /pitch\s*[:=]?\s*(\d+:\d+)/i,
  ];
  let pitch: string | null = null;
  for (const pattern of pitchPatterns) {
    const match = text.match(pattern);
    if (match) {
      pitch = match[1].replace(":", "/");
      break;
    }
  }
  
  // Facet count
  const facetMatch = text.match(/(\d+)\s*(?:facet|facets|section|sections|plane|planes)/i);
  const facetCount = facetMatch ? parseIntSafe(facetMatch[1]) : null;
  
  // Address detection
  const addressPatterns = [
    /(\d+[^,\n]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i,
    /address\s*[:=]?\s*([^\n]+)/i,
  ];
  let address: string | null = null;
  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match) {
      address = match[1].trim();
      if (address.length > 10) break;
    }
  }
  
  // Step flashing
  const stepFlashingMatch = text.match(/step\s*flashing\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i);
  const stepFlashing = stepFlashingMatch ? parseFloatSafe(stepFlashingMatch[1]) : null;
  
  // Drip edge
  const dripEdgeMatch = text.match(/drip\s*edge\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|')/i);
  const dripEdge = dripEdgeMatch ? parseFloatSafe(dripEdgeMatch[1]) : null;
  
  return {
    provider: "generic" as const,
    address,
    total_area_sqft: totalArea,
    pitched_area_sqft: totalArea,
    flat_area_sqft: null,
    facet_count: facetCount,
    predominant_pitch: pitch,
    ridges_ft: ridges,
    hips_ft: hips,
    valleys_ft: valleys,
    rakes_ft: rakes,
    eaves_ft: eaves,
    drip_edge_ft: dripEdge,
    step_flashing_ft: stepFlashing,
    perimeter_ft: perimeter,
    pitches: null,
    waste_table: null,
  };
}

// -----------------------------
// AI Vision-powered extraction for image-based PDFs
// -----------------------------
async function extractWithVision(pdfBase64: string): Promise<any> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  
  if (!lovableApiKey) {
    console.log("roof-report-ingest: No LOVABLE_API_KEY, skipping Vision extraction");
    return null;
  }
  
  const systemPrompt = `You are a roofing measurement report analyzer with advanced OCR capabilities.
You are analyzing a PDF roof measurement report. CAREFULLY EXAMINE EVERY PAGE for measurement data.

CRITICAL INSTRUCTIONS:
1. Look at EVERY page of the document - measurements are often on different pages
2. Pay close attention to tables, diagrams, and measurement summaries
3. Look for Linear Features sections (Eaves, Ridges, Hips, Valleys, Rakes)
4. Look for Area Measurement sections and Total Sq Ft values
5. Look for address information at the top of the report

IMPORTANT: Extract the EXACT values shown. Do not estimate or guess.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields. Use null for any value not found:

{
  "provider": "detected provider name (e.g., 'roofreport', 'roofr', 'eagleview', 'obrien') or 'generic'",
  "address": "full property address if found",
  "total_area_sqft": number or null,
  "pitched_area_sqft": number or null,
  "flat_area_sqft": number or null,
  "perimeter_ft": number or null,
  "facet_count": number or null,
  "predominant_pitch": "X/12 format string or null",
  "ridges_ft": number or null,
  "hips_ft": number or null,
  "valleys_ft": number or null,
  "rakes_ft": number or null,
  "eaves_ft": number or null,
  "step_flashing_ft": number or null,
  "wall_flashing_ft": number or null,
  "drip_edge_ft": number or null
}

EXAMPLES of what to look for on each page:
- "Total Sq Ft: 3,656" or "Area: 3,656 sq ft" → total_area_sqft: 3656
- "Facets: 9" or "9 facets" → facet_count: 9
- "Predominant Pitch: 5/12" or "Pitch: 5:12" → predominant_pitch: "5/12"
- "Eaves: 144' 8\"" or "Eaves: 145 ft" → eaves_ft: 145
- "Ridges: 116'" or "Ridge Length: 116 ft" → ridges_ft: 116
- "Hips: 128' 11\"" or "Hips: 129 ft" → hips_ft: 129
- "Valleys: 0 ft" or "Valley: 0'" → valleys_ft: 0
- "Rakes: 0 ft" → rakes_ft: 0

Be thorough - check ALL pages for data.`;

  try {
    console.log("roof-report-ingest: Calling Gemini Vision API for PDF analysis...");
    
    // Use Gemini which can process PDFs natively
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash", // Gemini can process PDFs directly
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              { type: "text", text: "Analyze this roof measurement report PDF and extract ALL measurements from EVERY page:" },
              { 
                type: "image_url", 
                image_url: { 
                  url: `data:application/pdf;base64,${pdfBase64}` 
                } 
              }
            ]
          }
        ],
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("roof-report-ingest: Vision API error:", response.status, errorText);
      return null;
    }
    
    const data = await response.json();
    const responseContent = data.choices?.[0]?.message?.content;
    
    if (!responseContent) {
      console.log("roof-report-ingest: No Vision API content returned");
      return null;
    }
    
    console.log("roof-report-ingest: Vision API raw response:", responseContent.substring(0, 500));
    
    // Parse the JSON from Vision API response
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("roof-report-ingest: Could not find JSON in Vision response");
      return null;
    }
    
    const visionResult = JSON.parse(jsonMatch[0]);
    console.log("roof-report-ingest: Vision extraction successful", visionResult);
    
    return {
      provider: visionResult.provider || "generic",
      address: visionResult.address,
      total_area_sqft: visionResult.total_area_sqft,
      pitched_area_sqft: visionResult.pitched_area_sqft || visionResult.total_area_sqft,
      flat_area_sqft: visionResult.flat_area_sqft,
      facet_count: visionResult.facet_count,
      predominant_pitch: visionResult.predominant_pitch,
      ridges_ft: visionResult.ridges_ft,
      hips_ft: visionResult.hips_ft,
      valleys_ft: visionResult.valleys_ft,
      rakes_ft: visionResult.rakes_ft,
      eaves_ft: visionResult.eaves_ft,
      drip_edge_ft: visionResult.drip_edge_ft,
      step_flashing_ft: visionResult.step_flashing_ft,
      wall_flashing_ft: visionResult.wall_flashing_ft,
      perimeter_ft: visionResult.perimeter_ft,
      pitches: null,
      waste_table: null,
    };
  } catch (err) {
    console.error("roof-report-ingest: Vision extraction failed:", err);
    return null;
  }
}

// -----------------------------
// AI-powered text extraction fallback
// -----------------------------
async function extractWithAI(text: string): Promise<any> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  
  if (!lovableApiKey) {
    console.log("roof-report-ingest: No LOVABLE_API_KEY, skipping AI extraction");
    return null;
  }
  
  const systemPrompt = `You are a roofing measurement report analyzer. Extract ALL measurement data from the provided text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields. Use null for any value not found:

{
  "provider": "detected provider name or 'generic'",
  "address": "property address if found",
  "total_area_sqft": number or null,
  "perimeter_ft": number or null,
  "facet_count": number or null,
  "predominant_pitch": "X/12 format or null",
  "ridges_ft": number or null,
  "hips_ft": number or null,
  "valleys_ft": number or null,
  "rakes_ft": number or null,
  "eaves_ft": number or null,
  "step_flashing_ft": number or null,
  "drip_edge_ft": number or null
}

Look for:
- Area values (sq ft, sqft, square feet) - may appear as "A | 3,897.07 sq ft"
- Perimeter/length values (ft, feet) - may appear as "P | 303.83 ft"
- Pitch notations (4/12, 6:12, etc.)
- Feature labels (ridge, hip, valley, eave, rake)
- Any labeled measurements with units`;

  try {
    console.log("roof-report-ingest: Calling AI for measurement extraction...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract measurements from this roof report text:\n\n${text.substring(0, 8000)}` }
        ],
        max_tokens: 1000,
      }),
    });
    
    if (!response.ok) {
      console.error("roof-report-ingest: AI API error:", response.status);
      return null;
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.log("roof-report-ingest: No AI content returned");
      return null;
    }
    
    // Parse the JSON from AI response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("roof-report-ingest: Could not find JSON in AI response");
      return null;
    }
    
    const aiResult = JSON.parse(jsonMatch[0]);
    console.log("roof-report-ingest: AI extraction successful", aiResult);
    
    return {
      provider: aiResult.provider || "generic",
      address: aiResult.address,
      total_area_sqft: aiResult.total_area_sqft,
      pitched_area_sqft: aiResult.total_area_sqft,
      flat_area_sqft: null,
      facet_count: aiResult.facet_count,
      predominant_pitch: aiResult.predominant_pitch,
      ridges_ft: aiResult.ridges_ft,
      hips_ft: aiResult.hips_ft,
      valleys_ft: aiResult.valleys_ft,
      rakes_ft: aiResult.rakes_ft,
      eaves_ft: aiResult.eaves_ft,
      drip_edge_ft: aiResult.drip_edge_ft,
      step_flashing_ft: aiResult.step_flashing_ft,
      perimeter_ft: aiResult.perimeter_ft,
      pitches: null,
      waste_table: null,
    };
  } catch (err) {
    console.error("roof-report-ingest: AI extraction failed:", err);
    return null;
  }
}

// -----------------------------
// Convert PDF to base64 page images for Vision API
// -----------------------------
async function convertPdfToImages(pdfBytes: Uint8Array): Promise<string[]> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    const pageImages: string[] = [];
    
    // Process up to 6 pages
    const numPages = Math.min(pdf.numPages, 6);
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
        
        // Create a canvas-like object for rendering
        // Note: In Deno, we need to use a different approach
        // We'll use the page's operatorList to extract embedded images
        const ops = await page.getOperatorList();
        
        // For now, we'll indicate we need the Vision API but can't render in Deno
        // The Vision API call will still work if we pass the raw PDF as base64
        console.log(`roof-report-ingest: Page ${pageNum} has ${ops.fnArray.length} operations`);
      } catch (pageErr) {
        console.error(`roof-report-ingest: Error processing page ${pageNum}:`, pageErr);
      }
    }
    
    return pageImages;
  } catch (err) {
    console.error("roof-report-ingest: PDF to images conversion failed:", err);
    return [];
  }
}

// -----------------------------
// Roofr parser
// -----------------------------
function parseRoofr(textRaw: string) {
  const text = normalizeText(textRaw);

  const addrMatch = text.match(/Report summary\s*\n([^\n]+)\n/i);
  const address = addrMatch?.[1]?.trim() ?? null;

  const totalRoofArea = parseIntSafe(text.match(/Total roof area\s+([\d,]+)\s*sqft/i)?.[1]);
  const totalPitchedArea = parseIntSafe(text.match(/Total pitched area\s+([\d,]+)\s*sqft/i)?.[1]);
  const totalFlatArea = parseIntSafe(text.match(/Total flat area\s+([\d,]+)\s*sqft/i)?.[1]);
  const facetCount = parseIntSafe(text.match(/Total roof facets\s+([\d,]+)\s*facets/i)?.[1]);
  const predominantPitch = text.match(/Predominant pitch\s+(\d+\/\d+)/i)?.[1] ?? null;

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

  const pitchRows: Array<{ pitch: string; area_sqft: number }> = [];
  const pitchRe = /Pitch\s+(\d+\/\d+)\s+Area\s+\(sqft\)\s+([\d,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pitchRe.exec(text)) !== null) {
    const pitch = m[1];
    const area = parseIntSafe(m[2]);
    if (pitch && area !== null) pitchRows.push({ pitch, area_sqft: area });
  }

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

  const reportNo = text.match(/Report:\s*([0-9]{6,})/i)?.[1] ?? null;
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

// Check if parsed result has meaningful data
function hasValidMeasurements(parsed: any): boolean {
  return !!(
    parsed.total_area_sqft ||
    parsed.perimeter_ft ||
    parsed.ridges_ft ||
    parsed.hips_ft ||
    parsed.valleys_ft ||
    parsed.eaves_ft ||
    parsed.rakes_ft
  );
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
    
    console.log("roof-report-ingest: Extracted text length:", extractedText.length);
    console.log("roof-report-ingest: First 500 chars:", extractedText.substring(0, 500));

    const provider = detectProvider(extractedText);
    console.log("roof-report-ingest: Detected provider:", provider);

    let parsed: any;
    
    // Check if this is an image-based PDF (very little text extracted)
    const isImageBasedPdf = extractedText.length < 100;
    
    if (isImageBasedPdf) {
      console.log("roof-report-ingest: Image-based PDF detected (only", extractedText.length, "chars). Using Vision API...");
      
      try {
        // Convert PDF bytes to base64 using chunked conversion (avoids stack overflow)
        const pdfBase64 = bytesToBase64(pdfBytes);
        console.log("roof-report-ingest: PDF converted to base64, length:", pdfBase64.length);
        
        // Try Vision API with Gemini which can process PDFs directly
        const visionParsed = await extractWithVision(pdfBase64);
        
        if (visionParsed && hasValidMeasurements(visionParsed)) {
          parsed = visionParsed;
          console.log("roof-report-ingest: Vision API extraction successful", {
            total_area: visionParsed.total_area_sqft,
            facets: visionParsed.facet_count,
            pitch: visionParsed.predominant_pitch,
            eaves: visionParsed.eaves_ft,
            ridges: visionParsed.ridges_ft,
            hips: visionParsed.hips_ft,
            valleys: visionParsed.valleys_ft
          });
        } else {
          console.log("roof-report-ingest: Vision API returned no valid measurements, falling back to generic parser");
          parsed = parseGeneric(extractedText);
        }
      } catch (visionErr) {
        console.error("roof-report-ingest: Vision API error:", visionErr);
        parsed = parseGeneric(extractedText);
      }
    } else {
      // Text-based PDF - use provider-specific parsers
      if (provider === "roofr") {
        parsed = parseRoofr(extractedText);
      } else if (provider === "eagleview") {
        parsed = parseEagleView(extractedText);
      } else {
        // Try generic parser first
        parsed = parseGeneric(extractedText);
        console.log("roof-report-ingest: Generic parse result:", parsed);
        
        // If generic didn't find enough, try AI text extraction
        if (!hasValidMeasurements(parsed)) {
          console.log("roof-report-ingest: Generic parse sparse, trying AI extraction...");
          const aiParsed = await extractWithAI(extractedText);
          if (aiParsed && hasValidMeasurements(aiParsed)) {
            parsed = aiParsed;
            console.log("roof-report-ingest: Using AI extraction result");
          }
        }
      }
    }

    // Store raw + parsed
    const lead_id = body.lead_id ?? null;

    const insertPayload = {
      lead_id,
      provider: parsed.provider || provider,
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

    // Also upsert a normalized measurements row
    const m = {
      report_id: reportRow.id,
      provider: parsed.provider || provider,
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
      perimeter_ft: parsed.perimeter_ft ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      pitches: parsed.pitches ?? null,
      waste_table: parsed.waste_table ?? null,
    };

    const { error: measErr } = await supabase.from("roof_measurements_truth").insert(m);
    if (measErr) console.warn("roof_measurements_truth insert failed:", measErr.message);

    console.log("roof-report-ingest: Successfully processed report", { 
      provider: parsed.provider || provider, 
      address: parsed.address,
      total_area_sqft: parsed.total_area_sqft,
      perimeter_ft: parsed.perimeter_ft
    });

    return new Response(
      JSON.stringify({ ok: true, provider: parsed.provider || provider, parsed, report_row: reportRow }),
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
