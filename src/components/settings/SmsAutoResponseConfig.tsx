import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { toast } from '@/components/ui/use-toast';
import { MessageSquare, Plus, Trash2, TestTube, Clock, Save, Loader2 } from 'lucide-react';

interface SmsConfig {
  enabled: boolean;
  keywords: Record<string, string>;
  business_hours?: { start: string; end: string; timezone: string };
  after_hours_message?: string;
}

const DEFAULT_CONFIG: SmsConfig = {
  enabled: true,
  keywords: {
    STOP: 'You have been unsubscribed. Reply START to re-subscribe.',
    HELP: 'For assistance, call us at {{company_phone}} or visit {{company_website}}',
    QUOTE: 'Thanks for your interest! A team member will send you a quote shortly.',
    STATUS: "We'll check on your project status and get back to you shortly.",
    SCHEDULE: 'To schedule an appointment, visit {{booking_link}} or call {{company_phone}}',
  },
  business_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
  after_hours_message: "Thanks for your message! Our office is currently closed. We'll respond during business hours.",
};

export const SmsAutoResponseConfig = () => {
  const { activeTenantId: tenantId } = useActiveTenantId();
  const queryClient = useQueryClient();

  const [newKeyword, setNewKeyword] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['sms-auto-responder-config', tenantId],
    queryFn: async () => {
      if (!tenantId) return DEFAULT_CONFIG;
      const { data, error } = await supabase.functions.invoke('sms-auto-responder', {
        body: { action: 'get_config', tenant_id: tenantId },
      });
      if (error) throw error;
      return (data?.data as SmsConfig) || DEFAULT_CONFIG;
    },
    enabled: !!tenantId,
  });

  const saveMutation = useMutation({
    mutationFn: async (newConfig: SmsConfig) => {
      const { data, error } = await supabase.functions.invoke('sms-auto-responder', {
        body: { action: 'configure', tenant_id: tenantId, config: newConfig },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-auto-responder-config'] });
      toast({ title: 'Saved', description: 'SMS auto-responder config updated.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save config.', variant: 'destructive' });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (message: string) => {
      const { data, error } = await supabase.functions.invoke('sms-auto-responder', {
        body: { action: 'test', tenant_id: tenantId, message },
      });
      if (error) throw error;
      return data?.data;
    },
    onSuccess: (data) => setTestResult(data),
  });

  const currentConfig = config || DEFAULT_CONFIG;

  const updateConfig = (updates: Partial<SmsConfig>) => {
    saveMutation.mutate({ ...currentConfig, ...updates });
  };

  const addKeyword = () => {
    if (!newKeyword.trim() || !newResponse.trim()) return;
    const updated = { ...currentConfig.keywords, [newKeyword.toUpperCase().trim()]: newResponse.trim() };
    saveMutation.mutate({ ...currentConfig, keywords: updated });
    setNewKeyword('');
    setNewResponse('');
  };

  const removeKeyword = (keyword: string) => {
    const updated = { ...currentConfig.keywords };
    delete updated[keyword];
    saveMutation.mutate({ ...currentConfig, keywords: updated });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enable/Disable */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                SMS Auto-Responder
              </CardTitle>
              <CardDescription>Automatically respond to incoming SMS messages based on keyword triggers</CardDescription>
            </div>
            <Switch
              checked={currentConfig.enabled}
              onCheckedChange={(enabled) => updateConfig({ enabled })}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Keyword Triggers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keyword Triggers</CardTitle>
          <CardDescription>When a customer texts one of these keywords, they get an instant auto-reply</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(currentConfig.keywords).map(([keyword, response]) => (
            <div key={keyword} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
              <Badge variant="secondary" className="mt-0.5 shrink-0 font-mono">{keyword}</Badge>
              <p className="text-sm flex-1">{response as string}</p>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeKeyword(keyword)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          <Separator />

          <div className="space-y-3">
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <div>
                <Label>Keyword</Label>
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value.toUpperCase())}
                  placeholder="e.g. PRICE"
                  className="font-mono"
                />
              </div>
              <div>
                <Label>Auto-Reply</Label>
                <Input
                  value={newResponse}
                  onChange={(e) => setNewResponse(e.target.value)}
                  placeholder="Response message when keyword is received"
                />
              </div>
            </div>
            <Button size="sm" onClick={addKeyword} disabled={!newKeyword.trim() || !newResponse.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Keyword
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Business Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Business Hours
          </CardTitle>
          <CardDescription>After-hours messages receive a special auto-response</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time</Label>
              <Input
                type="time"
                value={currentConfig.business_hours?.start || '09:00'}
                onChange={(e) => updateConfig({
                  business_hours: { ...currentConfig.business_hours!, start: e.target.value },
                })}
              />
            </div>
            <div>
              <Label>End Time</Label>
              <Input
                type="time"
                value={currentConfig.business_hours?.end || '17:00'}
                onChange={(e) => updateConfig({
                  business_hours: { ...currentConfig.business_hours!, end: e.target.value },
                })}
              />
            </div>
          </div>
          <div>
            <Label>After-Hours Message</Label>
            <Textarea
              value={currentConfig.after_hours_message || ''}
              onChange={(e) => updateConfig({ after_hours_message: e.target.value })}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TestTube className="h-4 w-4" />
            Test Auto-Responder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Type a test message (e.g. QUOTE)"
            />
            <Button onClick={() => testMutation.mutate(testMessage)} disabled={!testMessage || testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
            </Button>
          </div>
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.would_respond ? 'bg-green-500/10 border border-green-500/20' : 'bg-muted'}`}>
              {testResult.would_respond ? (
                <>
                  <p className="font-medium text-green-700">✓ Would auto-respond (keyword: {testResult.keyword})</p>
                  <p className="mt-1 text-muted-foreground">{testResult.response as string}</p>
                </>
              ) : (
                <p className="text-muted-foreground">No keyword match — message would go to AI or human agent</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
