import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformFeatureFlags } from '@/hooks/usePlatformFeatureFlags';
import {
  AlertTriangle,
  ShieldAlert,
  Wrench,
  Loader2,
  Phone,
  FileText,
  MapPin,
  Camera,
  CreditCard,
  Target,
  Ruler,
  FolderKanban,
  Building2,
} from 'lucide-react';

const FEATURES: { key: string; name: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { key: 'pipeline', name: 'Pipeline', icon: FolderKanban, description: 'Lead & project pipeline management' },
  { key: 'estimates', name: 'Estimates', icon: FileText, description: 'Estimate builder & proposals' },
  { key: 'dialer', name: 'Power Dialer', icon: Phone, description: 'Click-to-call & call tracking' },
  { key: 'smart_docs', name: 'Smart Docs', icon: FileText, description: 'Document templates & e-signatures' },
  { key: 'measurements', name: 'AI Measurements', icon: Ruler, description: 'Satellite roof measurements' },
  { key: 'projects', name: 'Projects', icon: Building2, description: 'Project management & tracking' },
  { key: 'storm_canvass', name: 'Storm Canvass', icon: Target, description: 'Canvassing & territory management' },
  { key: 'territory', name: 'Territory Mapping', icon: MapPin, description: 'GPS tracking & route planning' },
  { key: 'photos', name: 'Photo Management', icon: Camera, description: 'Job photos & documentation' },
  { key: 'payments', name: 'Payments', icon: CreditCard, description: 'Payment processing & invoicing' },
];

/**
 * Master-only kill switch. When a feature is toggled OFF here, the feature
 * is hidden / blocked for every tenant regardless of their per-tenant
 * feature settings. Only the master role bypasses the kill switch so they
 * can keep accessing the feature to fix it.
 */
export const PlatformFeatureKillSwitch: React.FC = () => {
  const { flags, isLoading } = usePlatformFeatureFlags();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const setFeature = async (featureKey: string, disabled: boolean) => {
    setBusy(featureKey);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id ?? null;
      const reason = disabled
        ? (reasons[featureKey] ?? flags[featureKey]?.reason ?? '').trim() || 'Temporarily disabled for maintenance'
        : null;

      const payload = {
        feature_key: featureKey,
        disabled,
        reason,
        disabled_by: disabled ? userId : null,
        disabled_at: disabled ? new Date().toISOString() : null,
      };

      const { error } = await (supabase as any)
        .from('platform_feature_flags')
        .upsert(payload, { onConflict: 'feature_key' });

      if (error) throw error;
      toast({
        title: disabled ? 'Feature disabled platform-wide' : 'Feature re-enabled',
        description: `${FEATURES.find(f => f.key === featureKey)?.name ?? featureKey} ${
          disabled ? 'is now hidden for all tenants.' : 'is back online for all tenants.'
        }`,
      });
    } catch (e: any) {
      toast({
        title: 'Error updating kill switch',
        description: e?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const disabledCount = Object.values(flags).filter(f => f.disabled).length;

  return (
    <div className="space-y-6">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <CardTitle>Platform Kill Switch</CardTitle>
              <CardDescription className="mt-1">
                Disable a feature for <strong>every tenant at once</strong> while you fix it.
                Tenant-level toggles are ignored when a feature is killed here. Only your
                master account can still access a killed feature.
              </CardDescription>
            </div>
            <Badge variant={disabledCount > 0 ? 'destructive' : 'secondary'}>
              {disabledCount} disabled
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FEATURES.map(feature => {
            const Icon = feature.icon;
            const flag = flags[feature.key];
            const isDisabled = !!flag?.disabled;
            const reasonValue =
              reasons[feature.key] ?? flag?.reason ?? '';

            return (
              <Card
                key={feature.key}
                className={isDisabled ? 'border-destructive/50 bg-destructive/5' : ''}
              >
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                          isDisabled
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {feature.name}
                          {isDisabled && (
                            <Badge variant="destructive" className="gap-1">
                              <Wrench className="h-3 w-3" />
                              Offline
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {feature.description}
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={!isDisabled}
                      disabled={busy === feature.key}
                      onCheckedChange={(checked) => setFeature(feature.key, !checked)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Reason / message shown to tenants
                    </label>
                    <Textarea
                      rows={2}
                      placeholder="e.g. Measurements pipeline is being fixed — back in a few hours."
                      value={reasonValue}
                      onChange={(e) =>
                        setReasons(prev => ({ ...prev, [feature.key]: e.target.value }))
                      }
                    />
                    {isDisabled && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        disabled={busy === feature.key}
                        onClick={() => setFeature(feature.key, true)}
                      >
                        {busy === feature.key ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-2" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 mr-2" />
                        )}
                        Update reason
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlatformFeatureKillSwitch;
