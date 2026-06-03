import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact, computeRequestHash } from "../artifacts.ts";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")
  ?? Deno.env.get("GOOGLE_GEOCODING_API_KEY")
  ?? Deno.env.get("VITE_GOOGLE_MAPS_API_KEY")
  ?? "";

export async function runGeocodeAddress(ctx: ExecutorContext): Promise<ExecutorResult> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY not configured — cannot geocode (refusing stub completion)");
  }
  const address = String(ctx.request.input_address ?? "").trim();
  if (!address) throw new Error("request has no input_address");

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json();
  if (body.status !== "OK" || !body.results?.length) {
    throw new Error(`google geocode ${body.status}: ${body.error_message ?? "no results"}`);
  }
  const top = body.results[0];
  const lat = top.geometry?.location?.lat;
  const lon = top.geometry?.location?.lng;
  const place_id = top.place_id;
  const normalized = top.formatted_address;
  const location_type = top.geometry?.location_type;
  const partial_match = !!top.partial_match;
  const county = (top.address_components ?? [])
    .find((c: any) => (c.types ?? []).includes("administrative_area_level_2"))?.long_name ?? null;

  if (!place_id || lat == null || lon == null) {
    throw new Error("geocode response missing place_id / lat / lon");
  }
  if (location_type === "APPROXIMATE" && partial_match) {
    throw new Error("geocode is APPROXIMATE + partial_match — refusing to anchor request");
  }

  // Re-stamp request_hash now that we have the real anchor
  const newHash = await computeRequestHash({
    input_address: address,
    normalized_address: normalized,
    google_place_id: place_id,
    lat, lon,
  });

  await ctx.svc.from("mskill_requests").update({
    normalized_address: normalized,
    google_place_id: place_id,
    lat, lon, county,
    geocode_location_type: location_type,
    partial_match,
    request_hash: newHash,
    status: "resolved_base",
    status_reason: null,
  }).eq("id", ctx.mskill_request_id);

  await ctx.svc.from("mskill_jobs").update({
    request_hash: newHash,
    current_skill_key: "geocode_address",
  }).eq("id", ctx.mskill_job_id);

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "geocode_result",
    source_url: url.toString().replace(GOOGLE_MAPS_API_KEY, "REDACTED"),
    metadata: {
      place_id, lat, lon, county, normalized_address: normalized,
      location_type, partial_match,
    },
  });

  return {
    output: { place_id, lat, lon, county, normalized_address: normalized, location_type, partial_match, request_hash: newHash },
    geometry_status_patch: {},
  };
}
