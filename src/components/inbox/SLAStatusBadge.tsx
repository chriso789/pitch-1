import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface SLAStatusBadgeProps {
  conversationId: string;
  compact?: boolean;
  showTooltip?: boolean;
}

interface SLAStatus {
  id: string;
  conversation_id: string;
  sla_policy_id: string;
  first_response_due: string | null;
  resolution_due: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  first_response_breached: boolean;
  resolution_breached: boolean;
  current_escalation_level: number;
  status: string;
}

export const SLAStatusBadge = ({
  conversationId,
  compact = false,
  showTooltip = true
}: SLAStatusBadgeProps) => {
  const [now, setNow] = useState(new Date());

  // Update time every minute for countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch SLA status for this conversation
  const { data: slaStatus, isLoading } = useQuery({
    queryKey: ["sla-status", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_sla_status")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle() as { data: any; error: any };

      if (error) throw error;
      return data as SLAStatus | null;
    },
    enabled: !!conversationId,
    refetchInterval: 60000 // Refresh every minute
  });

  if (isLoading || !slaStatus) {
    return null;
  }

  const getTimeRemaining = (dueDate: string | null): { minutes: number; formatted: string } | null => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    
    if (diffMinutes <= 0) {
      const overdue = Math.abs(diffMinutes);
      if (overdue < 60) return { minutes: diffMinutes, formatted: `-${overdue}m` };
      const hours = Math.floor(overdue / 60);
      return { minutes: diffMinutes, formatted: `-${hours}h ${overdue % 60}m` };
    }
    
    if (diffMinutes < 60) return { minutes: diffMinutes, formatted: `${diffMinutes}m` };
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return { minutes: diffMinutes, formatted: mins > 0 ? `${hours}h ${mins}m` : `${hours}h` };
  };

  const getStatus = () => {
    // Already resolved
    if (slaStatus.resolved_at) {
      return {
        type: "resolved" as const,
        label: "Resolved",
        icon: CheckCircle,
        color: "text-green-600",
        bgColor: "bg-green-100",
        borderColor: "border-green-200"
      };
    }

    // Check for breaches
    if (slaStatus.first_response_breached || slaStatus.resolution_breached) {
      return {
        type: "breached" as const,
        label: "SLA Breached",
        icon: XCircle,
        color: "text-destructive",
        bgColor: "bg-destructive/10",
        borderColor: "border-destructive/20"
      };
    }

    // Check first response
    if (!slaStatus.first_response_at && slaStatus.first_response_due) {
      const remaining = getTimeRemaining(slaStatus.first_response_due);
      if (remaining) {
        if (remaining.minutes < 0) {
          return {
            type: "breached" as const,
            label: `Overdue ${remaining.formatted}`,
            icon: XCircle,
            color: "text-destructive",
            bgColor: "bg-destructive/10",
            borderColor: "border-destructive/20"
          };
        }
        if (remaining.minutes <= 15) {
          return {
            type: "warning" as const,
            label: `${remaining.formatted} left`,
            icon: AlertTriangle,
            color: "text-yellow-600",
            bgColor: "bg-yellow-100",
            borderColor: "border-yellow-200"
          };
        }
        return {
          type: "on_track" as const,
          label: `${remaining.formatted}`,
          icon: Clock,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
          borderColor: "border-border"
        };
      }
    }

    // First response done, check resolution
    if (slaStatus.first_response_at && slaStatus.resolution_due) {
      const remaining = getTimeRemaining(slaStatus.resolution_due);
      if (remaining) {
        if (remaining.minutes < 0) {
          return {
            type: "breached" as const,
            label: `Resolution overdue`,
            icon: XCircle,
            color: "text-destructive",
            bgColor: "bg-destructive/10",
            borderColor: "border-destructive/20"
          };
        }
        if (remaining.minutes <= 30) {
          return {
            type: "warning" as const,
            label: `Resolve in ${remaining.formatted}`,
            icon: AlertTriangle,
            color: "text-yellow-600",
            bgColor: "bg-yellow-100",
            borderColor: "border-yellow-200"
          };
        }
        return {
          type: "on_track" as const,
          label: `${remaining.formatted} to resolve`,
          icon: Clock,
          color: "text-green-600",
          bgColor: "bg-green-50",
          borderColor: "border-green-200"
        };
      }
    }

    return {
      type: "unknown" as const,
      label: "SLA Active",
      icon: Clock,
      color: "text-muted-foreground",
      bgColor: "bg-muted",
      borderColor: "border-border"
    };
  };

  const status = getStatus();
  const Icon = status.icon;

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        status.bgColor,
        status.borderColor,
        status.color,
        compact && "text-xs px-1.5 py-0"
      )}
    >
      <Icon className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
      {!compact && status.label}
    </Badge>
  );

  if (!showTooltip || !compact) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1.5">
            <p className="font-medium">{status.label}</p>
            {slaStatus.first_response_due && !slaStatus.first_response_at && (
              <p className="text-xs">
                First response due: {new Date(slaStatus.first_response_due).toLocaleTimeString()}
              </p>
            )}
            {slaStatus.first_response_at && slaStatus.resolution_due && (
              <p className="text-xs">
                Resolution due: {new Date(slaStatus.resolution_due).toLocaleTimeString()}
              </p>
            )}
            {slaStatus.current_escalation_level > 0 && (
              <p className="text-xs text-yellow-600">
                Escalation level: {slaStatus.current_escalation_level}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// Lightweight version for list views
export const SLAStatusIndicator = ({ conversationId }: { conversationId: string }) => {
  const { data: slaStatus } = useQuery({
    queryKey: ["sla-status", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_sla_status")
        .select("first_response_breached, resolution_breached, resolved_at, status")
        .eq("conversation_id", conversationId)
        .maybeSingle();

      if (error) return null;
      return data;
    },
    enabled: !!conversationId,
    staleTime: 60000
  });

  if (!slaStatus) return null;

  if (slaStatus.resolved_at) {
    return <span className="h-2 w-2 rounded-full bg-green-500" title="Resolved" />;
  }

  if (slaStatus.first_response_breached || slaStatus.resolution_breached) {
    return <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" title="SLA Breached" />;
  }

  if (slaStatus.status === "at_risk") {
    return <span className="h-2 w-2 rounded-full bg-yellow-500" title="At Risk" />;
  }

  return <span className="h-2 w-2 rounded-full bg-green-500/50" title="On Track" />;
};
