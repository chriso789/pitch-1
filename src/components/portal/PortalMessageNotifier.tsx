import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useNavigate } from "react-router-dom";

/**
 * Listens for new homeowner portal_messages in this tenant and toasts the rep.
 * Mount once near the top of the authenticated app.
 */
export const PortalMessageNotifier: React.FC = () => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeTenantId) return;
    const channel = supabase
      .channel(`portal-msg-notify-${activeTenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "portal_messages",
          filter: `tenant_id=eq.${activeTenantId}`,
        },
        async (payload) => {
          const row = payload.new as any;
          if (row?.sender_type !== "homeowner") return;
          // resolve project → pipeline_entry for navigation
          let leadId: string | null = null;
          if (row.project_id) {
            const { data } = await supabase
              .from("projects")
              .select("pipeline_entry_id")
              .eq("id", row.project_id)
              .maybeSingle();
            leadId = data?.pipeline_entry_id || null;
          }
          toast({
            title: "💬 New homeowner message",
            description: String(row.message || "").slice(0, 120),
            action: leadId
              ? ({
                  altText: "Open lead",
                  onClick: () => navigate(`/lead/${leadId}`),
                } as any)
              : undefined,
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTenantId, toast, navigate]);

  return null;
};
