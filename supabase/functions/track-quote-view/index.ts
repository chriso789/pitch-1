import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrackViewRequest {
  token: string;
  action?: 'view' | 'heartbeat' | 'get_quote';
  session_id?: string;
  duration_seconds?: number;
  scroll_depth_percent?: number;
  pages_viewed?: number;
}

function parseUserAgent(ua: string) {
  let device = 'Desktop';
  let browser = 'Unknown';
  let os = 'Unknown';

  // Device detection
  if (/mobile/i.test(ua)) device = 'Mobile';
  else if (/tablet|ipad/i.test(ua)) device = 'Tablet';

  // Browser detection
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/edge/i.test(ua)) browser = 'Edge';

  // OS detection
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/ios|iphone|ipad/i.test(ua)) os = 'iOS';

  return { device, browser, os };
}

async function getGeoLocation(ip: string) {
  try {
    // Using ip-api.com (free tier)
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`);
    if (response.ok) {
      const data = await response.json();
      return {
        city: data.city || null,
        region: data.regionName || null,
        country: data.country || null
      };
    }
  } catch (error) {
    console.error("Geo lookup error:", error);
  }
  return { city: null, region: null, country: null };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: TrackViewRequest = await req.json();
    const { token, action = 'view', session_id, duration_seconds, scroll_depth_percent, pages_viewed } = body;

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Token required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find tracking link by token
    const { data: trackingLink, error: linkError } = await supabase
      .from("quote_tracking_links")
      .select(`
        *,
        estimates (
          id,
          estimate_number,
          selling_price,
          pipeline_entry_id
        ),
        contacts (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (linkError || !trackingLink) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiration
    if (trackingLink.expires_at && new Date(trackingLink.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: "Link has expired" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get client info
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] || 
                     req.headers.get("x-real-ip") || 
                     "unknown";
    const userAgent = req.headers.get("user-agent") || "";
    const { device, browser, os } = parseUserAgent(userAgent);

    if (action === 'get_quote') {
      // Return quote data for rendering
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, logo_url, primary_color, secondary_color")
        .eq("id", trackingLink.tenant_id)
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          quote: {
            estimate_number: trackingLink.estimates?.estimate_number,
            selling_price: trackingLink.estimates?.selling_price,
            pdf_url: trackingLink.pdf_url,
            recipient_name: trackingLink.recipient_name,
            contact: trackingLink.contacts,
          },
          company: tenant
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'heartbeat' && session_id) {
      // Update existing view event
      await supabase
        .from("quote_view_events")
        .update({
          duration_seconds: duration_seconds || 0,
          scroll_depth_percent: scroll_depth_percent || 0,
          pages_viewed: pages_viewed || 1,
          last_activity_at: new Date().toISOString()
        })
        .eq("session_id", session_id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initial view - create event
    const newSessionId = session_id || crypto.randomUUID();
    const geo = await getGeoLocation(clientIp);

    // Create view event
    const { error: eventError } = await supabase
      .from("quote_view_events")
      .insert({
        tenant_id: trackingLink.tenant_id,
        tracking_link_id: trackingLink.id,
        viewer_ip: clientIp,
        viewer_user_agent: userAgent,
        viewer_device: device,
        viewer_browser: browser,
        viewer_os: os,
        viewer_city: geo.city,
        viewer_region: geo.region,
        viewer_country: geo.country,
        session_id: newSessionId,
        duration_seconds: 0,
        pages_viewed: 1
      });

    if (eventError) {
      console.error("Error creating view event:", eventError);
    }

    // Update tracking link stats
    await supabase
      .from("quote_tracking_links")
      .update({
        view_count: (trackingLink.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq("id", trackingLink.id);

    // Send notification to sales rep
    const contactName = trackingLink.contacts 
      ? `${trackingLink.contacts.first_name} ${trackingLink.contacts.last_name}`
      : trackingLink.recipient_name || 'A customer';

    await supabase
      .from("user_notifications")
      .insert({
        tenant_id: trackingLink.tenant_id,
        user_id: trackingLink.sent_by,
        title: "Quote Viewed! 👀",
        message: `${contactName} just opened your quote #${trackingLink.estimates?.estimate_number || 'N/A'}`,
        type: "quote_viewed",
        priority: "high",
        metadata: {
          tracking_link_id: trackingLink.id,
          estimate_id: trackingLink.estimate_id,
          contact_id: trackingLink.contact_id,
          viewer_location: geo.city ? `${geo.city}, ${geo.region}` : null,
          viewer_device: device
        }
      });

    console.log(`Quote viewed: ${trackingLink.id} by ${contactName} from ${geo.city || clientIp}`);

    return new Response(
      JSON.stringify({
        success: true,
        session_id: newSessionId,
        view_count: (trackingLink.view_count || 0) + 1
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in track-quote-view:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
