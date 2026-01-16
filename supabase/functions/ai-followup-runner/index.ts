// ============================================
// AI FOLLOW-UP RUNNER
// Cron job to identify aged leads and dispatch follow-ups
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RunnerRequest {
  tenant_id?: string; // Optional: run for specific tenant only
  min_dormant_days?: number; // Default: 30
  max_leads?: number; // Default: 50
  dispatch_immediately?: boolean; // Default: true
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = (await req.json().catch(() => ({}))) as RunnerRequest;
    const {
      tenant_id,
      min_dormant_days = 30,
      max_leads = 50,
      dispatch_immediately = true,
    } = body;

    console.log(`[ai-followup-runner] Starting run: min_dormant=${min_dormant_days}d, max=${max_leads}`);

    // Get enabled AI agents (optionally filtered by tenant)
    let agentQuery = supabase
      .from("ai_agents")
      .select("id, tenant_id, location_id, working_hours, persona_prompt")
      .eq("enabled", true);

    if (tenant_id) {
      agentQuery = agentQuery.eq("tenant_id", tenant_id);
    }

    const { data: agents, error: agentError } = await agentQuery;

    if (agentError) throw agentError;

    if (!agents?.length) {
      console.log("[ai-followup-runner] No enabled AI agents found");
      return new Response(
        JSON.stringify({ ok: true, message: "No enabled agents", created: 0, dispatched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalCreated = 0;
    let totalDispatched = 0;
    let totalSkipped = 0;

    for (const agent of agents) {
      console.log(`[ai-followup-runner] Processing agent ${agent.id} for tenant ${agent.tenant_id}`);

      // Check working hours
      const workingHours = agent.working_hours as {
        tz: string;
        days: number[];
        start: string;
        end: string;
      };

      if (!isWithinWorkingHours(workingHours)) {
        console.log(`[ai-followup-runner] Outside working hours for agent ${agent.id}, skipping`);
        continue;
      }

      // Query aged contacts using the view
      const { data: agedContacts, error: agedError } = await supabase
        .from("v_ai_aged_contacts")
        .select("contact_id, first_name, last_name, phone, email, days_dormant, is_opted_out, has_pending_outreach")
        .eq("tenant_id", agent.tenant_id)
        .gte("days_dormant", min_dormant_days)
        .eq("is_opted_out", false)
        .eq("has_pending_outreach", false)
        .not("phone", "is", null)
        .order("days_dormant", { ascending: false })
        .limit(max_leads);

      if (agedError) {
        console.error(`[ai-followup-runner] Error querying aged contacts:`, agedError);
        continue;
      }

      if (!agedContacts?.length) {
        console.log(`[ai-followup-runner] No aged contacts found for tenant ${agent.tenant_id}`);
        continue;
      }

      console.log(`[ai-followup-runner] Found ${agedContacts.length} aged contacts`);

      for (const contact of agedContacts) {
        // Double-check no pending queue items
        const { data: existing } = await supabase
          .from("ai_outreach_queue")
          .select("id")
          .eq("tenant_id", agent.tenant_id)
          .eq("contact_id", contact.contact_id)
          .in("state", ["queued", "running"])
          .limit(1);

        if (existing?.length) {
          totalSkipped++;
          continue;
        }

        // Create queue item
        const { data: queueItem, error: insertError } = await supabase
          .from("ai_outreach_queue")
          .insert({
            tenant_id: agent.tenant_id,
            location_id: agent.location_id,
            contact_id: contact.contact_id,
            state: "queued",
            channel: contact.phone ? "sms" : "email",
            scheduled_for: new Date().toISOString(),
            priority: Math.min(100, Math.floor(contact.days_dormant ?? 30)),
            reason: "aged_lead",
            attempts: 0,
          })
          .select("id")
          .single();

        if (insertError) {
          console.error(`[ai-followup-runner] Failed to create queue item:`, insertError);
          continue;
        }

        totalCreated++;
        console.log(`[ai-followup-runner] Created queue item ${queueItem.id} for contact ${contact.contact_id}`);

        // Dispatch immediately if configured
        if (dispatch_immediately && queueItem?.id) {
          try {
            const dispatchRes = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-followup-dispatch`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ queue_id: queueItem.id }),
              }
            );

            if (dispatchRes.ok) {
              totalDispatched++;
            } else {
              console.error(`[ai-followup-runner] Dispatch failed for ${queueItem.id}`);
            }
          } catch (dispatchErr) {
            console.error(`[ai-followup-runner] Dispatch error:`, dispatchErr);
          }
        }
      }
    }

    const result = {
      ok: true,
      agents_processed: agents.length,
      created: totalCreated,
      dispatched: totalDispatched,
      skipped: totalSkipped,
    };

    console.log(`[ai-followup-runner] Completed:`, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ai-followup-runner] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Check if current time is within configured working hours
 */
function isWithinWorkingHours(workingHours: {
  tz: string;
  days: number[];
  start: string;
  end: string;
}): boolean {
  try {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: workingHours.tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    const weekday = parts.find((p) => p.type === "weekday")?.value;

    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const currentDay = dayMap[weekday || "Mon"] ?? 1;

    if (!workingHours.days.includes(currentDay)) {
      return false;
    }

    const [startHour, startMin] = workingHours.start.split(":").map(Number);
    const [endHour, endMin] = workingHours.end.split(":").map(Number);

    const currentMinutes = hour * 60 + minute;
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch {
    return true; // Default to allow if error
  }
}
