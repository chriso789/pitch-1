/**
 * AI Follow-up Agent Settings Component
 * Configure AI agent behavior, persona, and channel preferences
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Save, Play, Clock, MessageSquare, Mail, Phone, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";

interface AIAgentProfile {
  id: string;
  tenant_id: string;
  name: string;
  enabled: boolean;
  persona_prompt: string;
  safety_prompt: string;
  working_hours: Record<string, unknown> & {
    start?: string;
    end?: string;
    timezone?: string;
    days?: number[];
  };
  escalation_rules: Record<string, unknown> & {
    keywords: string[];
    max_attempts: number;
    escalation_delay_hours: number;
  };
}

export function AIFollowupAgentSettings() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [hasChanges, setHasChanges] = useState(false);
  const [localProfile, setLocalProfile] = useState<AIAgentProfile | null>(null);

  // Fetch agent profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ["ai-agent-profile", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      
      const { data, error } = await supabase
        .from("ai_agents")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as AIAgentProfile | null;
    },
    enabled: !!tenantId,
  });

  // Initialize local state when profile loads
  useEffect(() => {
    if (profile) {
      setLocalProfile(profile);
    }
  }, [profile]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updatedProfile: Partial<AIAgentProfile>) => {
      if (!tenantId) throw new Error("No tenant");

      if (localProfile?.id) {
        // Update existing
        const { error } = await supabase
          .from("ai_agents")
          .update({
            name: updatedProfile.name,
            enabled: updatedProfile.enabled,
            persona_prompt: updatedProfile.persona_prompt,
            safety_prompt: updatedProfile.safety_prompt,
            working_hours: updatedProfile.working_hours,
            escalation_rules: updatedProfile.escalation_rules,
            updated_at: new Date().toISOString(),
          })
          .eq("id", localProfile.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from("ai_agents")
          .insert({
            tenant_id: tenantId,
            name: updatedProfile.name || "Follow-Up Agent",
            enabled: updatedProfile.enabled ?? false,
            persona_prompt: updatedProfile.persona_prompt || getDefaultPersonaPrompt(),
            safety_prompt: updatedProfile.safety_prompt || getDefaultSafetyPrompt(),
            working_hours: updatedProfile.working_hours || getDefaultWorkingHours(),
            escalation_rules: updatedProfile.escalation_rules || getDefaultEscalationRules(),
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-agent-profile"] });
      setHasChanges(false);
      toast({ title: "Settings saved", description: "AI agent configuration updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error saving settings", description: error.message, variant: "destructive" });
    },
  });

  // Run AI worker manually
  const runWorkerMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("ai-followup-runner", {
        body: {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "AI Worker Started", description: "Processing aged leads and queued follow-ups." });
      queryClient.invalidateQueries({ queryKey: ["ai-outreach-queue"] });
    },
    onError: (error) => {
      toast({ title: "Worker Error", description: error.message, variant: "destructive" });
    },
  });

  // Create default profile
  const createDefaultProfile = async () => {
    if (!tenantId) return;

    const defaultProfile: Partial<AIAgentProfile> = {
      name: "Follow-Up Agent",
      enabled: false,
      persona_prompt: getDefaultPersonaPrompt(),
      safety_prompt: getDefaultSafetyPrompt(),
      working_hours: getDefaultWorkingHours(),
      escalation_rules: getDefaultEscalationRules(),
    };

    saveMutation.mutate(defaultProfile);
  };

  const updateField = <K extends keyof AIAgentProfile>(field: K, value: AIAgentProfile[K]) => {
    if (!localProfile) return;
    setLocalProfile({ ...localProfile, [field]: value });
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!localProfile) return;
    saveMutation.mutate(localProfile);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!localProfile && !profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Follow-Up Agent
          </CardTitle>
          <CardDescription>
            No AI agent configured for this account. Create one to enable automated follow-ups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={createDefaultProfile} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Bot className="h-4 w-4 mr-2" />
            )}
            Create AI Agent
          </Button>
        </CardContent>
      </Card>
    );
  }

  const currentProfile = localProfile || profile!;

  return (
    <div className="space-y-6">
      {/* Main Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>{currentProfile.name}</CardTitle>
                <CardDescription>Configure AI-powered follow-up behavior</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={currentProfile.enabled ? "default" : "secondary"}>
                {currentProfile.enabled ? "Active" : "Disabled"}
              </Badge>
              <Switch
                checked={currentProfile.enabled}
                onCheckedChange={(checked) => updateField("enabled", checked)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Agent Name */}
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent Name</Label>
            <Input
              id="agent-name"
              value={currentProfile.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Follow-Up Agent"
            />
          </div>

          <Separator />

          {/* Persona Prompt */}
          <div className="space-y-2">
            <Label htmlFor="persona-prompt">Persona & Voice</Label>
            <p className="text-sm text-muted-foreground">
              Define how the AI should communicate. This sets the tone, style, and approach.
            </p>
            <Textarea
              id="persona-prompt"
              value={currentProfile.persona_prompt}
              onChange={(e) => updateField("persona_prompt", e.target.value)}
              rows={6}
              className="font-mono text-sm"
              placeholder="You are a friendly roofing sales assistant..."
            />
          </div>

          {/* Safety Prompt */}
          <div className="space-y-2">
            <Label htmlFor="safety-prompt" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Safety Rules
            </Label>
            <p className="text-sm text-muted-foreground">
              Rules the AI must always follow. These override other instructions.
            </p>
            <Textarea
              id="safety-prompt"
              value={currentProfile.safety_prompt}
              onChange={(e) => updateField("safety_prompt", e.target.value)}
              rows={4}
              className="font-mono text-sm"
              placeholder="Never promise pricing without inspection..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Working Hours Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Working Hours
          </CardTitle>
          <CardDescription>
            AI will only send messages during these hours (respects TCPA regulations)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={currentProfile.working_hours?.start || "09:00"}
                onChange={(e) =>
                  updateField("working_hours", {
                    ...currentProfile.working_hours,
                    start: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
                type="time"
                value={currentProfile.working_hours?.end || "20:00"}
                onChange={(e) =>
                  updateField("working_hours", {
                    ...currentProfile.working_hours,
                    end: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Times are in {currentProfile.working_hours?.timezone || "America/New_York"} timezone
          </p>
        </CardContent>
      </Card>

      {/* Escalation Rules Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Escalation Rules
          </CardTitle>
          <CardDescription>
            When should the AI hand off to a human?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="escalation-keywords">Escalation Keywords</Label>
            <p className="text-sm text-muted-foreground">
              If a homeowner uses these words, escalate immediately (comma-separated)
            </p>
            <Input
              id="escalation-keywords"
              value={(currentProfile.escalation_rules?.keywords || []).join(", ")}
              onChange={(e) =>
                updateField("escalation_rules", {
                  ...currentProfile.escalation_rules,
                  keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                })
              }
              placeholder="angry, lawyer, refund, complaint, manager"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-attempts">Max Attempts Before Escalation</Label>
              <Input
                id="max-attempts"
                type="number"
                min={1}
                max={10}
                value={currentProfile.escalation_rules?.max_attempts || 3}
                onChange={(e) =>
                  updateField("escalation_rules", {
                    ...currentProfile.escalation_rules,
                    max_attempts: parseInt(e.target.value) || 3,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalation-delay">Escalation Delay (hours)</Label>
              <Input
                id="escalation-delay"
                type="number"
                min={1}
                max={168}
                value={currentProfile.escalation_rules?.escalation_delay_hours || 24}
                onChange={(e) =>
                  updateField("escalation_rules", {
                    ...currentProfile.escalation_rules,
                    escalation_delay_hours: parseInt(e.target.value) || 24,
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => runWorkerMutation.mutate()}
          disabled={runWorkerMutation.isPending || !currentProfile.enabled}
        >
          {runWorkerMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Run AI Worker Now
        </Button>

        <Button onClick={handleSave} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// Default values
function getDefaultPersonaPrompt() {
  return `You are a friendly and professional roofing company follow-up specialist. Your job is to:
- Re-engage leads who haven't responded in a while
- Answer questions about project status
- Schedule inspections and appointments
- Be helpful, brief, and conversational

Keep messages short (under 320 characters for SMS). Never promise pricing without an inspection.
If someone seems frustrated or asks complex questions, offer to have a team member call them.`;
}

function getDefaultSafetyPrompt() {
  return `SAFETY RULES - Always follow these:
- If someone says "STOP", "unsubscribe", or "do not contact", immediately flag as do-not-contact
- Never share sensitive information (pricing, financials) via text
- Never make promises about timelines without checking
- If you detect frustration, anger, or legal threats, escalate immediately
- Always identify yourself as an AI assistant when asked
- Respect quiet hours (don't send between 9pm-8am)`;
}

function getDefaultWorkingHours() {
  return {
    start: "09:00",
    end: "20:00",
    timezone: "America/New_York",
    days: [1, 2, 3, 4, 5, 6], // Mon-Sat
  };
}

function getDefaultEscalationRules() {
  return {
    keywords: ["angry", "lawyer", "refund", "complaint", "manager", "sue", "attorney", "bbb"],
    max_attempts: 3,
    escalation_delay_hours: 24,
  };
}

export default AIFollowupAgentSettings;
