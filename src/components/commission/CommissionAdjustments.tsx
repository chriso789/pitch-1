import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/commission-calculator';

interface CommissionAdjustmentsProps {
  projectId?: string;
  pipelineEntryId?: string;
  userId: string;
  tenantId: string;
  readOnly?: boolean;
}

const ADJUSTMENT_TYPES = [
  { value: 'credit', label: 'Credit', color: 'bg-green-500' },
  { value: 'material_credit', label: 'Material Credit', color: 'bg-emerald-500' },
  { value: 'bonus', label: 'Bonus', color: 'bg-blue-500' },
  { value: 'chargeback', label: 'Chargeback', color: 'bg-red-500' },
  { value: 'deduction', label: 'Deduction', color: 'bg-orange-500' },
  { value: 'other', label: 'Other', color: 'bg-gray-500' },
];

export function CommissionAdjustments({
  projectId,
  pipelineEntryId,
  userId,
  tenantId,
  readOnly = false,
}: CommissionAdjustmentsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState('credit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: adjustments = [], isLoading } = useQuery({
    queryKey: ['commission-adjustments', projectId, pipelineEntryId, userId],
    queryFn: async () => {
      let query = supabase
        .from('commission_adjustments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (projectId) {
        query = query.eq('project_id', projectId);
      } else if (pipelineEntryId) {
        query = query.eq('pipeline_entry_id', pipelineEntryId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (newAdjustment: {
      adjustment_type: string;
      amount: number;
      description: string;
    }) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('commission_adjustments')
        .insert({
          tenant_id: tenantId,
          project_id: projectId || null,
          pipeline_entry_id: pipelineEntryId || null,
          user_id: userId,
          adjustment_type: newAdjustment.adjustment_type,
          amount: newAdjustment.amount,
          description: newAdjustment.description,
          created_by: user?.user?.id,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-adjustments'] });
      setIsOpen(false);
      setAmount('');
      setDescription('');
      setAdjustmentType('credit');
      toast({ title: 'Adjustment added successfully' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to add adjustment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('commission_adjustments')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-adjustments'] });
      toast({ title: 'Adjustment deleted' });
    },
  });

  const handleSubmit = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount === 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid non-zero amount',
        variant: 'destructive',
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: 'Description required',
        description: 'Please enter a description for this adjustment',
        variant: 'destructive',
      });
      return;
    }

    // Chargebacks and deductions should be negative
    const finalAmount =
      ['chargeback', 'deduction'].includes(adjustmentType) && numAmount > 0
        ? -numAmount
        : numAmount;

    addMutation.mutate({
      adjustment_type: adjustmentType,
      amount: finalAmount,
      description: description.trim(),
    });
  };

  const totalAdjustments = adjustments.reduce(
    (sum, adj) => sum + Number(adj.amount),
    0
  );

  const getTypeConfig = (type: string) =>
    ADJUSTMENT_TYPES.find((t) => t.value === type) || ADJUSTMENT_TYPES[5];

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading adjustments...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Adjustments</span>
          <Badge variant={totalAdjustments >= 0 ? 'default' : 'destructive'}>
            {formatCurrency(totalAdjustments)}
          </Badge>
        </div>

        {!readOnly && (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add Adjustment
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Commission Adjustment</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Adjustment Type</Label>
                  <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADJUSTMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-7"
                      placeholder="0.00"
                    />
                  </div>
                  {['chargeback', 'deduction'].includes(adjustmentType) && (
                    <p className="text-xs text-muted-foreground">
                      This will be recorded as a negative amount
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the reason for this adjustment..."
                    rows={3}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={addMutation.isPending}>
                    {addMutation.isPending ? 'Adding...' : 'Add Adjustment'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {adjustments.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {!readOnly && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.map((adj) => {
              const typeConfig = getTypeConfig(adj.adjustment_type);
              return (
                <TableRow key={adj.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`${typeConfig.color} text-white border-0`}
                    >
                      {typeConfig.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{adj.description}</TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      Number(adj.amount) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(Number(adj.amount))}
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(adj.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          No adjustments recorded
        </p>
      )}
    </div>
  );
}
