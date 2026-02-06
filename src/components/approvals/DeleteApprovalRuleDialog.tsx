import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ApprovalRule {
  id: string;
  rule_name: string;
  min_amount: number;
  max_amount: number | null;
}

interface DeleteApprovalRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: ApprovalRule | null;
  onSuccess: () => void;
}

export function DeleteApprovalRuleDialog({ 
  open, 
  onOpenChange, 
  rule, 
  onSuccess 
}: DeleteApprovalRuleDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getRuleDescription = () => {
    if (!rule) return '';
    const range = rule.max_amount 
      ? `${formatCurrency(rule.min_amount)} - ${formatCurrency(rule.max_amount)}`
      : `${formatCurrency(rule.min_amount)}+`;
    return `"${rule.rule_name}" (${range})`;
  };

  const handleDelete = async () => {
    if (!rule) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('purchase_order_approval_rules')
        .delete()
        .eq('id', rule.id);

      if (error) throw error;

      toast.success('Approval rule deleted');
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error deleting approval rule:', error);
      toast.error(error.message || 'Failed to delete approval rule');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Approval Rule</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Are you sure you want to delete {getRuleDescription()}?
            </p>
            <p className="text-destructive">
              This action cannot be undone. Any pending purchase orders using this 
              rule will need to be reassigned to a different approval workflow.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? 'Deleting...' : 'Delete Rule'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
