import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useQueryClient } from '@tanstack/react-query';
import { ALL_TRADES, type TradeValue } from '@/lib/trades';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface CompanyTradeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabledTrades: string[];
  onSaved: (trades: string[]) => void;
}

export function CompanyTradeSettings({ open, onOpenChange, enabledTrades, onSaved }: CompanyTradeSettingsProps) {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(enabledTrades);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(enabledTrades);
    }
  }, [open, enabledTrades]);

  const handleToggle = (value: string, checked: boolean) => {
    if (checked) {
      setSelected(prev => [...prev, value]);
    } else {
      setSelected(prev => prev.filter(v => v !== value));
    }
  };

  const handleSave = async () => {
    if (!effectiveTenantId) return;
    setSaving(true);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upsert to app_settings
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          {
            user_id: user.id,
            tenant_id: effectiveTenantId,
            setting_key: 'enabled_estimate_trades',
            setting_value: JSON.stringify(selected),
          },
          { onConflict: 'user_id,tenant_id,setting_key' }
        );

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['enabled-estimate-trades'] });
      onSaved(selected);
      onOpenChange(false);
      toast({ title: 'Trade settings saved' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Trades</DialogTitle>
          <DialogDescription>
            Select which trades your company offers. Each trade gets its own template tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {ALL_TRADES.map((trade) => (
            <div key={trade.value} className="flex items-center gap-3">
              <Checkbox
                id={`trade-${trade.value}`}
                checked={selected.includes(trade.value)}
                onCheckedChange={(checked) => handleToggle(trade.value, !!checked)}
                disabled={trade.locked}
              />
              <Label
                htmlFor={`trade-${trade.value}`}
                className="flex items-center gap-2 cursor-pointer"
              >
                <span>{trade.icon}</span>
                <span>{trade.label}</span>
                {trade.locked && (
                  <span className="text-xs text-muted-foreground">(always enabled)</span>
                )}
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
