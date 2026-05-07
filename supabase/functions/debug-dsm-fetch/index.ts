/**
 * Debug edge function to test Google Solar DSM fetch in isolation.
 * Returns detailed diagnostics about every step of the DSM pipeline.
 */
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
  const GOOGLE_SOLAR_API_KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || GOOGLE_MAPS_API_KEY;

  try {
    const body = await req.json();
    const lat = body.latitude ?? body.lat ?? 27.0558;
    const lng = body.longitude ?? body.lng ?? -82.1828;

    const diagnostics: Record<string, unknown> = {
      lat,
      lng,
      google_maps_api_key_present: !!GOOGLE_MAPS_API_KEY,
      google_maps_api_key_length: GOOGLE_MAPS_API_KEY.length,
      google_solar_api_key_present: !!GOOGLE_SOLAR_API_KEY,
      google_solar_api_key_length: GOOGLE_SOLAR_API_KEY.length,
      google_solar_api_key_prefix: GOOGLE_SOLAR_API_KEY.substring(0, 6),
    };

    // Step 1: Test Building Insights
    const biUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_SOLAR_API_KEY}`;
    try {
      const biResp = await fetch(biUrl);
      const biBody = await biResp.text();
      diagnostics.building_insights_status = biResp.status;
      diagnostics.building_insights_content_type = biResp.headers.get("content-type");
      if (biResp.ok) {
        const biJson = JSON.parse(biBody);
        diagnostics.building_insights_has_solar_potential = !!biJson.solarPotential;
        diagnostics.building_insights_center = biJson.center;
        diagnostics.building_insights_imagery_date = biJson.imageryDate;
      } else {
        diagnostics.building_insights_error = biBody.substring(0, 500);
      }
    } catch (e) {
      diagnostics.building_insights_error = (e as Error).message;
    }

    // Step 2: Test DataLayers
    const dlUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&key=${GOOGLE_SOLAR_API_KEY}`;
    diagnostics.data_layers_url = dlUrl.replace(GOOGLE_SOLAR_API_KEY, "REDACTED");
    try {
      const dlResp = await fetch(dlUrl);
      const dlBody = await dlResp.text();
      diagnostics.data_layers_status = dlResp.status;
      diagnostics.data_layers_content_type = dlResp.headers.get("content-type");
      if (dlResp.ok) {
        const dlJson = JSON.parse(dlBody);
        diagnostics.dsm_url_present = !!dlJson.dsmUrl;
        diagnostics.rgb_url_present = !!dlJson.rgbUrl;
        diagnostics.mask_url_present = !!dlJson.maskUrl;
        diagnostics.annual_flux_url_present = !!dlJson.annualFluxUrl;
        diagnostics.imagery_date = dlJson.imageryDate;
        diagnostics.imagery_quality = dlJson.imageryQuality;

        // Step 3: Fetch actual DSM GeoTIFF
        if (dlJson.dsmUrl) {
          const dsmFetchUrl = `${dlJson.dsmUrl}&key=${GOOGLE_SOLAR_API_KEY}`;
          try {
            const dsmResp = await fetch(dsmFetchUrl);
            diagnostics.dsm_fetch_status = dsmResp.status;
            diagnostics.dsm_fetch_content_type = dsmResp.headers.get("content-type");
            if (dsmResp.ok) {
              const buf = await dsmResp.arrayBuffer();
              diagnostics.dsm_fetch_byte_length = buf.byteLength;

              // Try parsing GeoTIFF
              try {
                const { fromArrayBuffer } = await import("npm:geotiff@2.1.3");
                const tiff = await fromArrayBuffer(buf);
                const image = await tiff.getImage();
                diagnostics.dsm_parse_success = true;
                diagnostics.dsm_width = image.getWidth();
                diagnostics.dsm_height = image.getHeight();
                diagnostics.dsm_samples_per_pixel = image.getSamplesPerPixel();
                diagnostics.dsm_bits_per_sample = image.getBitsPerSample();

                const rasters = await image.readRasters();
                const data = rasters[0] as Float32Array;
                let noDataCount = 0;
                let minElev = Infinity;
                let maxElev = -Infinity;
                const fileDir = image.getFileDirectory();
                const noDataValue = fileDir.GDAL_NODATA ? parseFloat(fileDir.GDAL_NODATA) : -9999;
                for (let i = 0; i < data.length; i++) {
                  if (data[i] === noDataValue || isNaN(data[i])) {
                    noDataCount++;
                  } else {
                    if (data[i] < minElev) minElev = data[i];
                    if (data[i] > maxElev) maxElev = data[i];
                  }
                }
                diagnostics.dsm_no_data_value = noDataValue;
                diagnostics.dsm_no_data_ratio = +(noDataCount / data.length).toFixed(4);
                diagnostics.dsm_valid_pixels = data.length - noDataCount;
                diagnostics.dsm_min_elevation_m = +minElev.toFixed(2);
                diagnostics.dsm_max_elevation_m = +maxElev.toFixed(2);

                // Geo bounds
                const tiepoint = image.getTiePoints();
                const pixelScale = fileDir.ModelPixelScale;
                diagnostics.dsm_has_tiepoints = !!(tiepoint && tiepoint.length > 0);
                diagnostics.dsm_has_pixel_scale = !!(pixelScale && pixelScale.length >= 2);
                diagnostics.dsm_geo_keys = image.getGeoKeys();
              } catch (parseErr) {
                diagnostics.dsm_parse_success = false;
                diagnostics.dsm_parse_error = (parseErr as Error).message;
              }
            } else {
              const errBody = await dsmResp.text();
              diagnostics.dsm_fetch_error = errBody.substring(0, 500);
            }
          } catch (fetchErr) {
            diagnostics.dsm_fetch_error = (fetchErr as Error).message;
          }
        }

        // Step 4: Fetch mask GeoTIFF
        if (dlJson.maskUrl) {
          const maskFetchUrl = `${dlJson.maskUrl}&key=${GOOGLE_SOLAR_API_KEY}`;
          try {
            const maskResp = await fetch(maskFetchUrl);
            diagnostics.mask_fetch_status = maskResp.status;
            diagnostics.mask_fetch_content_type = maskResp.headers.get("content-type");
            if (maskResp.ok) {
              const buf = await maskResp.arrayBuffer();
              diagnostics.mask_fetch_byte_length = buf.byteLength;
              try {
                const { fromArrayBuffer } = await import("npm:geotiff@2.1.3");
                const tiff = await fromArrayBuffer(buf);
                const image = await tiff.getImage();
                diagnostics.mask_parse_success = true;
                diagnostics.mask_width = image.getWidth();
                diagnostics.mask_height = image.getHeight();
                const rasters = await image.readRasters();
                const data = rasters[0] as Float32Array;
                let roofPixels = 0;
                for (let i = 0; i < data.length; i++) {
                  if (data[i] > 0) roofPixels++;
                }
                diagnostics.mask_roof_pixel_count = roofPixels;
                diagnostics.mask_roof_pixel_pct = +((roofPixels / data.length) * 100).toFixed(1);
              } catch (e) {
                diagnostics.mask_parse_success = false;
                diagnostics.mask_parse_error = (e as Error).message;
              }
            } else {
              diagnostics.mask_fetch_error = (await maskResp.text()).substring(0, 500);
            }
          } catch (e) {
            diagnostics.mask_fetch_error = (e as Error).message;
          }
        }
      } else {
        diagnostics.data_layers_error = dlBody.substring(0, 500);
      }
    } catch (e) {
      diagnostics.data_layers_error = (e as Error).message;
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
