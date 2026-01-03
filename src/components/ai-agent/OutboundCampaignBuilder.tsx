import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  PhoneOutgoing, 
  Users, 
  Calendar, 
  Play, 
  Pause,
  BarChart,
  Clock,
  MessageSquare
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';

interface CampaignConfig {
  name: string;
  description: string;
  callType: 'follow_up' | 'appointment_confirmation' | 'survey' | 'reengagement';
  customScript: string;
  targetContacts: 'all_leads' | 'cold_leads' | 'hot_leads' | 'custom';
  maxCallsPerDay: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

interface OutboundCampaignBuilderProps {
  onCampaignCreated?: (campaign: any) => void;
}

export function OutboundCampaignBuilder({ onCampaignCreated }: OutboundCampaignBuilderProps) {
  const { profile } = useUserProfile();
  const tenantId = profile?.tenant_id;
  const { toast } = useToast();

  const [config, setConfig] = useState<CampaignConfig>({
    name: '',
    description: '',
    callType: 'follow_up',
    customScript: '',
    targetContacts: 'cold_leads',
    maxCallsPerDay: 50,
    startTime: '09:00',
    endTime: '17:00',
    isActive: false,
  });

  const [isCreating, setIsCreating] = useState(false);

  const callTypeOptions = [
    { 
      value: 'follow_up', 
      label: 'Lead Follow-up',
      description: 'Re-engage leads who haven\'t responded',
      icon: '📞'
    },
    { 
      value: 'appointment_confirmation', 
      label: 'Appointment Confirmation',
      description: 'Confirm upcoming appointments',
      icon: '📅'
    },
    { 
      value: 'survey', 
      label: 'Customer Survey',
      description: 'Collect feedback after service',
      icon: '⭐'
    },
    { 
      value: 'reengagement', 
      label: 'Re-engagement',
      description: 'Revive dormant leads',
      icon: '🔄'
    },
  ];

  const targetOptions = [
    { value: 'all_leads', label: 'All Leads', count: 0 },
    { value: 'cold_leads', label: 'Cold Leads (No activity 7+ days)', count: 0 },
    { value: 'hot_leads', label: 'Hot Leads (Score 70+)', count: 0 },
    { value: 'custom', label: 'Custom Selection', count: 0 },
  ];

  const createCampaign = async () => {
    if (!config.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a campaign name',
        variant: 'destructive',
      });
      return;
    }

    setIsCreating(true);
    try {
      // Store campaign configuration
      const { data, error } = await supabase
        .from('dialer_campaigns')
        .insert({
          tenant_id: tenantId,
          name: config.name,
          description: config.description,
          campaign_type: 'ai_outbound',
          status: config.isActive ? 'active' : 'paused',
          settings: {
            call_type: config.callType,
            custom_script: config.customScript,
            target_contacts: config.targetContacts,
            max_calls_per_day: config.maxCallsPerDay,
            start_time: config.startTime,
            end_time: config.endTime,
          },
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Campaign Created',
        description: `${config.name} is ready to go`,
      });

      onCampaignCreated?.(data);
      
      // Reset form
      setConfig({
        name: '',
        description: '',
        callType: 'follow_up',
        customScript: '',
        targetContacts: 'cold_leads',
        maxCallsPerDay: 50,
        startTime: '09:00',
        endTime: '17:00',
        isActive: false,
      });
    } catch (err) {
      console.error('Error creating campaign:', err);
      toast({
        title: 'Error',
        description: 'Failed to create campaign',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const selectedCallType = callTypeOptions.find(opt => opt.value === config.callType);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneOutgoing className="h-5 w-5" />
            Create AI Outbound Campaign
          </CardTitle>
          <CardDescription>
            Set up automated AI-powered outbound calls to your contacts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Campaign Name */}
          <div className="space-y-2">
            <Label>Campaign Name</Label>
            <Input
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="e.g., January Lead Follow-up"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description (Optional)</Label>
            <Input
              value={config.description}
              onChange={(e) => setConfig({ ...config, description: e.target.value })}
              placeholder="Brief description of campaign goals"
            />
          </div>

          {/* Call Type */}
          <div className="space-y-2">
            <Label>Call Type</Label>
            <div className="grid grid-cols-2 gap-3">
              {callTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`p-4 border rounded-lg text-left transition-colors ${
                    config.callType === option.value
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => setConfig({ ...config, callType: option.value as any })}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{option.icon}</span>
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Script */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Custom Script (Optional)
            </Label>
            <Textarea
              value={config.customScript}
              onChange={(e) => setConfig({ ...config, customScript: e.target.value })}
              placeholder="Leave blank to use default script, or enter a custom opening message..."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              The AI will use this as the opening, then naturally gather information
            </p>
          </div>

          {/* Target Audience */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Target Contacts
            </Label>
            <Select
              value={config.targetContacts}
              onValueChange={(value) => setConfig({ ...config, targetContacts: value as any })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select target audience" />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schedule */}
          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Schedule
            </Label>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Start Time</Label>
                <Input
                  type="time"
                  value={config.startTime}
                  onChange={(e) => setConfig({ ...config, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">End Time</Label>
                <Input
                  type="time"
                  value={config.endTime}
                  onChange={(e) => setConfig({ ...config, endTime: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Max Calls Per Day</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={config.maxCallsPerDay}
                onChange={(e) => setConfig({ ...config, maxCallsPerDay: parseInt(e.target.value) || 50 })}
              />
              <p className="text-xs text-muted-foreground">
                Limit daily outbound calls to manage capacity
              </p>
            </div>
          </div>

          {/* Activate */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <Label>Activate Immediately</Label>
              <p className="text-sm text-muted-foreground">
                Start making calls as soon as campaign is created
              </p>
            </div>
            <Switch
              checked={config.isActive}
              onCheckedChange={(checked) => setConfig({ ...config, isActive: checked })}
            />
          </div>

          {/* Create Button */}
          <Button 
            className="w-full" 
            size="lg"
            onClick={createCampaign}
            disabled={isCreating || !config.name.trim()}
          >
            {config.isActive ? (
              <>
                <Play className="h-4 w-4 mr-2" />
                Create & Start Campaign
              </>
            ) : (
              <>
                <Calendar className="h-4 w-4 mr-2" />
                Create Campaign
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
