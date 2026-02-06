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
import { AlertTriangle, FileText, Camera, CheckSquare, ShieldCheck, ShieldX } from 'lucide-react';
import { useProductionGates } from '@/hooks/useProductionGates';

interface ProductionGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  targetStage: string;
  gateName: string;
  missingItems: {
    documents: string[];
    photos: string[];
    checklists: string[];
  };
  canBypass: boolean;
  onValidated?: () => void;
  onBypassed?: () => void;
  onCancel?: () => void;
}

export const ProductionGateDialog: React.FC<ProductionGateDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  targetStage,
  gateName,
  missingItems,
  canBypass,
  onValidated,
  onBypassed,
  onCancel,
}) => {
  const [bypassReason, setBypassReason] = useState('');
  const [showBypassForm, setShowBypassForm] = useState(false);
  const { recordGateValidation, loading } = useProductionGates(projectId);

  const totalMissing = 
    missingItems.documents.length + 
    missingItems.photos.length + 
    missingItems.checklists.length;

  const handleBypass = async () => {
    if (!bypassReason.trim()) return;

    // Find the gate key from the stage
    const stageGateMap: Record<string, string> = {
      'in_progress': 'pre_work',
      'work_started': 'work_started',
      'quality_check': 'quality_check',
      'completed': 'completion',
      'invoiced': 'completion',
    };
    const gateKey = stageGateMap[targetStage] || 'pre_work';

    const success = await recordGateValidation(gateKey, true, bypassReason);
    if (success) {
      setBypassReason('');
      setShowBypassForm(false);
      onOpenChange(false);
      onBypassed?.();
    }
  };

  const handleCancel = () => {
    setBypassReason('');
    setShowBypassForm(false);
    onOpenChange(false);
    onCancel?.();
  };

  const formatItemName = (item: string) => {
    return item.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Production Gate: {gateName}
          </DialogTitle>
          <DialogDescription>
            The following items are required before moving to {formatItemName(targetStage)} stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Missing Items Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-4">
            {/* Documents */}
            {missingItems.documents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4 text-primary" />
                  <span>Missing Documents ({missingItems.documents.length})</span>
                </div>
                <div className="flex flex-wrap gap-2 pl-6">
                  {missingItems.documents.map((doc) => (
                    <Badge key={doc} variant="outline" className="text-destructive border-destructive/30">
                      {formatItemName(doc)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Photos */}
            {missingItems.photos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Camera className="h-4 w-4 text-primary" />
                  <span>Missing Photos ({missingItems.photos.length})</span>
                </div>
                <div className="flex flex-wrap gap-2 pl-6">
                  {missingItems.photos.map((photo) => (
                    <Badge key={photo} variant="outline" className="text-destructive border-destructive/30">
                      {formatItemName(photo)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Checklists */}
            {missingItems.checklists.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckSquare className="h-4 w-4 text-primary" />
                  <span>Incomplete Checklist Items ({missingItems.checklists.length})</span>
                </div>
                <div className="flex flex-wrap gap-2 pl-6">
                  {missingItems.checklists.map((item) => (
                    <Badge key={item} variant="outline" className="text-destructive border-destructive/30">
                      {formatItemName(item)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bypass Section */}
          {canBypass && (
            <div className="border rounded-lg p-4 space-y-3">
              {!showBypassForm ? (
                <div className="flex items-start gap-3">
                  <ShieldX className="h-5 w-5 text-warning mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Manager Override Available</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      As a manager, you can bypass this gate with a documented reason.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBypassForm(true)}
                    >
                      Bypass Gate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldX className="h-4 w-4 text-warning" />
                    <span>Bypass Reason <span className="text-destructive">*</span></span>
                  </div>
                  <Textarea
                    value={bypassReason}
                    onChange={(e) => setBypassReason(e.target.value)}
                    placeholder="Explain why this gate is being bypassed. This will be logged for audit purposes..."
                    rows={3}
                    className="resize-none"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBypassForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBypass}
                      disabled={loading || !bypassReason.trim()}
                    >
                      {loading ? 'Processing...' : 'Confirm Bypass'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Info */}
          <div className="flex items-start gap-2 p-3 bg-info/10 rounded-lg text-sm">
            <ShieldCheck className="h-4 w-4 text-info mt-0.5" />
            <div>
              <p className="font-medium">How to proceed</p>
              <p className="text-muted-foreground">
                Upload the required documents and photos, then complete the checklist items to automatically validate this gate.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Close
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onValidated?.();
            }}
            disabled={totalMissing > 0}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            Proceed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProductionGateDialog;
