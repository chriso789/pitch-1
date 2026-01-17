import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ArrowRight, FileText, MapPin, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LeadSelectionList } from './LeadSelectionList';
import { TemplateCombobox } from './TemplateCombobox';
import { EnhancedLeadCreationDialog } from '@/components/EnhancedLeadCreationDialog';

interface CreateEstimateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Lead {
  id: string;
  clj_formatted_number: string | null;
  status: string | null;
  created_at: string | null;
  contact: {
    first_name: string;
    last_name: string;
    phone: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
  } | null;
  estimate_count: number;
  has_measurements: boolean;
}

interface Template {
  id: string;
  name: string;
  roof_type?: string;
}

export const CreateEstimateDialog: React.FC<CreateEstimateDialogProps> = ({
  open,
  onOpenChange
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const tenantId = user?.active_tenant_id || user?.tenant_id;

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showLeadCreation, setShowLeadCreation] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedLead(null);
      setSelectedTemplateId('');
    }
  }, [open]);

  // Fetch templates when step 2 is reached
  useEffect(() => {
    if (step === 2 && tenantId) {
      fetchTemplates();
    }
  }, [step, tenantId]);

  const fetchTemplates = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingTemplates(true);
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('id, name, roof_type')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleLeadSelect = (lead: Lead) => {
    setSelectedLead(lead);
  };

  const handleContinueToStep2 = () => {
    if (!selectedLead) {
      toast({
        title: "Select a Lead",
        description: "Please select a lead to create an estimate for.",
        variant: "destructive"
      });
      return;
    }
    setStep(2);
  };

  const handleCreateEstimate = () => {
    if (!selectedLead) return;

    // Build URL with optional template
    let url = `/lead/${selectedLead.id}?tab=estimate`;
    if (selectedTemplateId) {
      url += `&templateId=${selectedTemplateId}`;
    }

    onOpenChange(false);
    navigate(url);
  };

  const handleLeadCreated = (lead: any) => {
    setShowLeadCreation(false);
    // Refresh will happen automatically when the dialog is shown again
    toast({
      title: "Lead Created",
      description: "You can now select it to create an estimate."
    });
  };

  const formatAddress = (contact: Lead['contact']) => {
    if (!contact) return 'No address';
    const parts = [
      contact.address_street,
      contact.address_city,
      contact.address_state,
      contact.address_zip
    ].filter(Boolean);
    return parts.join(', ') || 'No address';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Create New Estimate
            </DialogTitle>
            <DialogDescription>
              {step === 1 
                ? "Select a lead to create an estimate for" 
                : "Choose a template to pre-populate your estimate (optional)"
              }
            </DialogDescription>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center gap-2 mb-4">
            <Badge variant={step === 1 ? "default" : "secondary"}>1. Select Lead</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={step === 2 ? "default" : "secondary"}>2. Choose Template</Badge>
          </div>

          {/* Step 1: Lead Selection */}
          {step === 1 && tenantId && (
            <div className="space-y-4">
              <LeadSelectionList
                tenantId={tenantId}
                onSelect={handleLeadSelect}
                onCreateNew={() => setShowLeadCreation(true)}
                selectedLeadId={selectedLead?.id}
              />
              
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleContinueToStep2}
                  disabled={!selectedLead}
                  className="gradient-primary"
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Template Selection */}
          {step === 2 && selectedLead && (
            <div className="space-y-4">
              {/* Selected Lead Summary */}
              <Card className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">
                        {selectedLead.contact 
                          ? `${selectedLead.contact.first_name} ${selectedLead.contact.last_name}`
                          : 'Unknown Contact'}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <MapPin className="h-3 w-3" />
                        {formatAddress(selectedLead.contact)}
                      </div>
                    </div>
                    <Badge variant="outline">{selectedLead.status || 'unknown'}</Badge>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* Template Selection */}
              <div className="space-y-2">
                <Label>Select Template (Optional)</Label>
                <p className="text-sm text-muted-foreground">
                  Choose a template to pre-populate line items and settings
                </p>
                
                {loadingTemplates ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading templates...
                  </div>
                ) : templates.length > 0 ? (
                  <TemplateCombobox
                    templates={templates}
                    value={selectedTemplateId}
                    onValueChange={setSelectedTemplateId}
                    placeholder="Select a template..."
                  />
                ) : (
                  <div className="text-sm text-muted-foreground py-2 px-3 bg-muted/50 rounded-md">
                    No templates available. You can create templates in Settings.
                  </div>
                )}
              </div>

              <div className="flex justify-between gap-2 pt-4 border-t">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <div className="flex gap-2">
                  {selectedTemplateId && (
                    <Button variant="outline" onClick={() => setSelectedTemplateId('')}>
                      Skip Template
                    </Button>
                  )}
                  <Button onClick={handleCreateEstimate} className="gradient-primary">
                    {selectedTemplateId ? 'Continue with Template' : 'Continue without Template'}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lead Creation Dialog */}
      <EnhancedLeadCreationDialog
        open={showLeadCreation}
        onOpenChange={setShowLeadCreation}
        onLeadCreated={handleLeadCreated}
      />
    </>
  );
};
