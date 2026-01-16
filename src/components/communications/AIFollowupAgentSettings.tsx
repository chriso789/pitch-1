/**
 * AI Follow-up Agent Settings Component
 * Configure AI agent behavior, persona, and channel preferences
 * Mobile-first design with touch-friendly controls
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Save, Play, Clock, MessageSquare, Mail, Phone, AlertTriangle, Loader2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

// Local types - not strictly tied to Supabase Json type
interface WorkingHours {
  start?: string;
  end?: string;
  timezone?: string;
  days?: number[];
}

interface EscalationRules {
  keywords?: string[];
  max_attempts?: number;
  escalation_delay_hours?: number;
}

interface AIAgentProfile {
  id: string;
  tenant_id: string;
  name: string;
  enabled: boolean;
  persona_prompt: string;
  safety_prompt: string;
  working_hours: WorkingHours;
  escalation_rules: EscalationRules;
}

// Default values
const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: "09:00",
  end: "20:00",
  timezone: "America/New_York",
  days: [1, 2, 3, 4, 5, 6],
};

const DEFAULT_ESCALATION: EscalationRules = {
  keywords: ["angry", "lawyer", "refund", "complaint", "manager", "sue", "attorney", "bbb"],
  max_attempts: 3,
  escalation_delay_hours: 24,
};

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
      if (!data) return null;

      // Parse JSON fields safely with type assertions
      const workingHours = (data.working_hours as unknown as WorkingHours) || DEFAULT_WORKING_HOURS;
      const escalationRules = (data.escalation_rules as unknown as EscalationRules) || DEFAULT_ESCALATION;

      return {
        id: data.id,
        tenant_id: data.tenant_id,
        name: data.name,
        enabled: data.enabled,
        persona_prompt: data.persona_prompt,
        safety_prompt: data.safety_prompt,
        working_hours: workingHours,
        escalation_rules: escalationRules,
      } as AIAgentProfile;
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

      // Cast our types to Json for Supabase
      const workingHoursJson = updatedProfile.working_hours as unknown as Json;
      const escalationRulesJson = updatedProfile.escalation_rules as unknown as Json;

      if (localProfile?.id) {
        // Update existing
        const { error } = await supabase
          .from("ai_agents")
          .update({
            name: updatedProfile.name,
            enabled: updatedProfile.enabled,
            persona_prompt: updatedProfile.persona_prompt,
            safety_prompt: updatedProfile.safety_prompt,
            working_hours: workingHoursJson,
            escalation_rules: escalationRulesJson,
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
            working_hours: (updatedProfile.working_hours || DEFAULT_WORKING_HOURS) as unknown as Json,
            escalation_rules: (updatedProfile.escalation_rules || DEFAULT_ESCALATION) as unknown as Json,
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
      working_hours: DEFAULT_WORKING_HOURS,
      escalation_rules: DEFAULT_ESCALATION,
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
          <Button onClick={createDefaultProfile} disabled={saveMutation.isPending} className="w-full sm:w-auto h-12 sm:h-10">
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
    <div className="space-y-4">
      {/* Status Header - Mobile Optimized */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-lg border bg-card">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2.5 rounded-lg",
            currentProfile.enabled ? "bg-green-500/10" : "bg-muted"
          )}>
            <Bot className={cn(
              "h-5 w-5",
              currentProfile.enabled ? "text-green-500" : "text-muted-foreground"
            )} />
          </div>
          <div>
            <h3 className="font-semibold text-sm md:text-base">{currentProfile.name}</h3>
            <p className="text-xs md:text-sm text-muted-foreground">
              {currentProfile.enabled ? 'Active and processing queue' : 'Paused - not sending messages'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-between sm:justify-end">
          <Badge variant={currentProfile.enabled ? "default" : "secondary"} className="text-xs">
            {currentProfile.enabled ? "Active" : "Disabled"}
          </Badge>
          <Switch
            checked={currentProfile.enabled}
            onCheckedChange={(checked) => updateField("enabled", checked)}
            className="data-[state=checked]:bg-green-500"
          />
        </div>
      </div>

      {/* Quick Actions - Touch Friendly */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="h-14 md:h-12 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
          onClick={() => runWorkerMutation.mutate()}
          disabled={runWorkerMutation.isPending || !currentProfile.enabled}
        >
          {runWorkerMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span className="text-xs md:text-sm">Run Worker</span>
        </Button>
        <Button
          className="h-14 md:h-12 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
          onClick={handleSave}
          disabled={saveMutation.isPending || !hasChanges}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span className="text-xs md:text-sm">{hasChanges ? 'Save Changes' : 'Saved'}</span>
        </Button>
      </div>

      {/* Settings Accordion - Mobile Optimized */}
      <Accordion type="multiple" defaultValue={["persona"]} className="space-y-3">
        {/* Agent Identity */}
        <AccordionItem value="persona" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <Bot className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm md:text-base">Agent Persona</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name" className="text-sm">Agent Name</Label>
              <Input
                id="agent-name"
                value={currentProfile.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Follow-Up Agent"
                className="h-11 md:h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona-prompt" className="text-sm">Persona & Voice</Label>
              <p className="text-xs text-muted-foreground">
                Define how the AI should communicate
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

            <div className="space-y-2">
              <Label htmlFor="safety-prompt" className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                Safety Rules
              </Label>
              <p className="text-xs text-muted-foreground">
                Rules the AI must always follow
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
          </AccordionContent>
        </AccordionItem>

        {/* Working Hours */}
        <AccordionItem value="hours" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm md:text-base">Working Hours</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start-time" className="text-sm">Start Time</Label>
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
                  className="h-11 md:h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-time" className="text-sm">End Time</Label>
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
                  className="h-11 md:h-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Active Days</Label>
              <div className="flex flex-wrap gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                  const isActive = currentProfile.working_hours?.days?.includes(idx);
                  return (
                    <Button
                      key={day}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="h-10 w-12 md:h-9 md:w-10 p-0"
                      onClick={() => {
                        const currentDays = currentProfile.working_hours?.days || [];
                        const newDays = isActive
                          ? currentDays.filter(d => d !== idx)
                          : [...currentDays, idx].sort();
                        updateField("working_hours", {
                          ...currentProfile.working_hours,
                          days: newDays,
                        });
                      }}
                    >
                      {day.slice(0, 2)}
                    </Button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Times are in {currentProfile.working_hours?.timezone || "America/New_York"} timezone
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* Escalation Rules */}
        <AccordionItem value="escalation" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm md:text-base">Escalation Rules</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="escalation-keywords" className="text-sm">Escalation Keywords</Label>
              <p className="text-xs text-muted-foreground">
                If a homeowner uses these words, escalate immediately (comma-separated)
              </p>
              <Textarea
                id="escalation-keywords"
                value={(currentProfile.escalation_rules?.keywords || []).join(", ")}
                onChange={(e) =>
                  updateField("escalation_rules", {
                    ...currentProfile.escalation_rules,
                    keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                  })
                }
                placeholder="angry, lawyer, refund, complaint, manager"
                className="min-h-[80px] text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="max-attempts" className="text-sm">Max Attempts</Label>
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
                  className="h-11 md:h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="escalation-delay" className="text-sm">Delay (hours)</Label>
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
                  className="h-11 md:h-10"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Channel Preferences */}
        <AccordionItem value="channels" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <Settings2 className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm md:text-base">Channel Preferences</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-4 w-4 text-green-500" />
                  <div>
                    <p className="font-medium text-sm">SMS</p>
                    <p className="text-xs text-muted-foreground">Text message follow-ups</p>
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-blue-500" />
                  <div>
                    <p className="font-medium text-sm">Email</p>
                    <p className="text-xs text-muted-foreground">Email follow-ups</p>
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="font-medium text-sm">Voice Calls</p>
                    <p className="text-xs text-muted-foreground">AI voice follow-ups</p>
                  </div>
                </div>
                <Switch />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default AIFollowupAgentSettings;
