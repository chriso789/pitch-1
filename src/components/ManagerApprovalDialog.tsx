import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, DollarSign, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { CLJBadge } from '@/components/CLJBadge';

interface ManagerApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntry: any;
  onApprovalRequested?: () => void;
}

export const ManagerApprovalDialog: React.FC<ManagerApprovalDialogProps> = ({
  open,
  onOpenChange,
  pipelineEntry,
  onApprovalRequested
}) => {
  const [estimatedValue, setEstimatedValue] = useState('');
  const [businessJustification, setBusinessJustification] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequestApproval = async () => {
    if (!estimatedValue.trim() || !businessJustification.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide estimated value and business justification",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('api_request_manager_approval', {
        pipeline_entry_id_param: pipelineEntry.id,
        estimated_value_param: parseFloat(estimatedValue),
        business_justification_param: businessJustification
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message || "Failed to request approval",
          variant: "destructive",
        });
        return;
      }

      if (data && typeof data === 'object' && 'success' in data) {
        const result = data as { success: boolean; approval_id?: string; error?: string };
        if (result.success) {
          toast({
            title: "Success",
            description: "Manager approval request submitted successfully",
          });
          onOpenChange(false);
          onApprovalRequested?.();
          
          // Reset form
          setEstimatedValue('');
          setBusinessJustification('');
        } else {
          toast({
            title: "Error",
            description: result.error || "Failed to request approval",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Error",
          description: "Unexpected response format",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error requesting approval:', error);
      toast({
        title: "Error",
        description: "Failed to request approval",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getPriorityLevel = (value: number) => {
    if (value > 50000) return { level: 'high', color: 'destructive', icon: AlertTriangle };
    if (value > 25000) return { level: 'medium', color: 'default', icon: DollarSign };
    return { level: 'low', color: 'secondary', icon: CheckCircle };
  };

  const priority = estimatedValue ? getPriorityLevel(parseFloat(estimatedValue)) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Request Manager Approval
          </DialogTitle>
          <DialogDescription>
            This lead requires manager approval before converting to a project. Please provide the required information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Customer Info */}
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-medium">
              {pipelineEntry?.contacts?.first_name} {pipelineEntry?.contacts?.last_name}
            </div>
            <div className="text-sm text-muted-foreground">
              {pipelineEntry?.contacts?.address_street}, {pipelineEntry?.contacts?.address_city}
            </div>
            <div className="mt-2">
              <CLJBadge 
                cljNumber={pipelineEntry?.clj_formatted_number} 
                showLabel 
                size="lg"
              />
            </div>
          </div>

          {/* Estimated Value */}
          <div className="space-y-2">
            <Label htmlFor="estimated-value">Estimated Project Value *</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="estimated-value"
                type="number"
                placeholder="0.00"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                className="pl-9"
                min="0"
                step="0.01"
              />
            </div>
            {priority && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={priority.color as any} className="flex items-center gap-1">
                  <priority.icon className="h-3 w-3" />
                  {priority.level.toUpperCase()} Priority
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {priority.level === 'high' ? 'High priority approval (>$50K)' : 
                   priority.level === 'medium' ? 'Medium priority approval ($25K-$50K)' : 
                   'Low priority approval (<$25K)'}
                </span>
              </div>
            )}
          </div>

          {/* Business Justification */}
          <div className="space-y-2">
            <Label htmlFor="justification">Business Justification *</Label>
            <Textarea
              id="justification"
              placeholder="Explain why this lead should be converted to a project..."
              value={businessJustification}
              onChange={(e) => setBusinessJustification(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          {/* Current Status */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 text-blue-800">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Important</span>
            </div>
            <p className="text-sm text-blue-700 mt-1">
              This lead will be moved to "On Hold (Mgr Review)" status and will not advance until approved by a manager.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRequestApproval}
            disabled={loading || !estimatedValue.trim() || !businessJustification.trim()}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Requesting...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Request Approval
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};