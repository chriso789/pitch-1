import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Mail, MessageCircle, Phone, Clock, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface CampaignStep {
  id?: string;
  step_order: number;
  step_name: string;
  step_type: string;
  delay_hours: number;
  content_template: string;
  content_variables: any;
  conditions: any;
  is_active: boolean;
}

interface CampaignBuilderProps {
  onSave: () => void;
  editingCampaign?: any;
}

export const CampaignBuilder = ({ onSave, editingCampaign }: CampaignBuilderProps) => {
  const { toast } = useToast();
  
  const [campaignData, setCampaignData] = useState({
    name: editingCampaign?.name || '',
    description: editingCampaign?.description || '',
    trigger_type: editingCampaign?.trigger_type || 'lead_score',
    trigger_conditions: editingCampaign?.trigger_conditions || {},
    target_audience: editingCampaign?.target_audience || {},
    is_active: editingCampaign?.is_active || false
  });

  const [steps, setSteps] = useState<CampaignStep[]>(
    editingCampaign?.steps || [
      {
        step_order: 1,
        step_name: 'Welcome Email',
        step_type: 'email',
        delay_hours: 0,
        content_template: 'Welcome to our roofing services! We\'re excited to help you with your project.',
        content_variables: {},
        conditions: {},
        is_active: true
      }
    ]
  );

  const addStep = () => {
    const newStep: CampaignStep = {
      step_order: steps.length + 1,
      step_name: `Step ${steps.length + 1}`,
      step_type: 'email',
      delay_hours: 24,
      content_template: '',
      content_variables: {},
      conditions: {},
      is_active: true
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (index: number, field: keyof CampaignStep, value: any) => {
    const updatedSteps = [...steps];
    updatedSteps[index] = { ...updatedSteps[index], [field]: value };
    setSteps(updatedSteps);
  };

  const removeStep = (index: number) => {
    if (steps.length > 1) {
      const updatedSteps = steps.filter((_, i) => i !== index);
      // Reorder steps
      updatedSteps.forEach((step, i) => {
        step.step_order = i + 1;
      });
      setSteps(updatedSteps);
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        ...campaignData,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      let campaignId;
      
      if (editingCampaign) {
        // Update existing campaign
        const { error } = await supabase
          .from('nurturing_campaigns')
          .update(payload)
          .eq('id', editingCampaign.id);

        if (error) throw error;
        campaignId = editingCampaign.id;
      } else {
        // Create new campaign
        const { data, error } = await supabase
          .from('nurturing_campaigns')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        campaignId = data.id;
      }

      // Save steps
      if (editingCampaign) {
        // Delete existing steps
        await supabase
          .from('nurturing_campaign_steps')
          .delete()
          .eq('campaign_id', campaignId);
      }

      // Insert new steps
      const stepsPayload = steps.map(step => ({
        ...step,
        campaign_id: campaignId,
        tenant_id: payload.tenant_id
      }));

      const { error: stepsError } = await supabase
        .from('nurturing_campaign_steps')
        .insert(stepsPayload);

      if (stepsError) throw stepsError;

      toast({
        title: "Success",
        description: `Campaign ${editingCampaign ? 'updated' : 'created'} successfully`,
      });

      onSave();
    } catch (error) {
      console.error('Error saving campaign:', error);
      toast({
        title: "Error",
        description: "Failed to save campaign",
        variant: "destructive",
      });
    }
  };

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'email': return <Mail className="h-4 w-4" />;
      case 'sms': return <MessageCircle className="h-4 w-4" />;
      case 'call_reminder': return <Phone className="h-4 w-4" />;
      case 'wait': return <Clock className="h-4 w-4" />;
      default: return <Target className="h-4 w-4" />;
    }
  };

  const formatDelay = (hours: number) => {
    if (hours === 0) return 'Immediately';
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days} day${days > 1 ? 's' : ''}`;
    return `${days}d ${remainingHours}h`;
  };

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto">
      {/* Campaign Details */}
      <Card>
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
          <CardDescription>Define your campaign settings and triggers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="campaign_name">Campaign Name</Label>
              <Input
                id="campaign_name"
                value={campaignData.name}
                onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                placeholder="e.g., New Lead Welcome Series"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="trigger_type">Trigger Type</Label>
              <Select
                value={campaignData.trigger_type}
                onValueChange={(value) => setCampaignData({ ...campaignData, trigger_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead_score">Lead Score Change</SelectItem>
                  <SelectItem value="status_change">Status Change</SelectItem>
                  <SelectItem value="time_based">Time-Based</SelectItem>
                  <SelectItem value="behavior">Behavior Trigger</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={campaignData.description}
              onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
              placeholder="Describe the purpose of this campaign..."
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={campaignData.is_active}
              onCheckedChange={(checked) => setCampaignData({ ...campaignData, is_active: checked })}
            />
            <Label htmlFor="is_active">Active Campaign</Label>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Steps */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Campaign Steps</CardTitle>
              <CardDescription>Define the sequence of actions in your campaign</CardDescription>
            </div>
            <Button onClick={addStep} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Step
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                <Card className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        {getStepIcon(step.step_type)}
                        <Badge variant="outline">Step {step.step_order}</Badge>
                        <Badge variant="secondary">{formatDelay(step.delay_hours)}</Badge>
                      </div>
                      {steps.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label>Step Name</Label>
                        <Input
                          value={step.step_name}
                          onChange={(e) => updateStep(index, 'step_name', e.target.value)}
                          placeholder="Step name"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Step Type</Label>
                        <Select
                          value={step.step_type}
                          onValueChange={(value) => updateStep(index, 'step_type', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="sms">SMS</SelectItem>
                            <SelectItem value="call_reminder">Call Reminder</SelectItem>
                            <SelectItem value="task">Task</SelectItem>
                            <SelectItem value="wait">Wait Period</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Delay (hours)</Label>
                        <Input
                          type="number"
                          value={step.delay_hours}
                          onChange={(e) => updateStep(index, 'delay_hours', parseInt(e.target.value) || 0)}
                          placeholder="0"
                          min="0"
                        />
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={step.is_active}
                          onCheckedChange={(checked) => updateStep(index, 'is_active', checked)}
                        />
                        <Label>Active Step</Label>
                      </div>
                    </div>

                    {step.step_type !== 'wait' && (
                      <div className="space-y-2">
                        <Label>Content Template</Label>
                        <Textarea
                          value={step.content_template}
                          onChange={(e) => updateStep(index, 'content_template', e.target.value)}
                          placeholder="Enter your message template here..."
                          rows={3}
                        />
                        <p className="text-xs text-muted-foreground">
                          Use variables like {`{{first_name}}`}, {`{{company_name}}`}, {`{{lead_score}}`}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                {index < steps.length - 1 && (
                  <div className="flex justify-center py-2">
                    <div className="w-px h-6 bg-border" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onSave}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          {editingCampaign ? 'Update Campaign' : 'Create Campaign'}
        </Button>
      </div>
    </div>
  );
};