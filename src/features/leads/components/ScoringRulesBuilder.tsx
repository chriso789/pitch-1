import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2, Save } from "lucide-react";

interface ScoringRule {
  id?: string;
  rule_name: string;
  field_name: string;
  operator: string;
  field_value: string;
  points: number;
  is_active: boolean;
}

export default function ScoringRulesBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<ScoringRule[]>([]);

  const { data: existingRules = [], isLoading } = useQuery({
    queryKey: ['scoring-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .select('*')
        .order('points', { ascending: false });
      if (error) throw error;
      return data as ScoringRule[];
    },
  });

  useEffect(() => {
    if (existingRules && existingRules.length > 0) {
      setRules(existingRules);
    }
  }, [existingRules]);

  const saveMutation = useMutation({
    mutationFn: async (rulesToSave: ScoringRule[]) => {
      // Delete old rules and insert new ones
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      // Delete existing rules
      await supabase
        .from('lead_scoring_rules')
        .delete()
        .eq('tenant_id', profile.tenant_id);

      // Insert new rules
      const { error } = await supabase
        .from('lead_scoring_rules')
        .insert(rulesToSave.map(rule => ({
          ...rule,
          tenant_id: profile.tenant_id,
        })));

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
      toast({ title: "Scoring rules saved", description: "Your lead scoring rules have been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save rules", description: error.message, variant: "destructive" });
    },
  });

  const handleAddRule = () => {
    setRules([
      ...rules,
      {
        rule_name: '',
        field_name: 'lead_status',
        operator: 'equals',
        field_value: '',
        points: 10,
        is_active: true,
      },
    ]);
  };

  const handleRemoveRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleUpdateRule = (index: number, field: keyof ScoringRule, value: any) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    setRules(updated);
  };

  const handleSave = () => {
    saveMutation.mutate(rules);
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading scoring rules...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Scoring Rules Builder</h2>
          <p className="text-muted-foreground">Configure automatic lead scoring criteria</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleAddRule} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Rules'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scoring Rules</CardTitle>
          <CardDescription>
            Define conditions that automatically add or subtract points from lead scores
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No scoring rules defined yet.</p>
              <p className="text-sm">Click "Add Rule" to create your first rule.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {rules.map((rule, index) => (
                <Card key={index} className="p-4">
                  <div className="grid gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Rule Name</Label>
                        <Input
                          placeholder="e.g., Hot lead status"
                          value={rule.rule_name}
                          onChange={(e) => handleUpdateRule(index, 'rule_name', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Points</Label>
                        <Input
                          type="number"
                          placeholder="10"
                          value={rule.points}
                          onChange={(e) => handleUpdateRule(index, 'points', parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Field</Label>
                        <Select
                          value={rule.field_name}
                          onValueChange={(value) => handleUpdateRule(index, 'field_name', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lead_status">Lead Status</SelectItem>
                            <SelectItem value="lead_source">Lead Source</SelectItem>
                            <SelectItem value="budget">Budget</SelectItem>
                            <SelectItem value="urgency">Urgency</SelectItem>
                            <SelectItem value="last_contact_days">Days Since Contact</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Operator</Label>
                        <Select
                          value={rule.operator}
                          onValueChange={(value) => handleUpdateRule(index, 'operator', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equals">Equals</SelectItem>
                            <SelectItem value="not_equals">Not Equals</SelectItem>
                            <SelectItem value="contains">Contains</SelectItem>
                            <SelectItem value="greater_than">Greater Than</SelectItem>
                            <SelectItem value="less_than">Less Than</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Value</Label>
                        <Input
                          placeholder="e.g., hot"
                          value={rule.field_value}
                          onChange={(e) => handleUpdateRule(index, 'field_value', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={(checked) => handleUpdateRule(index, 'is_active', checked)}
                        />
                        <Label className="text-sm">Active</Label>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveRule(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example Rules</CardTitle>
          <CardDescription>Common lead scoring patterns to get you started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between p-2 border rounded">
              <span>Lead Status = "hot"</span>
              <span className="font-semibold text-green-600">+30 points</span>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <span>Lead Source = "referral"</span>
              <span className="font-semibold text-green-600">+20 points</span>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <span>Days Since Contact &gt; 30</span>
              <span className="font-semibold text-red-600">-15 points</span>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <span>Budget &gt; 10000</span>
              <span className="font-semibold text-green-600">+25 points</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
