export function parseIntSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? Math.trunc(v) : null;
}

export function parseFloatSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

export function normalizeText(t: string): string {
  return t
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n");
}

export function parseXactimateInsuranceScopeText(textRaw: string) {
  const text = normalizeText(textRaw);

  const surfaceAreaMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Surface\s*Are?a?/i)
                        || text.match(/Surface\s*Are?a?\s*([\d,]+(?:\.\d+)?)/i);
  const surfaceArea = surfaceAreaMatch ? parseFloatSafe(surfaceAreaMatch[1]) : null;

  const squaresMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Number\s*of\s*Squares/i)
                    || text.match(/Number\s*of\s*Squares\s*([\d,]+(?:\.\d+)?)/i);
  const squares = squaresMatch ? parseFloatSafe(squaresMatch[1]) : null;

  const perimeterMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Total\s*Perimeter\s*Length/i)
                      || text.match(/Total\s*Perimeter\s*Length\s*([\d,]+(?:\.\d+)?)/i);
  const perimeter = perimeterMatch ? parseFloatSafe(perimeterMatch[1]) : null;

  const ridgeMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Total\s*Ridge\s*Length/i)
                  || text.match(/Total\s*Ridge\s*Length\s*([\d,]+(?:\.\d+)?)/i);
  const ridge = ridgeMatch ? parseFloatSafe(ridgeMatch[1]) : null;

  const hipMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Total\s*Hip\s*Length/i)
                || text.match(/Total\s*Hip\s*Length\s*([\d,]+(?:\.\d+)?)/i);
  const hip = hipMatch ? parseFloatSafe(hipMatch[1]) : null;

  const valleyMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Total\s*Valley\s*Length/i)
                   || text.match(/Total\s*Valley\s*Length\s*([\d,]+(?:\.\d+)?)/i);
  const valley = valleyMatch ? parseFloatSafe(valleyMatch[1]) : null;

  const rakeMatch = text.match(/([\d,]+(?:\.\d+)?)\s*Total\s*Rake\s*Length/i)
                 || text.match(/Total\s*Rake\s*Length\s*([\d,]+(?:\.\d+)?)/i);
  const rake = rakeMatch ? parseFloatSafe(rakeMatch[1]) : null;

  const singleLineAddressMatch = text.match(/(\d+[^,\n]+,\s*[A-Z\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i);
  const propertyBlockMatch = text.match(/Property:\s*([\s\S]{0,220}?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
  const address = singleLineAddressMatch
    ? singleLineAddressMatch[1].trim()
    : propertyBlockMatch
      ? propertyBlockMatch[1].replace(/\s+/g, " ").trim()
      : null;

  const facetMatches = text.match(/\bF\d+\b/g);
  const uniqueFacets = facetMatches ? new Set(facetMatches).size : null;
  const flatArea = squares ? squares * 100 : null;

  const dripEdgeMatch = text.match(/Drip\s*edge[^0-9\n]*([\d,]+(?:\.\d+)?)\s*(?:LF|SF|EA|LN\.?\s*FT|FT)?/i);
  const dripEdge = dripEdgeMatch ? parseFloatSafe(dripEdgeMatch[1]) : perimeter;

  const hipRidgeCapMatch = text.match(/Hip\s*\/\s*Ridge\s*cap[^0-9\n]*([\d,]+(?:\.\d+)?)\s*(?:LF|SF|EA|LN\.?\s*FT|FT)?/i)
                        || text.match(/Hip\s*&\s*Ridge\s*cap[^0-9\n]*([\d,]+(?:\.\d+)?)\s*(?:LF|SF|EA|LN\.?\s*FT|FT)?/i);
  const hipRidgeCap = hipRidgeCapMatch ? parseFloatSafe(hipRidgeCapMatch[1]) : null;

  const stepFlashingMatch = text.match(/Step\s*flashing[^0-9\n]*([\d,]+(?:\.\d+)?)\s*(?:LF|SF|EA|LN\.?\s*FT|FT)?/i);
  const stepFlashing = stepFlashingMatch ? parseFloatSafe(stepFlashingMatch[1]) : null;

  const starterMatch = text.match(/Starter[^0-9\n]*([\d,]+(?:\.\d+)?)\s*(?:LF|SF|EA|LN\.?\s*FT|FT)?/i);
  const starter = starterMatch ? parseFloatSafe(starterMatch[1]) : null;

  let derivedPitch: string | null = null;
  if (surfaceArea && flatArea && flatArea > 0) {
    const ratio = surfaceArea / flatArea;
    if (ratio < 1.02) derivedPitch = "flat";
    else if (ratio < 1.035) derivedPitch = "3/12";
    else if (ratio < 1.055) derivedPitch = "4/12";
    else if (ratio < 1.075) derivedPitch = "5/12";
    else if (ratio < 1.095) derivedPitch = "6/12";
    else if (ratio < 1.12) derivedPitch = "7/12";
    else if (ratio < 1.15) derivedPitch = "8/12";
    else if (ratio < 1.18) derivedPitch = "9/12";
    else if (ratio < 1.21) derivedPitch = "10/12";
    else if (ratio < 1.25) derivedPitch = "11/12";
    else derivedPitch = "12/12";
  }

  const explicitPitchMatch = text.match(/(\d+)\s*\/\s*12\s*pitch/i)
                          || text.match(/pitch\s*[:=]?\s*(\d+)\s*\/\s*12/i);
  const explicitPitch = explicitPitchMatch ? `${explicitPitchMatch[1]}/12` : null;

  return {
    provider: "xactimate" as const,
    address,
    total_area_sqft: surfaceArea,
    pitched_area_sqft: surfaceArea,
    flat_area_sqft: flatArea,
    facet_count: uniqueFacets,
    predominant_pitch: explicitPitch || derivedPitch,
    ridges_ft: ridge,
    hips_ft: hip,
    valleys_ft: valley,
    rakes_ft: rake || 0,
    eaves_ft: perimeter,
    drip_edge_ft: dripEdge,
    step_flashing_ft: stepFlashing,
    perimeter_ft: perimeter,
    pitches: null,
    waste_table: null,
    squares,
    hip_ridge_cap_lf: hipRidgeCap,
    starter_lf: starter,
  };
}

function isMissingOrZero(value: unknown): boolean {
  const numeric = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || !Number.isFinite(numeric) || numeric <= 0;
}

export function needsInsuranceScopeVisionCompletenessFallback(parsed: any, provider: string): boolean {
  if (!parsed || provider !== "xactimate") return false;
  const facets = typeof parsed.facet_count === "number" ? parsed.facet_count : Number(parsed.facet_count || 0);
  const area = typeof parsed.total_area_sqft === "number" ? parsed.total_area_sqft : Number(parsed.total_area_sqft || 0);
  if (!Number.isFinite(area) || area < 500 || !Number.isFinite(facets) || facets < 6) return false;
  return isMissingOrZero(parsed.hips_ft) || parsed.valleys_ft === null || parsed.valleys_ft === undefined;
}

export function mergeMeasurementCompletenessFallback(primary: any, fallback: any) {
  if (!fallback) return primary;
  const merged = { ...(primary || {}) };
  for (const field of ["hips_ft", "valleys_ft", "ridges_ft", "rakes_ft", "eaves_ft", "perimeter_ft", "drip_edge_ft", "step_flashing_ft"]) {
    const current = merged[field];
    const candidate = fallback[field];
    const currentNum = typeof current === "number" ? current : Number(current);
    const candidateNum = typeof candidate === "number" ? candidate : Number(candidate);
    const currentMissing = current === null || current === undefined || !Number.isFinite(currentNum);
    const shouldReplaceZeroLinear = ["hips_ft", "valleys_ft"].includes(field) && Number.isFinite(currentNum) && currentNum <= 0 && Number.isFinite(candidateNum) && candidateNum > 0;
    if ((currentMissing || shouldReplaceZeroLinear) && Number.isFinite(candidateNum)) {
      merged[field] = candidateNum;
    }
  }
  return merged;
}

export function buildPdfFileContentBlock(pdfBase64: string, filename = "roof-report.pdf") {
  return {
    type: "file" as const,
    file: {
      filename,
      file_data: `data:application/pdf;base64,${pdfBase64}`,
    },
  };
}