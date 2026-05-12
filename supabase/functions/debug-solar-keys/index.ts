/**
 * Diagnostic endpoint to verify Solar API key configuration.
 * Returns key prefixes, suffixes, and tests each API endpoint.
 * Does NOT expose full keys.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface KeyInfo {
  env_var: string;
  present: boolean;
  length: number;
  prefix: string;
  suffix: string;
}

interface ApiTestResult {
  endpoint: string;
  status: number;
  ok: boolean;
  error_code?: number;
  error_message?: string;
  project_id_from_error?: string;
  billing_error_detected?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    function_name: "debug-solar-keys",
  };

  // 1. Collect all potential Google API keys
  const keyVars = [
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_SOLAR_API_KEY",
    "GOOGLE_API_KEY",
    "VITE_GOOGLE_MAPS_API_KEY",
    "VITE_GOOGLE_SOLAR_API_KEY",
    "PUBLIC_GOOGLE_MAPS_API_KEY",
  ];

  const keys: Record<string, KeyInfo> = {};
  for (const varName of keyVars) {
    const value = Deno.env.get(varName) || "";
    keys[varName] = {
      env_var: varName,
      present: !!value,
      length: value.length,
      prefix: value.substring(0, 6) || "(empty)",
      suffix: value.length > 6 ? value.substring(value.length - 6) : "(empty)",
    };
  }
  diagnostics.keys = keys;

  // 2. Determine which key will be used (matching start-ai-measurement logic)
  const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
  const GOOGLE_SOLAR_API_KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || GOOGLE_MAPS_API_KEY;

  diagnostics.effective_keys = {
    static_maps_key_source: GOOGLE_MAPS_API_KEY ? "GOOGLE_MAPS_API_KEY" : "(none)",
    static_maps_key_prefix: GOOGLE_MAPS_API_KEY.substring(0, 6) || "(empty)",
    solar_api_key_source: Deno.env.get("GOOGLE_SOLAR_API_KEY")
      ? "GOOGLE_SOLAR_API_KEY"
      : (GOOGLE_MAPS_API_KEY ? "GOOGLE_MAPS_API_KEY (fallback)" : "(none)"),
    solar_api_key_prefix: GOOGLE_SOLAR_API_KEY.substring(0, 6) || "(empty)",
    solar_api_key_suffix: GOOGLE_SOLAR_API_KEY.length > 6
      ? GOOGLE_SOLAR_API_KEY.substring(GOOGLE_SOLAR_API_KEY.length - 6)
      : "(empty)",
  };

  // 3. Test coordinates (use a known good location)
  const testLat = 27.0820246;
  const testLng = -82.1962156;

  // 4. Test Building Insights API
  const buildingInsightsResult: ApiTestResult = {
    endpoint: "buildingInsights:findClosest",
    status: 0,
    ok: false,
  };

  if (GOOGLE_SOLAR_API_KEY) {
    try {
      const biUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${testLat}&location.longitude=${testLng}&key=${GOOGLE_SOLAR_API_KEY}`;
      const biResp = await fetch(biUrl);
      buildingInsightsResult.status = biResp.status;
      buildingInsightsResult.ok = biResp.ok;

      if (!biResp.ok) {
        const body = await biResp.text();
        try {
          const errJson = JSON.parse(body);
          buildingInsightsResult.error_code = errJson.error?.code;
          buildingInsightsResult.error_message = errJson.error?.message?.substring(0, 200);

          // Extract project ID from error message
          const projectMatch = errJson.error?.message?.match(/project #(\d+)/);
          if (projectMatch) {
            buildingInsightsResult.project_id_from_error = projectMatch[1];
          }

          buildingInsightsResult.billing_error_detected =
            errJson.error?.message?.includes("billing") ||
            errJson.error?.status === "PERMISSION_DENIED";
        } catch {
          buildingInsightsResult.error_message = body.substring(0, 200);
        }
      }
    } catch (e) {
      buildingInsightsResult.error_message = (e as Error).message;
    }
  } else {
    buildingInsightsResult.error_message = "No API key configured";
  }
  diagnostics.building_insights_test = buildingInsightsResult;

  // 5. Test DataLayers API
  const dataLayersResult: ApiTestResult = {
    endpoint: "dataLayers:get",
    status: 0,
    ok: false,
  };

  if (GOOGLE_SOLAR_API_KEY) {
    try {
      const dlUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${testLat}&location.longitude=${testLng}&radiusMeters=50&view=FULL_LAYERS&key=${GOOGLE_SOLAR_API_KEY}`;
      const dlResp = await fetch(dlUrl);
      dataLayersResult.status = dlResp.status;
      dataLayersResult.ok = dlResp.ok;

      if (!dlResp.ok) {
        const body = await dlResp.text();
        try {
          const errJson = JSON.parse(body);
          dataLayersResult.error_code = errJson.error?.code;
          dataLayersResult.error_message = errJson.error?.message?.substring(0, 200);

          const projectMatch = errJson.error?.message?.match(/project #(\d+)/);
          if (projectMatch) {
            dataLayersResult.project_id_from_error = projectMatch[1];
          }

          dataLayersResult.billing_error_detected =
            errJson.error?.message?.includes("billing") ||
            errJson.error?.status === "PERMISSION_DENIED";
        } catch {
          dataLayersResult.error_message = body.substring(0, 200);
        }
      } else {
        const data = await dlResp.json();
        diagnostics.datalayers_available = {
          dsm_url_present: !!data.dsmUrl,
          mask_url_present: !!data.maskUrl,
          rgb_url_present: !!data.rgbUrl,
          imagery_quality: data.imageryQuality,
        };
      }
    } catch (e) {
      dataLayersResult.error_message = (e as Error).message;
    }
  } else {
    dataLayersResult.error_message = "No API key configured";
  }
  diagnostics.datalayers_test = dataLayersResult;

  // 6. Test Static Maps API
  const staticMapsResult: ApiTestResult = {
    endpoint: "staticmap",
    status: 0,
    ok: false,
  };

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const smUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${testLat},${testLng}&zoom=19&size=100x100&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
      const smResp = await fetch(smUrl);
      staticMapsResult.status = smResp.status;
      staticMapsResult.ok = smResp.ok;

      if (!smResp.ok) {
        const body = await smResp.text();
        staticMapsResult.error_message = body.substring(0, 200);
      }
    } catch (e) {
      staticMapsResult.error_message = (e as Error).message;
    }
  } else {
    staticMapsResult.error_message = "No API key configured";
  }
  diagnostics.static_maps_test = staticMapsResult;

  // 7. Summary
  diagnostics.summary = {
    solar_api_working: buildingInsightsResult.ok && dataLayersResult.ok,
    static_maps_working: staticMapsResult.ok,
    billing_error_detected: buildingInsightsResult.billing_error_detected || dataLayersResult.billing_error_detected,
    project_id_from_error: buildingInsightsResult.project_id_from_error || dataLayersResult.project_id_from_error,
    action_required: (buildingInsightsResult.billing_error_detected || dataLayersResult.billing_error_detected)
      ? "Update GOOGLE_SOLAR_API_KEY in Supabase secrets to a key from a project with Solar API billing enabled"
      : (buildingInsightsResult.ok && dataLayersResult.ok ? "None - Solar API working" : "Check API configuration"),
  };

  return new Response(JSON.stringify(diagnostics, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
