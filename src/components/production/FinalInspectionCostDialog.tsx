import React, { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InvoiceUploadCard } from './InvoiceUploadCard';
import { CostReconciliationPanel } from './CostReconciliationPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Wrench, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface FinalInspectionCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
}

export const FinalInspectionCostDialog: React.FC<FinalInspectionCostDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectName
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize cost verification when dialog opens
  useEffect(() => {
    if (open && projectId) {
      initializeCostVerification();
    }
  }, [open, projectId]);

  const initializeCostVerification = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('request-cost-verification', {
        body: { project_id: projectId }
      });

      if (error) {
        console.error('Error initializing cost verification:', error);
        // Don't show error toast - reconciliation may already exist
      } else {
        queryClient.invalidateQueries({ queryKey: ['cost-reconciliation', projectId] });
      }
    } catch (error) {
      console.error('Error initializing cost verification:', error);
    }
  };

  const handleInvoiceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['cost-reconciliation', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project-invoices', projectId] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Final Inspection - Cost Verification
          </DialogTitle>
          <DialogDescription>
            {projectName && <span className="font-medium">{projectName}</span>}
            {' - '}Upload actual invoices to verify and reconcile project costs.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="summary" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="summary" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="materials" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Materials
            </TabsTrigger>
            <TabsTrigger value="labor" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Labor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            <CostReconciliationPanel projectId={projectId} />
          </TabsContent>

          <TabsContent value="materials" className="mt-4">
            <div className="grid gap-4">
              <InvoiceUploadCard
                projectId={projectId}
                invoiceType="material"
                onSuccess={handleInvoiceSuccess}
              />
            </div>
          </TabsContent>

          <TabsContent value="labor" className="mt-4">
            <div className="grid gap-4">
              <InvoiceUploadCard
                projectId={projectId}
                invoiceType="labor"
                onSuccess={handleInvoiceSuccess}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
