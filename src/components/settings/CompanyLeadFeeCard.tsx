import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCompanyLeadFeeRate } from '@/hooks/useCompanyLeadFeeRate';

/**
 * Owner-level tenant setting: the percentage charged back to a project when its
 * lead is marked "Company Generated". The fee is added to the project cost in
 * estimates and the final project cost breakdown.
 */
export const CompanyLeadFeeCard: React.FC<{ canEdit?: boolean }> = ({ canEdit = true }) => {
  const { companyLeadFeeRate, isLoading, refetch, tenantId } = useCompanyLeadFeeRate();
  const [rate, setRate] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setRate(companyLeadFeeRate);
  }, [companyLeadFeeRate]);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('tenants')
        .update({ company_lead_fee_rate: rate })
        .eq('id', tenantId);
      if (error) throw error;
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['company-lead-fee-rate'] });
      toast({ title: 'Saved', description: 'Company lead fee updated.' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Company Lead Fee
        </CardTitle>
        <CardDescription>
          Charged automatically on any lead set to "Company Generated". The fee is calculated on the
          gross contract price and added to the project cost in estimates and the final cost breakdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="space-y-2 w-40">
          <Label htmlFor="company-lead-fee">Fee (%)</Label>
          <Input
            id="company-lead-fee"
            type="number"
            step="0.5"
            min="0"
            max="100"
            value={rate}
            disabled={!canEdit || isLoading}
            onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
          />
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving || isLoading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
