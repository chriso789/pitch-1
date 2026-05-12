import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';

const OPTIONS = [
  { value: '0', label: 'Forever (no auto-archive)' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '120', label: '120 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

export const PipelineVisibilitySettings: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [days, setDays] = useState<string>('90');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from('tenant_settings')
        .select('pipeline_lead_visibility_days')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (data?.pipeline_lead_visibility_days != null) {
        setDays(String(data.pipeline_lead_visibility_days));
      }
      setLoading(false);
    })();
  }, [tenantId]);

  const handleChange = async (value: string) => {
    if (!tenantId) return;
    setDays(value);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tenant_settings')
        .upsert(
          { tenant_id: tenantId, pipeline_lead_visibility_days: parseInt(value, 10) },
          { onConflict: 'tenant_id' }
        );
      if (error) throw error;
      toast({ title: 'Saved', description: 'Pipeline visibility window updated' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to save setting', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead Visibility Window</CardTitle>
        <CardDescription>
          Choose how long a lead stays visible on the pipeline board before it's automatically archived.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 max-w-md">
          <Label className="shrink-0">Keep leads visible for</Label>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Select value={days} onValueChange={handleChange} disabled={saving}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );
};
