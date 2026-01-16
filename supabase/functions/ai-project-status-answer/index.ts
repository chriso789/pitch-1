/**
 * AI Project Status Answer Edge Function
 * Handles inbound calls and provides AI-powered project status updates
 * Integrates with Telnyx for voice control
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAIResponse } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface TelnyxWebhookPayload {
  data: {
    event_type: string;
    payload: {
      call_control_id: string;
      call_leg_id?: string;
      call_session_id?: string;
      from: string;
      to: string;
      direction?: string;
      state?: string;
      client_state?: string;
      speech?: {
        transcript?: string;
        result?: string;
      };
      result?: string;
      digits?: string;
    };
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhook: TelnyxWebhookPayload = await req.json();
    const eventType = webhook.data.event_type;
    const payload = webhook.data.payload;
    const callControlId = payload.call_control_id;
    const callerNumber = payload.from?.replace(/^\+1/, "") || "";

    console.log(`[ai-project-status] Event: ${eventType}, From: ${callerNumber}`);

    const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY");
    if (!TELNYX_API_KEY) {
      throw new Error("TELNYX_API_KEY not configured");
    }

    // Helper to send Telnyx call control commands
    const telnyxCommand = async (action: string, params: Record<string, unknown> = {}) => {
      const response = await fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${TELNYX_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        }
      );
      if (!response.ok) {
        const error = await response.text();
        console.error(`[ai-project-status] Telnyx ${action} failed:`, error);
      }
      return response;
    };

    // Helper to speak text
    const speak = async (text: string, clientState?: string) => {
      await telnyxCommand("speak", {
        payload: text,
        voice: "female",
        language: "en-US",
        client_state: clientState ? btoa(clientState) : undefined,
      });
    };

    // Helper to gather speech
    const gatherSpeech = async (prompt: string, timeout = 10) => {
      await telnyxCommand("gather_using_speak", {
        payload: prompt,
        voice: "female",
        language: "en-US",
        valid_digits: "0123456789*#",
        timeout_secs: timeout,
        maximum_digits: 1,
        client_state: btoa("gather"),
      });
    };

    switch (eventType) {
      case "call.initiated": {
        // Answer the call
        await telnyxCommand("answer");
        console.log("[ai-project-status] Call answered");
        break;
      }

      case "call.answered": {
        // Lookup caller by phone number
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, tenant_id")
          .or(`phone.eq.${callerNumber},phone.eq.+1${callerNumber}`)
          .limit(1)
          .maybeSingle();

        if (contact) {
          // Found contact - lookup their projects/jobs
          const { data: projects } = await supabase
            .from("projects")
            .select("id, name, status, created_at, notes")
            .eq("contact_id", contact.id)
            .order("created_at", { ascending: false })
            .limit(3);

          if (projects && projects.length > 0) {
            const project = projects[0];
            const greeting = `Hello ${contact.first_name || "there"}! I found your project. `;
            
            // Generate AI response about project status
            const { text: statusUpdate } = await generateAIResponse({
              system: `You are a friendly roofing company AI assistant. Provide a brief project status update.
Keep it conversational and under 100 words. Don't mention technical details.
If status is unclear, offer to have someone call back.`,
              user: `Project: ${project.name}
Status: ${project.status}
Notes: ${project.notes || "No recent notes"}
Last updated: ${project.created_at}

Provide a friendly status update for the homeowner.`,
            });

            await speak(greeting + statusUpdate, "status_provided");
            
            // Log the call
            await supabase.from("ai_call_transcripts").insert({
              tenant_id: contact.tenant_id,
              telnyx_call_control_id: callControlId,
              caller_number: callerNumber,
              gathered_data: { contact_id: contact.id, project_id: project.id },
              project_status_provided: { status: project.status, message: statusUpdate },
              escalated_to_human: false,
            });
          } else {
            await gatherSpeech(
              `Hello ${contact.first_name || "there"}! I don't see any active projects on file. ` +
              `Would you like to speak with someone about starting a new project? Press 1 for yes, or 2 to leave a message.`
            );
          }
        } else {
          // Unknown caller
          await gatherSpeech(
            "Hello! Thanks for calling. I couldn't find your information on file. " +
            "Please say your name and the address of your project, and I'll look that up for you."
          );
        }
        break;
      }

      case "call.gather.ended": {
        const transcript = payload.speech?.transcript || payload.digits || "";
        console.log("[ai-project-status] Gather result:", transcript);

        // Check for transfer keywords
        const transferKeywords = ["speak to someone", "manager", "representative", "human", "person", "billing"];
        const wantsTransfer = transferKeywords.some(k => transcript.toLowerCase().includes(k));

        if (wantsTransfer || payload.digits === "1") {
          await speak("Let me transfer you to a team member. Please hold.");
          
          // Get the tenant's forwarding number
          const { data: tenant } = await supabase
            .from("tenants")
            .select("settings")
            .limit(1)
            .maybeSingle();

          const forwardNumber = tenant?.settings?.main_phone || Deno.env.get("DEFAULT_FORWARD_NUMBER");
          
          if (forwardNumber) {
            await telnyxCommand("transfer", {
              to: forwardNumber,
            });
          } else {
            await speak("I'm sorry, no one is available right now. Please leave a message after the beep.");
            await telnyxCommand("record_start", {
              format: "mp3",
              channels: "single",
            });
          }

          // Log escalation
          await supabase.from("ai_call_transcripts").insert({
            tenant_id: null,
            telnyx_call_control_id: callControlId,
            caller_number: callerNumber,
            gathered_data: { transcript },
            escalated_to_human: true,
            escalation_reason: "caller_requested",
          });
        } else if (payload.digits === "2" || transcript.length > 0) {
          // Try to find project by address mentioned
          const words = transcript.split(" ");
          const possibleAddress = words.slice(-4).join(" ");
          
          const { data: foundContact } = await supabase
            .from("contacts")
            .select("id, first_name, tenant_id")
            .or(`address_line_1.ilike.%${possibleAddress}%,address_line_1.ilike.%${words[words.length - 1]}%`)
            .limit(1)
            .maybeSingle();

          if (foundContact) {
            const { data: project } = await supabase
              .from("projects")
              .select("name, status, notes")
              .eq("contact_id", foundContact.id)
              .limit(1)
              .maybeSingle();

            if (project) {
              const { text: statusUpdate } = await generateAIResponse({
                system: "Provide a brief, friendly project status update in 2-3 sentences.",
                user: `Project: ${project.name}, Status: ${project.status}, Notes: ${project.notes || "None"}`,
              });
              await speak(`I found your project! ${statusUpdate} Is there anything else I can help with?`);
            } else {
              await speak("I found your contact info but no active project. Would you like me to have someone call you back?");
            }
          } else {
            // Create callback task
            await speak("I'll have someone call you back shortly. Have a great day!");
            
            // Create a task for callback
            await supabase.from("tasks").insert({
              title: `Callback requested: ${callerNumber}`,
              description: `Caller transcript: ${transcript}`,
              status: "pending",
              priority: "high",
              due_date: new Date().toISOString(),
            });

            await telnyxCommand("hangup");
          }
        }
        break;
      }

      case "call.speak.ended": {
        const clientState = payload.client_state ? atob(payload.client_state) : "";
        
        if (clientState === "status_provided") {
          // After providing status, offer more options
          await gatherSpeech(
            "Would you like to speak with someone for more details? Press 1 for yes, or hang up if you're all set."
          );
        }
        break;
      }

      case "call.hangup": {
        console.log("[ai-project-status] Call ended");
        break;
      }

      default:
        console.log(`[ai-project-status] Unhandled event: ${eventType}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ai-project-status] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
