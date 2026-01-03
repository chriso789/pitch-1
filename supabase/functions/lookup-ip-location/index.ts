/**
 * IP Location Lookup Edge Function
 * Resolves IP addresses to geographic locations using ip-api.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IPLookupResult {
  ip: string;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  isp: string | null;
  is_vpn: boolean;
  is_proxy: boolean;
  timezone: string | null;
  lat: number | null;
  lon: number | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { ip_address, session_id } = await req.json();

    if (!ip_address) {
      return new Response(
        JSON.stringify({ error: "IP address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip lookup for localhost/private IPs
    if (
      ip_address === "127.0.0.1" ||
      ip_address === "::1" ||
      ip_address.startsWith("192.168.") ||
      ip_address.startsWith("10.") ||
      ip_address.startsWith("172.")
    ) {
      const privateResult: IPLookupResult = {
        ip: ip_address,
        city: "Local Network",
        region: null,
        country: "Private",
        country_code: null,
        isp: "Private Network",
        is_vpn: false,
        is_proxy: false,
        timezone: null,
        lat: null,
        lon: null,
      };

      return new Response(
        JSON.stringify(privateResult),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use ip-api.com for geolocation (free tier: 45 requests/minute)
    const apiUrl = `http://ip-api.com/json/${ip_address}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,proxy,hosting`;
    
    console.log(`Looking up IP: ${ip_address}`);
    
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status === "fail") {
      console.error(`IP lookup failed: ${data.message}`);
      return new Response(
        JSON.stringify({
          ip: ip_address,
          city: null,
          region: null,
          country: null,
          country_code: null,
          isp: null,
          is_vpn: false,
          is_proxy: false,
          timezone: null,
          lat: null,
          lon: null,
          error: data.message,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result: IPLookupResult = {
      ip: ip_address,
      city: data.city || null,
      region: data.regionName || null,
      country: data.country || null,
      country_code: data.countryCode || null,
      isp: data.isp || null,
      is_vpn: data.hosting || false,
      is_proxy: data.proxy || false,
      timezone: data.timezone || null,
      lat: data.lat || null,
      lon: data.lon || null,
    };

    console.log(`IP lookup result:`, result);

    // Optionally update the session record with location info
    if (session_id) {
      const { error: updateError } = await supabase
        .from("session_activity_log")
        .update({
          location_info: {
            city: result.city,
            region: result.region,
            country: result.country,
            country_code: result.country_code,
            isp: result.isp,
            is_vpn: result.is_vpn,
            is_proxy: result.is_proxy,
            timezone: result.timezone,
            lat: result.lat,
            lon: result.lon,
          },
        })
        .eq("id", session_id);

      if (updateError) {
        console.error("Failed to update session with location:", updateError);
      }
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("IP lookup error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
