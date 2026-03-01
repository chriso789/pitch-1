import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Loader2, Save, TestTube2, CheckCircle2, XCircle, Eye, EyeOff, ExternalLink } from 'lucide-react';

interface MetaCapiConfig {
  pixel_id: string;
  access_token: string;
  enabled: boolean;
}

const DEFAULT_CONFIG: MetaCapiConfig = {
  pixel_id: '',
  access_token: '',
  enabled: false,
};

export function MetaCAPISettings() {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const [config, setConfig] = useState<MetaCapiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedConfig, setSavedConfig] = useState<MetaCapiConfig>(DEFAULT_CONFIG);

  // Load existing config from tenant settings
  useEffect(() => {
    if (!tenantId) return;

    const loadConfig = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('settings')
          .eq('id', tenantId)
          .single();

        if (error) throw error;

        const metaCapi = (data?.settings as Record<string, unknown>)?.meta_capi as MetaCapiConfig | undefined;
        if (metaCapi) {
          setConfig(metaCapi);
          setSavedConfig(metaCapi);
        }
      } catch (err) {
        console.error('Failed to load Meta CAPI config:', err);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [tenantId]);

  // Track changes
  useEffect(() => {
    setHasChanges(JSON.stringify(config) !== JSON.stringify(savedConfig));
  }, [config, savedConfig]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);

    try {
      // Read current settings to merge
      const { data: current, error: readErr } = await supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single();

      if (readErr) throw readErr;

      const existingSettings = (current?.settings as Record<string, unknown>) || {};
      const updatedSettings = { ...existingSettings, meta_capi: config };

      const { error } = await supabase
        .from('tenants')
        .update({ settings: updatedSettings } as any)
        .eq('id', tenantId);

      if (error) throw error;

      setSavedConfig(config);
      setHasChanges(false);
      toast({ title: 'Meta CAPI settings saved', description: 'Your configuration has been updated.' });
    } catch (err) {
      console.error('Failed to save Meta CAPI config:', err);
      toast({ title: 'Save failed', description: 'Could not save settings.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.pixel_id || !config.access_token) {
      toast({ title: 'Missing credentials', description: 'Enter both Pixel ID and Access Token first.', variant: 'destructive' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // Save first if there are unsaved changes
      if (hasChanges) {
        await handleSave();
      }

      const { data, error } = await supabase.functions.invoke('meta-capi', {
        body: {
          event_name: 'Lead',
          tenant_id: tenantId,
          contact_id: crypto.randomUUID(),
          custom_data: { test_event: true },
          email: 'test@example.com',
          phone: '+15551234567',
        },
      });

      if (error) throw error;

      if (data?.ok && !data?.skipped) {
        setTestResult({ success: true, message: `Test event sent! Events received: ${data.events_received ?? 'unknown'}` });
      } else if (data?.skipped) {
        setTestResult({ success: false, message: data.reason || 'Meta CAPI is not enabled.' });
      } else {
        setTestResult({ success: false, message: JSON.stringify(data?.error || 'Unknown error') });
      }
    } catch (err) {
      console.error('Test failed:', err);
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Meta Conversions API (CAPI)
                <Badge variant={config.enabled ? 'default' : 'secondary'}>
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </CardTitle>
              <CardDescription>
                Send server-side lead events to Meta/Facebook for accurate ad attribution and conversion tracking.
              </CardDescription>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Pixel ID */}
          <div className="space-y-2">
            <Label htmlFor="pixel-id">Facebook Pixel ID</Label>
            <Input
              id="pixel-id"
              placeholder="e.g. 123456789012345"
              value={config.pixel_id}
              onChange={(e) => setConfig((c) => ({ ...c, pixel_id: e.target.value.trim() }))}
            />
            <p className="text-xs text-muted-foreground">
              Found in{' '}
              <a
                href="https://business.facebook.com/events_manager"
                target="_blank"
                rel="noopener noreferrer"
                className="underline inline-flex items-center gap-0.5"
              >
                Meta Events Manager <ExternalLink className="h-3 w-3" />
              </a>{' '}
              → Data Sources → Your Pixel → Settings.
            </p>
          </div>

          {/* Access Token */}
          <div className="space-y-2">
            <Label htmlFor="access-token">Conversions API Access Token</Label>
            <div className="relative">
              <Input
                id="access-token"
                type={showToken ? 'text' : 'password'}
                placeholder="EAAx..."
                value={config.access_token}
                onChange={(e) => setConfig((c) => ({ ...c, access_token: e.target.value.trim() }))}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Generate in Events Manager → Settings → Conversions API → Generate Access Token.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Settings
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing || !config.pixel_id || !config.access_token}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
              Send Test Event
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                testResult.success
                  ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400'
                  : 'border-destructive/30 bg-destructive/5 text-destructive'
              }`}
            >
              {testResult.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            When a new lead is created in PITCH CRM, a server-side <strong>Lead</strong> event is sent to Meta
            with SHA-256 hashed email and phone for privacy-safe matching.
          </p>
          <p>
            This replaces browser-based pixel tracking and provides more reliable attribution,
            especially for leads coming through forms, phone calls, and third-party integrations.
          </p>
          <p>
            Events appear in your{' '}
            <a
              href="https://business.facebook.com/events_manager"
              target="_blank"
              rel="noopener noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              Meta Events Manager <ExternalLink className="h-3 w-3" />
            </a>{' '}
            within a few minutes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
