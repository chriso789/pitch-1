import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Save, ShieldCheck } from 'lucide-react';

interface WarrantyData {
  manufacturer: string;
  workmanship: string;
}

export function WarrantySettings() {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [manufacturer, setManufacturer] = useState('');
  const [workmanship, setWorkmanship] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant-warranty', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await supabase
        .from('tenants')
        .select('warranty_terms')
        .eq('id', tenantId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (tenant?.warranty_terms) {
      try {
        const parsed: WarrantyData = JSON.parse(tenant.warranty_terms);
        setManufacturer(parsed.manufacturer || '');
        setWorkmanship(parsed.workmanship || '');
      } catch {
        // Not valid JSON, ignore
      }
    }
    setHasChanges(false);
  }, [tenant]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('No tenant');
      const warrantyTerms = JSON.stringify({ manufacturer, workmanship });
      const { error } = await supabase
        .from('tenants')
        .update({ warranty_terms: warrantyTerms })
        .eq('id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-warranty', tenantId] });
      setHasChanges(false);
      toast({ title: 'Warranty terms saved' });
    },
    onError: (err: any) => {
      toast({ title: 'Error saving warranty terms', description: err.message, variant: 'destructive' });
    },
  });

  const handleChange = (field: 'manufacturer' | 'workmanship', value: string) => {
    if (field === 'manufacturer') setManufacturer(value);
    else setWorkmanship(value);
    setHasChanges(true);
  };

  if (isLoading) return <div className="text-sm text-muted-foreground py-4">Loading...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Warranty Information
        </CardTitle>
        <CardDescription>
          Customize the warranty text that appears on customer-facing estimate PDFs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="manufacturer-warranty">Manufacturer Warranty</Label>
          <Textarea
            id="manufacturer-warranty"
            value={manufacturer}
            onChange={(e) => handleChange('manufacturer', e.target.value)}
            placeholder="All roofing materials include the full manufacturer's warranty as specified by the selected product line."
            rows={4}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workmanship-warranty">Workmanship Warranty</Label>
          <Textarea
            id="workmanship-warranty"
            value={workmanship}
            onChange={(e) => handleChange('workmanship', e.target.value)}
            placeholder="Our installation work is backed by a comprehensive workmanship warranty covering labor and installation quality."
            rows={4}
          />
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
        >
          <Save className="h-4 w-4 mr-1" />
          {saveMutation.isPending ? 'Saving...' : 'Save Warranty Terms'}
        </Button>
      </CardContent>
    </Card>
  );
}
