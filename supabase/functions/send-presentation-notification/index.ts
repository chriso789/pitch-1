import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

interface NotificationRequest {
  session_id: string;
  event_type: "viewed" | "completed" | "signed";
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { session_id, event_type }: NotificationRequest = await req.json();

    // Get session details
    const { data: session, error: sessionError } = await supabaseClient
      .from("presentation_sessions")
      .select(`
        *,
        presentation:presentations(name),
        contact:contacts(first_name, last_name, email)
      `)
      .eq("id", session_id)
      .single();

    if (sessionError) throw sessionError;

    // Get the rep who created the presentation
    const { data: presentation, error: presentationError } = await supabaseClient
      .from("presentations")
      .select("created_by")
      .eq("id", session.presentation_id)
      .single();

    if (presentationError) throw presentationError;

    // Create notification message
    let message = "";
    switch (event_type) {
      case "viewed":
        message = `${session.contact?.first_name} ${session.contact?.last_name} started viewing "${session.presentation?.name}"`;
        break;
      case "completed":
        message = `${session.contact?.first_name} ${session.contact?.last_name} completed viewing "${session.presentation?.name}"`;
        break;
      case "signed":
        message = `${session.contact?.first_name} ${session.contact?.last_name} signed "${session.presentation?.name}"`;
        break;
    }

    console.log("Notification:", message);

    // Here you would integrate with your notification system
    // For now, we'll just log it and return success

    return new Response(
      JSON.stringify({
        success: true,
        message: "Notification sent",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in send-presentation-notification:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
