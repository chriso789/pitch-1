import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/commission-calculator';
import { CheckCircle, Edit2 } from 'lucide-react';

interface CapOutVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  currentValues: {
    sellPrice: number;
    materialsCost: number;
    laborCost: number;
    overheadAmount: number;
    commissionAmount: number;
  };
  onVerified: () => void;
}

export function CapOutVerifyDialog({ 
  open, onOpenChange, entryId, currentValues, onVerified 
}: CapOutVerifyDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'verify' | 'adjust'>('verify');
  const [adjustments, setAdjustments] = useState({
    sellPrice: String(currentValues.sellPrice),
    materialsCost: String(currentValues.materialsCost),
    laborCost: String(currentValues.laborCost),
    overheadAmount: String(currentValues.overheadAmount),
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleVerify = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updateData: Record<string, any> = {
        capout_verified_by: user.id,
        capout_verified_at: new Date().toISOString(),
      };

      if (mode === 'adjust') {
        const adjustmentRecord: Record<string, any> = {};
        const fields = ['sellPrice', 'materialsCost', 'laborCost', 'overheadAmount'] as const;
        
        fields.forEach(field => {
          const original = currentValues[field];
          const adjusted = parseFloat(adjustments[field]);
          if (original !== adjusted) {
            adjustmentRecord[field] = { original, adjusted, reason };
          }
        });

        if (Object.keys(adjustmentRecord).length > 0) {
          updateData.capout_adjustments = adjustmentRecord;
        }
      }

      const { error } = await supabase
        .from('pipeline_entries')
        .update(updateData)
        .eq('id', entryId);

      if (error) throw error;

      toast({ 
        title: mode === 'adjust' ? 'Cap Out Adjusted & Verified' : 'Cap Out Verified',
        description: 'The cap out sheet has been verified by manager.'
      });
      onVerified();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'verify' ? (
              <><CheckCircle className="h-5 w-5 text-green-500" /> Verify Cap Out</>
            ) : (
              <><Edit2 className="h-5 w-5 text-amber-500" /> Adjust Cap Out</>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Toggle */}
          <div className="flex gap-2">
            <Button 
              variant={mode === 'verify' ? 'default' : 'outline'} 
              size="sm" 
              onClick={() => setMode('verify')}
            >
              Verify As-Is
            </Button>
            <Button 
              variant={mode === 'adjust' ? 'default' : 'outline'} 
              size="sm" 
              onClick={() => setMode('adjust')}
            >
              Adjust Values
            </Button>
          </div>

          {mode === 'verify' ? (
            <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sell Price</span>
                <span className="font-medium">{formatCurrency(currentValues.sellPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Materials</span>
                <span>{formatCurrency(currentValues.materialsCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Labor</span>
                <span>{formatCurrency(currentValues.laborCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Overhead</span>
                <span>{formatCurrency(currentValues.overheadAmount)}</span>
              </div>
              <hr />
              <div className="flex justify-between font-bold">
                <span>Commission</span>
                <span className="text-green-600">{formatCurrency(currentValues.commissionAmount)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Sell Price</Label>
                <Input type="number" step="0.01" value={adjustments.sellPrice} onChange={e => setAdjustments(p => ({ ...p, sellPrice: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Materials Cost</Label>
                <Input type="number" step="0.01" value={adjustments.materialsCost} onChange={e => setAdjustments(p => ({ ...p, materialsCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Labor Cost</Label>
                <Input type="number" step="0.01" value={adjustments.laborCost} onChange={e => setAdjustments(p => ({ ...p, laborCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Overhead</Label>
                <Input type="number" step="0.01" value={adjustments.overheadAmount} onChange={e => setAdjustments(p => ({ ...p, overheadAmount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason for Adjustment</Label>
                <Textarea placeholder="Explain discrepancy..." value={reason} onChange={e => setReason(e.target.value)} />
              </div>
            </div>
          )}

          <Button 
            className="w-full" 
            onClick={handleVerify} 
            disabled={saving || (mode === 'adjust' && !reason.trim())}
          >
            {saving ? 'Saving...' : mode === 'adjust' ? 'Adjust & Verify' : 'Verify Cap Out'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}