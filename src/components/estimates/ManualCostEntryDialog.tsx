import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Package, Hammer, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ManualCostEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'materials' | 'labor';
  pipelineEntryId: string;
  currentValue: number;
  selectedEstimateId: string | null;
  onSuccess: () => void;
}

export const ManualCostEntryDialog: React.FC<ManualCostEntryDialogProps> = ({
  open,
  onOpenChange,
  type,
  pipelineEntryId,
  currentValue,
  selectedEstimateId,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<string>(currentValue > 0 ? currentValue.toString() : '');
  const [notes, setNotes] = useState('');

  const Icon = type === 'materials' ? Package : Hammer;
  const title = type === 'materials' ? 'Enter Material Cost' : 'Enter Labor Cost';
  const columnName = type === 'materials' ? 'material_cost' : 'labor_cost';
  const manualFlagColumn = type === 'materials' ? 'material_cost_manual' : 'labor_cost_manual';

  const saveMutation = useMutation({
    mutationFn: async (cost: number) => {
      // Get the tenant_id for creating new estimates
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', userData.user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      let estimateId = selectedEstimateId;

      // If no estimate exists, create one
      if (!estimateId) {
        // Build the insert object - cast to bypass type checking for new columns
        const insertData: Record<string, unknown> = {
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          estimate_number: `EST-${Date.now()}`,
          status: 'draft',
          material_cost: type === 'materials' ? cost : 0,
          labor_cost: type === 'labor' ? cost : 0,
          material_cost_manual: type === 'materials',
          labor_cost_manual: type === 'labor',
          manual_override_notes: notes || null,
          created_by: userData.user.id,
        };

        const { data: newEstimate, error: createError } = await supabase
          .from('enhanced_estimates')
          .insert(insertData as any)
          .select('id')
          .single();

        if (createError) throw createError;
        estimateId = newEstimate.id;
      } else {
        // Update existing estimate - build update object dynamically
        const updateData: Record<string, unknown> = {};
        
        if (type === 'materials') {
          updateData.material_cost = cost;
          updateData.material_cost_manual = true;
        } else {
          updateData.labor_cost = cost;
          updateData.labor_cost_manual = true;
        }

        // Append to existing notes if any
        if (notes) {
          updateData.manual_override_notes = notes;
        }

        // Recalculate selling price based on costs
        const { data: currentEstimate } = await supabase
          .from('enhanced_estimates')
          .select('material_cost, labor_cost, overhead_percent, target_profit_percent')
          .eq('id', estimateId)
          .single();

        if (currentEstimate) {
          const materialCost = type === 'materials' ? cost : (currentEstimate.material_cost || 0);
          const laborCost = type === 'labor' ? cost : (currentEstimate.labor_cost || 0);
          const overheadPercent = currentEstimate.overhead_percent || 10;
          const profitPercent = currentEstimate.target_profit_percent || 30;

          const subtotal = Number(materialCost) + Number(laborCost);
          const overheadAmount = subtotal * (overheadPercent / 100);
          const costPreProfit = subtotal + overheadAmount;
          const sellingPrice = costPreProfit / (1 - profitPercent / 100);
          const profitAmount = sellingPrice - costPreProfit;

          updateData.subtotal = subtotal;
          updateData.overhead_amount = overheadAmount;
          updateData.selling_price = Math.round(sellingPrice * 100) / 100;
          updateData.actual_profit_amount = profitAmount;
          updateData.actual_profit_percent = profitPercent;
        }

        const { error: updateError } = await supabase
          .from('enhanced_estimates')
          .update(updateData)
          .eq('id', estimateId);

        if (updateError) throw updateError;
      }

      return estimateId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      toast.success(`${type === 'materials' ? 'Material' : 'Labor'} cost saved`);
      onSuccess();
      onOpenChange(false);
      setAmount('');
      setNotes('');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  const handleSave = () => {
    const numericAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    saveMutation.mutate(numericAmount);
  };

  const formatCurrency = (value: string) => {
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Enter a fixed {type} cost to override AI calculations.
            {currentValue > 0 && (
              <span className="block mt-1 text-muted-foreground">
                Current value: {formatCurrency(currentValue.toString())}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                placeholder="15,000"
                value={amount}
                onChange={(e) => {
                  // Only allow numbers and decimal
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setAmount(value);
                }}
                className="pl-7 text-lg font-semibold"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="e.g., Fixed price from supplier quote"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending || !amount}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Cost'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
