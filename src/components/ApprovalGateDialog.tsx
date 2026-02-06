import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, DollarSign, Clock, Send } from 'lucide-react';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { CLJBadge } from '@/components/CLJBadge';

interface ApprovalGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  contactId: string;
  contactName: string;
  estimatedValue: number;
  cljNumber?: string;
  onApprovalSubmitted?: () => void;
  onCancel?: () => void;
}

export const ApprovalGateDialog: React.FC<ApprovalGateDialogProps> = ({
  open,
  onOpenChange,
  pipelineEntryId,
  contactId,
  contactName,
  estimatedValue,
  cljNumber,
  onApprovalSubmitted,
  onCancel,
}) => {
  const [justification, setJustification] = useState('');
  const { loading, submitApprovalRequest, getThresholdForValue } = useApprovalGate();

  const threshold = getThresholdForValue(estimatedValue);
  
  const getPriorityLevel = () => {
    if (estimatedValue > 50000) return { level: 'critical', color: 'destructive' as const, label: 'Critical Priority' };
    if (estimatedValue > 25000) return { level: 'high', color: 'default' as const, label: 'High Priority' };
    return { level: 'standard', color: 'secondary' as const, label: 'Standard Priority' };
  };

  const priority = getPriorityLevel();

  const handleSubmit = async () => {
    if (!justification.trim()) return;

    const result = await submitApprovalRequest(
      pipelineEntryId,
      contactId,
      estimatedValue,
      justification
    );

    if (result.success) {
      setJustification('');
      onOpenChange(false);
      onApprovalSubmitted?.();
    }
  };

  const handleCancel = () => {
    setJustification('');
    onOpenChange(false);
    onCancel?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Manager Approval Required
          </DialogTitle>
          <DialogDescription>
            This project exceeds the approval threshold and requires manager review before conversion.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Contact</span>
              <span className="font-semibold">{contactName}</span>
            </div>
            
            {cljNumber && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">C-L-J Number</span>
                <CLJBadge cljNumber={cljNumber} />
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Estimated Value</span>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold text-primary">
                  ${estimatedValue.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Priority</span>
              <Badge variant={priority.color}>
                {priority.label}
              </Badge>
            </div>

            {threshold && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Threshold</span>
                <span className="text-sm text-muted-foreground">
                  ${threshold.minValue.toLocaleString()}+
                </span>
              </div>
            )}
          </div>

          {/* Business Justification */}
          <div className="space-y-2">
            <label htmlFor="justification" className="text-sm font-medium">
              Business Justification <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this lead should be converted to a project. Include any relevant details about the opportunity, customer relationship, or business impact..."
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This will be reviewed by a manager before the project can proceed.
            </p>
          </div>

          {/* Info Box */}
          <div className="flex items-start gap-2 p-3 bg-info/10 rounded-lg text-sm">
            <Clock className="h-4 w-4 text-info mt-0.5" />
            <div>
              <p className="font-medium">What happens next?</p>
              <p className="text-muted-foreground">
                The lead will move to "Pending Approval" status. A manager will review your request and either approve or reject the conversion.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !justification.trim()}
          >
            <Send className="h-4 w-4 mr-2" />
            {loading ? 'Submitting...' : 'Submit for Approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ApprovalGateDialog;
