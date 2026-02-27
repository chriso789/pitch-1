import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Phone, MapPin, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';

interface LocationWithPhone {
  id: string;
  name: string;
  telnyx_phone_number: string;
  is_primary: boolean;
}

export const DialerSettings: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();

  const { data: locations, isLoading } = useQuery({
    queryKey: ['dialer-locations', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, telnyx_phone_number, is_primary')
        .eq('tenant_id', tenantId)
        .not('telnyx_phone_number', 'is', null)
        .order('name');
      if (error) throw error;
      return (data || []) as LocationWithPhone[];
    },
    enabled: !!tenantId,
  });

  const { data: defaultCallerId } = useQuery({
    queryKey: ['default-dialer-caller-id', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('tenant_id', tenantId)
        .eq('setting_key', 'default_dialer_caller_id')
        .maybeSingle();
      if (error) throw error;
      return (data?.setting_value as any)?.location_id || null;
    },
    enabled: !!tenantId,
  });

  const saveMutation = useMutation({
    mutationFn: async (locationId: string) => {
      if (!tenantId) throw new Error('No tenant');
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Not authenticated');

      // Check if setting exists
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('setting_key', 'default_dialer_caller_id')
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('app_settings')
          .update({ setting_value: { location_id: locationId } as any })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('app_settings')
          .insert({
            tenant_id: tenantId,
            user_id: user.id,
            setting_key: 'default_dialer_caller_id',
            setting_value: { location_id: locationId } as any,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['default-dialer-caller-id'] });
      toast({ title: 'Default caller ID updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const formatPhone = (phone: string) => {
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('1')) {
      return `(${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
    }
    if (clean.length === 10) {
      return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
    }
    return phone;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Outbound Caller ID
          </CardTitle>
          <CardDescription>
            Choose which location number is used as your outbound caller ID when making calls from the dialer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !locations?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Phone className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No phone numbers configured</p>
              <p className="text-sm mt-1">
                Add a Telnyx phone number to a location in Location Management first.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => window.location.href = '/settings?tab=company'}
              >
                <MapPin className="h-4 w-4 mr-2" />
                Go to Location Management
              </Button>
            </div>
          ) : (
            <RadioGroup
              value={defaultCallerId || ''}
              onValueChange={(val) => saveMutation.mutate(val)}
              className="space-y-3"
            >
              {locations.map((loc) => (
                <label
                  key={loc.id}
                  className="flex items-center gap-4 p-4 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <RadioGroupItem value={loc.id} id={loc.id} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{loc.name}</span>
                      {loc.is_primary && (
                        <Badge variant="secondary" className="text-xs">Primary</Badge>
                      )}
                      {defaultCallerId === loc.id && (
                        <Badge variant="default" className="text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {formatPhone(loc.telnyx_phone_number)}
                    </p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => window.location.href = '/settings?tab=company'}
          >
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>Manage Location Phone Numbers</span>
            </div>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground mt-2 px-1">
            Add, edit, or port phone numbers for each location. Changes here will sync with the dialer caller ID selector.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DialerSettings;
