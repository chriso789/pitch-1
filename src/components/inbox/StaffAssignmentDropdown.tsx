import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { User, Users, ChevronDown, CheckCircle, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: string;
  full_name: string;
  avatar_url?: string;
  role: string;
  status?: "online" | "busy" | "away" | "offline";
  active_conversations?: number;
  max_conversations?: number;
}

interface StaffAssignmentDropdownProps {
  conversationId: string;
  currentAssigneeId?: string | null;
  onAssign?: (userId: string) => void;
  compact?: boolean;
}

export const StaffAssignmentDropdown = ({
  conversationId,
  currentAssigneeId,
  onAssign,
  compact = false
}: StaffAssignmentDropdownProps) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  // Fetch team members with workload
  const { data: staffMembers, isLoading } = useQuery({
    queryKey: ["staff-with-workload", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url, role")
        .eq("tenant_id", tenantId);

      if (profilesError) throw profilesError;

      // Get workload data
      const { data: workloads } = await supabase
        .from("staff_workload")
        .select("user_id, active_conversations, max_conversations, availability_status")
        .eq("tenant_id", tenantId);

      // Merge data
      const workloadMap = new Map((workloads || []).map((w: any) => [w.user_id, w]));
      
      return (profiles || []).map((profile: any) => ({
        id: profile.id,
        full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown',
        avatar_url: profile.avatar_url,
        role: profile.role,
        status: (workloadMap.get(profile.id) as any)?.availability_status || "offline",
        active_conversations: (workloadMap.get(profile.id) as any)?.active_conversations || 0,
        max_conversations: (workloadMap.get(profile.id) as any)?.max_conversations || 20
      })) as StaffMember[];
    },
    enabled: !!tenantId
  });

  // Get current assignee
  const currentAssignee = staffMembers?.find(s => s.id === currentAssigneeId);

  // Assignment mutation
  const assignMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Call the edge function to assign
      const { error } = await supabase.functions.invoke("communication-inbox-manager", {
        body: {
          action: "assign_to_staff",
          conversationId,
          userId
        }
      });

      if (error) throw error;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["staff-with-workload"] });
      toast.success("Conversation assigned");
      onAssign?.(userId);
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to assign: " + error.message);
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online": return "bg-green-500";
      case "busy": return "bg-yellow-500";
      case "away": return "bg-orange-500";
      default: return "bg-gray-400";
    }
  };

  const getWorkloadColor = (active: number, max: number) => {
    const ratio = active / max;
    if (ratio >= 0.9) return "text-destructive";
    if (ratio >= 0.7) return "text-yellow-600";
    return "text-muted-foreground";
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (compact) {
    return (
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
            {currentAssignee ? (
              <>
                <Avatar className="h-5 w-5">
                  <AvatarImage src={currentAssignee.avatar_url} />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(currentAssignee.full_name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs max-w-[60px] truncate">{currentAssignee.full_name.split(" ")[0]}</span>
              </>
            ) : (
              <>
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Unassigned</span>
              </>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Assign to Team Member
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {isLoading ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              Loading team...
            </div>
          ) : (
            staffMembers?.map((member) => (
              <DropdownMenuItem
                key={member.id}
                onClick={() => assignMutation.mutate(member.id)}
                disabled={assignMutation.isPending}
                className="flex items-center gap-3 py-2"
              >
                <div className="relative">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.avatar_url} />
                    <AvatarFallback className="text-xs">
                      {getInitials(member.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className={cn(
                    "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background",
                    getStatusColor(member.status || "offline")
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{member.full_name}</span>
                    {member.id === currentAssigneeId && (
                      <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground capitalize">{member.role}</span>
                    <span className={cn("font-medium", getWorkloadColor(member.active_conversations || 0, member.max_conversations || 20))}>
                      {member.active_conversations}/{member.max_conversations}
                    </span>
                  </div>
                </div>
              </DropdownMenuItem>
            ))
          )}

          {currentAssigneeId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  // Unassign logic would go here
                  toast.info("Unassign functionality coming soon");
                }}
                className="text-muted-foreground"
              >
                <Circle className="h-4 w-4 mr-2" />
                Unassign
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Assigned To</label>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            {currentAssignee ? (
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={currentAssignee.avatar_url} />
                  <AvatarFallback className="text-xs">
                    {getInitials(currentAssignee.full_name)}
                  </AvatarFallback>
                </Avatar>
                <span>{currentAssignee.full_name}</span>
                <Badge variant="secondary" className="text-xs">
                  {currentAssignee.active_conversations}/{currentAssignee.max_conversations}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">Select team member...</span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team Members
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {isLoading ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              Loading team members...
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {staffMembers?.map((member) => (
                <DropdownMenuItem
                  key={member.id}
                  onClick={() => assignMutation.mutate(member.id)}
                  disabled={assignMutation.isPending}
                  className="flex items-center gap-3 py-3"
                >
                  <div className="relative">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={member.avatar_url} />
                      <AvatarFallback>
                        {getInitials(member.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn(
                      "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background",
                      getStatusColor(member.status || "offline")
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{member.full_name}</span>
                      {member.id === currentAssigneeId && (
                        <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{member.role}</span>
                      <span>•</span>
                      <span className={getWorkloadColor(member.active_conversations || 0, member.max_conversations || 20)}>
                        {member.active_conversations} / {member.max_conversations} conversations
                      </span>
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
