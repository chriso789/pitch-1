import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { 
  Loader2, ArrowLeft, MapPin, User, Phone, Mail, 
  FileText, CheckCircle, AlertCircle, ExternalLink,
  DollarSign, Hammer, Package, Settings, ChevronLeft,
  ChevronRight, X, Camera, Image as ImageIcon, Edit2, Plus, MessageSquare,
  Pencil, Crosshair, Ruler, Calculator, Lock
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import EstimateHyperlinkBar from '@/components/estimates/EstimateHyperlinkBar';
import RepProfitBreakdown from '@/components/estimates/RepProfitBreakdown';
import { CompactCommunicationHub, ActivityItem } from '@/components/communication/CompactCommunicationHub';
import MeasurementGating from '@/components/estimates/MeasurementGating';
import { EnhancedEstimateBuilder } from '@/components/EnhancedEstimateBuilder';
import { ApprovalRequirementsBubbles } from '@/components/ApprovalRequirementsBubbles';
import { MultiTemplateSelector } from '@/components/estimates/MultiTemplateSelector';
import { DocumentsTab } from '@/components/DocumentsTab';
import { PhoneNumberSelector } from '@/components/communication/PhoneNumberSelector';
import { useLatestMeasurement } from '@/hooks/useMeasurement';
import { LinearFeaturesPanel } from '@/components/measurements/LinearFeaturesPanel';
import { PullMeasurementsButton } from '@/components/measurements/PullMeasurementsButton';
import { ApprovedMeasurementsList } from '@/components/measurements/ApprovedMeasurementsList';
import { CallStatusMonitor } from '@/components/communication/CallStatusMonitor';
import { CallDispositionDialog } from '@/components/communication/CallDispositionDialog';
import { SMSComposerDialog } from '@/components/communication/SMSComposerDialog';
import { FloatingEmailComposer } from '@/components/messaging/FloatingEmailComposer';
import { BackButton } from '@/shared/components/BackButton';
import { useSendSMS } from '@/hooks/useSendSMS';
import { useLeadDetails, LeadDetailsData, ApprovalRequirements } from '@/hooks/useLeadDetails';
import { LeadDetailsSkeleton } from '@/components/lead-details/LeadDetailsSkeleton';
import { AddressReverificationButton } from '@/components/measurements/AddressReverificationButton';
import { ProductTemplateApplicator } from '@/components/estimates/ProductTemplateApplicator';
import { SavedEstimatesList } from '@/components/estimates/SavedEstimatesList';
import { LeadPhotoUploader } from '@/components/photos/LeadPhotoUploader';
import { LeadActivityTimeline } from '@/components/lead-details/LeadActivityTimeline';
import { TemplateSectionSelector } from '@/components/estimates/TemplateSectionSelector';
import { useQuery as useTanstackQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

// Materials Section with locking
const MaterialsSection = ({ pipelineEntryId }: { pipelineEntryId: string }) => {
  const queryClient = useQueryClient();
  
  const { data: lockStatus } = useTanstackQuery({
    queryKey: ['cost-lock-status', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          material_cost_locked_at,
          material_cost_locked_by,
          labor_cost_locked_at,
          labor_cost_locked_by,
          material_locked_by_profile:profiles!enhanced_estimates_material_cost_locked_by_fkey(full_name),
          labor_locked_by_profile:profiles!enhanced_estimates_labor_cost_locked_by_fkey(full_name)
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  const isLocked = !!lockStatus?.material_cost_locked_at;
  const lockedAt = lockStatus?.material_cost_locked_at;
  const lockedByName = (lockStatus?.material_locked_by_profile as any)?.full_name;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Material Specifications</span>
          {isLocked ? (
            <Badge className="bg-green-600 text-white">
              <CheckCircle className="h-3 w-3 mr-1" /> Locked
            </Badge>
          ) : (
            <Badge variant="outline">Template-Based</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TemplateSectionSelector
          pipelineEntryId={pipelineEntryId}
          sectionType="material"
          isLocked={isLocked}
          lockedAt={lockedAt}
          lockedByName={lockedByName}
          onTotalChange={(total) => {
            console.log('Materials total updated:', total);
          }}
          onLockSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
          }}
        />
      </CardContent>
    </Card>
  );
};

// Labor Section with locking
const LaborSection = ({ pipelineEntryId }: { pipelineEntryId: string }) => {
  const queryClient = useQueryClient();
  
  const { data: lockStatus } = useTanstackQuery({
    queryKey: ['cost-lock-status', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          material_cost_locked_at,
          material_cost_locked_by,
          labor_cost_locked_at,
          labor_cost_locked_by,
          material_locked_by_profile:profiles!enhanced_estimates_material_cost_locked_by_fkey(full_name),
          labor_locked_by_profile:profiles!enhanced_estimates_labor_cost_locked_by_fkey(full_name)
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  const isLocked = !!lockStatus?.labor_cost_locked_at;
  const lockedAt = lockStatus?.labor_cost_locked_at;
  const lockedByName = (lockStatus?.labor_locked_by_profile as any)?.full_name;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Labor Breakdown</span>
          {isLocked ? (
            <Badge className="bg-green-600 text-white">
              <CheckCircle className="h-3 w-3 mr-1" /> Locked
            </Badge>
          ) : (
            <Badge variant="outline">Template-Based</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TemplateSectionSelector
          pipelineEntryId={pipelineEntryId}
          sectionType="labor"
          isLocked={isLocked}
          lockedAt={lockedAt}
          lockedByName={lockedByName}
          onTotalChange={(total) => {
            console.log('Labor total updated:', total);
          }}
          onLockSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
          }}
        />
      </CardContent>
    </Card>
  );
};

// Profit Section with rep commission breakdown
const ProfitSection = ({ pipelineEntryId }: { pipelineEntryId: string }) => {
  // Fetch estimate data for costs and selling price
  const { data: estimateData } = useTanstackQuery({
    queryKey: ['estimate-costs', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId });
      if (error) throw error;
      return data as { materials: number; labor: number; sale_price: number } | null;
    }
  });

  const sellingPrice = estimateData?.sale_price || 0;
  const materialCost = estimateData?.materials || 0;
  const laborCost = estimateData?.labor || 0;

  return (
    <RepProfitBreakdown
      pipelineEntryId={pipelineEntryId}
      sellingPrice={sellingPrice}
      materialCost={materialCost}
      laborCost={laborCost}
    />
  );
};

const LeadDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'estimate');
  const [estimateCalculations, setEstimateCalculations] = useState<any>(null);
  const [measurementReadiness, setMeasurementReadiness] = useState({ isReady: false, data: null });
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showFullScreenPhoto, setShowFullScreenPhoto] = useState(false);
  const estimateSectionRef = useRef<HTMLDivElement>(null);
  
  // Use optimized hook with parallel queries and caching
  const { 
    lead, 
    requirements, 
    dynamicRequirements,
    photos, 
    productionStage, 
    salesReps: availableSalesReps,
    isLoading: loading,
    refetchRequirements,
    refetchPhotos,
    refetchLead
  } = useLeadDetails(id);
  
  // Fetch measurement data
  const { data: measurementData, isLoading: measurementLoading, refetch: refetchMeasurements } = useLatestMeasurement(id);
  
  // Call states
  const [showCallDialog, setShowCallDialog] = useState(false);
  const [activeCall, setActiveCall] = useState<any>(null);
  const [showDispositionDialog, setShowDispositionDialog] = useState(false);
  const [availablePhoneNumbers, setAvailablePhoneNumbers] = useState<any[]>([]);
  const [isEditingSalesRep, setIsEditingSalesRep] = useState(false);
  
  // Communication states
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  
  // SMS sending hook
  const { sendSMS } = useSendSMS();

  // Handle sending email via edge function
  const handleSendEmail = async (emailData: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
  }) => {
    try {
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          to: emailData.to,
          cc: emailData.cc,
          bcc: emailData.bcc,
          subject: emailData.subject,
          body: emailData.body,
          contactId: lead?.contact?.id
        }
      });
      
      if (error) throw error;
      
      toast({
        title: "Email Sent",
        description: "Your email was sent successfully"
      });
      
      setShowEmailComposer(false);
    } catch (error) {
      console.error('Error sending email:', error);
      toast({
        title: "Error",
        description: "Failed to send email. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Define callback at component top level (not inside render function)
  const handleReadinessChange = React.useCallback((isReady: boolean, data: any) => {
    setMeasurementReadiness({ isReady, data });
  }, []);

  // Handle URL tab parameter changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleSalesRepUpdate = async (repId: string) => {
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ assigned_to: repId || null })
        .eq('id', id);
      
      if (error) throw error;
      
      toast({ title: "Sales rep updated successfully" });
      refetchLead();
      setIsEditingSalesRep(false);
    } catch (error) {
      console.error('Error updating sales rep:', error);
      toast({ 
        title: "Error updating sales rep", 
        variant: "destructive" 
      });
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      'lead': 'bg-status-lead text-white',
      'legal': 'bg-warning text-warning-foreground',
      'contingency_signed': 'bg-status-estimate text-white',
      'project': 'bg-status-project text-white'
    };
    return colors[status as keyof typeof colors] || 'bg-muted';
  };

  const getProgressPercentage = () => {
    const completed = Object.values(requirements).filter(Boolean).length - 1; // Exclude allComplete
    return (completed / 4) * 100;
  };

  const handleApproveToProject = async () => {
    if (!requirements.allComplete) {
      toast({
        title: 'Requirements Not Met',
        description: 'Please complete all requirements before approving this lead.',
        variant: 'destructive'
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ status: 'project' })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Lead Approved!',
        description: 'This lead has been approved and converted to a project.',
      });

      // Navigate to the new project details
      navigate(`/job/${id}`);
    } catch (error) {
      console.error('Error approving lead:', error);
      toast({
        title: 'Error',
        description: 'Failed to approve lead',
        variant: 'destructive'
      });
    }
  };

  const renderActiveSection = () => {
    switch (activeTab) {
      case 'documents':
        return (
          <DocumentsTab 
            pipelineEntryId={id!}
            onUploadComplete={refetchRequirements}
          />
        );
      case 'estimate':
        return (
          <div className="space-y-6">
            {/* Saved Estimates List */}
            <SavedEstimatesList pipelineEntryId={id!} />

            {/* Measurement Tools Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ruler className="h-5 w-5" />
                  Roof Measurements
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choose how to measure the roof - manually draw or use AI automation
                </p>
              </CardHeader>
              <CardContent>
                <PullMeasurementsButton 
                  propertyId={id!}
                  lat={lead?.contact?.verified_address?.lat || lead?.contact?.latitude || 0}
                  lng={lead?.contact?.verified_address?.lng || lead?.contact?.longitude || 0}
                  address={lead?.verified_address?.formatted_address || ''}
                  onSuccess={() => {
                    refetchMeasurements();
                    refetchRequirements();
                  }}
                />
                
                {/* Show approved measurements if any */}
                <div className="mt-4">
                  <ApprovedMeasurementsList pipelineEntryId={id!} />
                </div>
              </CardContent>
            </Card>

            {/* Existing Template Selector */}
            <MultiTemplateSelector
              pipelineEntryId={id!}
              onCalculationsUpdate={(calculations) => {
                console.log('Template calculations updated:', calculations);
                refetchRequirements();
              }}
            />
          </div>
        );
      case 'materials':
        return (
          <MaterialsSection pipelineEntryId={id!} />
        );
      case 'labor':
        return (
          <LaborSection pipelineEntryId={id!} />
        );
      case 'overhead':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Overhead & Administrative</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">Overhead calculated as percentage of selling price</p>
                <p className="text-sm text-muted-foreground">Includes: Insurance, Office, Admin, Equipment</p>
              </div>
            </CardContent>
          </Card>
        );
      case 'profit':
        return <ProfitSection pipelineEntryId={id!} />;
      case 'total':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Final Selling Price</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 text-primary mx-auto mb-4" />
                <div className="text-3xl font-bold text-primary mb-2">
                  {measurementReadiness.isReady ? '$34,000' : '$0'}
                </div>
                <p className="text-muted-foreground mb-4">
                  {measurementReadiness.isReady ? 'With guaranteed 30% margin' : 'Pending calculations'}
                </p>
                {measurementReadiness.isReady && (
                  <p className="text-sm text-success">
                    ${((measurementReadiness.data?.roof_area_sq_ft || 0) > 0 ? (34000 / measurementReadiness.data.roof_area_sq_ft).toFixed(2) : '0')} per sq ft
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      default:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Lead Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  Select "Estimate" above to take measurements and create proposals.
                </p>
                <Button onClick={() => setActiveTab('estimate')} variant="default">
                  Get Started with Measurements
                </Button>
              </div>
            </CardContent>
          </Card>
        );
    }
  };

  if (loading) {
    return <LeadDetailsSkeleton />;
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <h2 className="text-2xl font-bold">Lead not found</h2>
        <Button onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-3 md:p-6 pb-20 md:pb-6">
      {/* Header with Contact Card */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4 flex-1">
          <BackButton 
            fallbackPath="/pipeline"
            label="Back"
            respectHistory={true}
          />
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold">
                {lead.contact ? `${lead.contact.first_name} ${lead.contact.last_name}` : 'Lead'}
              </h1>
              <Badge className={getStatusColor(lead.status)}>
                {lead.status.replace('_', ' ')}
              </Badge>
              {lead.status === 'project' && productionStage && (
                <Badge variant="outline" className="border-primary text-primary">
                  Production: {productionStage.replace('_', ' ')}
                </Badge>
              )}
            </div>
            
            {/* Lead Property Address */}
            {(lead.verified_address?.formatted_address || lead.contact?.address_street) && (
              <div className="flex items-start gap-2 mt-3 text-sm">
                <MapPin className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Lead Property</span>
                  <div className="flex items-center gap-2">
                    <p className="text-foreground font-medium">
                      {lead.verified_address?.formatted_address || 
                       `${lead.contact?.address_street}, ${lead.contact?.address_city}, ${lead.contact?.address_state} ${lead.contact?.address_zip}`}
                    </p>
                    {lead.contact?.id && (
                      <AddressReverificationButton
                        contactId={lead.contact.id}
                        currentAddress={
                          lead.verified_address?.formatted_address || 
                          `${lead.contact?.address_street || ''}, ${lead.contact?.address_city || ''}, ${lead.contact?.address_state || ''} ${lead.contact?.address_zip || ''}`.trim()
                        }
                        onReverified={(newCoords) => {
                          toast({
                            title: "Coordinates Updated",
                            description: "The property location has been re-verified. Measurements will now use the correct location.",
                          });
                          refetchLead();
                        }}
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Contact Information */}
            {lead.contact && (lead.contact.phone || lead.contact.email) && (
              <div className="flex items-center gap-4 mt-2 text-sm">
                {lead.contact.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <a href={`tel:${lead.contact.phone}`} className="text-foreground hover:text-primary transition-colors">
                      {lead.contact.phone}
                    </a>
                  </div>
                )}
                {lead.contact.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <a href={`mailto:${lead.contact.email}`} className="text-foreground hover:text-primary transition-colors">
                      {lead.contact.email}
                    </a>
                  </div>
                )}
              </div>
            )}
            
            {/* Lead Information directly under name */}
            <div className="flex items-center gap-4 text-sm mt-2">
              {lead.priority && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Priority:</span>
                  <span className="capitalize font-medium">{lead.priority}</span>
                </div>
              )}
              {lead.roof_type && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Roof:</span>
                  <span className="capitalize font-medium">{lead.roof_type.replace('_', ' ')}</span>
                </div>
              )}
              {lead.metadata?.roof_age_years && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Roof Age:</span>
                  <span className="font-medium">{lead.metadata.roof_age_years} years</span>
                </div>
              )}
              {lead.estimated_value && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Est. Value:</span>
                  <span className="font-medium">${lead.estimated_value.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Sales Rep */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-muted-foreground text-sm">Sales Rep:</span>
              {isEditingSalesRep ? (
                <Select 
                  value={lead.assigned_rep?.id || ''} 
                  onValueChange={(value) => handleSalesRepUpdate(value)}
                >
                  <SelectTrigger className="h-7 w-[200px]">
                    <SelectValue placeholder="Select rep" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSalesReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.first_name} {rep.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : lead.assigned_rep ? (
                <div className="flex items-center gap-1">
                  <span className="font-medium text-sm">
                    {lead.assigned_rep.first_name} {lead.assigned_rep.last_name}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-5 w-5 p-0"
                    onClick={() => setIsEditingSalesRep(true)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-6"
                  onClick={() => setIsEditingSalesRep(true)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Assign
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Contact Card */}
        {lead.contact && (
          <Card className="w-80 shadow-soft border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Contact</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => navigate(`/contact/${lead.contact?.id}`)}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-2">
                <p className="font-semibold">
                  {lead.contact.first_name} {lead.contact.last_name}
                </p>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {lead.contact.phone && (
                    <div className="flex items-center space-x-2">
                      <Phone className="h-3 w-3" />
                      <span>{lead.contact.phone}</span>
                    </div>
                  )}
                  {lead.contact.email && (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-3 w-3" />
                      <span>{lead.contact.email}</span>
                    </div>
                  )}
                  {lead.contact.address_street && (
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-3 w-3" />
                      <span className="text-xs">
                        {lead.contact.address_street}, {lead.contact.address_city}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Approval Requirements Progress */}
      <Card className="border-primary/20">
        <CardHeader className="p-4">
          <CardTitle className="flex items-center space-x-2 text-base">
            <CheckCircle className="h-4 w-4 text-primary" />
            <span>Approval Requirements</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ApprovalRequirementsBubbles 
            requirements={requirements}
            dynamicRequirements={dynamicRequirements}
            onApprove={handleApproveToProject}
            pipelineEntryId={id}
            onUploadComplete={refetchRequirements}
          />
        </CardContent>
      </Card>

      {/* Communication, Photos & Activity - Compact Tabs */}
      <Card className="border-muted">
        <Tabs defaultValue="comms" className="w-full">
          <CardHeader className="pb-2 pt-3">
            <TabsList className="h-8">
              <TabsTrigger value="comms" className="text-xs h-7 px-3">
                <MessageSquare className="h-3 w-3 mr-1" />
                Comms
              </TabsTrigger>
              <TabsTrigger value="photos" className="text-xs h-7 px-3">
                <Camera className="h-3 w-3 mr-1" />
                Photos
                {photos.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">
                    {photos.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-xs h-7 px-3">
                <FileText className="h-3 w-3 mr-1" />
                Activity
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-0 pb-3">
            <TabsContent value="comms" className="mt-0">
              <CompactCommunicationHub 
                contactId={lead.contact?.id}
                contactPhone={lead.contact?.phone}
                contactEmail={lead.contact?.email}
                onCallClick={() => {
                  if (lead?.contact?.phone) {
                    setAvailablePhoneNumbers([
                      { label: 'Primary Phone', number: lead.contact.phone }
                    ]);
                    setShowCallDialog(true);
                  } else {
                    toast({
                      title: "No phone number",
                      description: "This contact doesn't have a phone number on file.",
                      variant: "destructive"
                    });
                  }
                }}
                onEmailClick={() => {
                  if (lead?.contact?.email) {
                    setShowEmailComposer(true);
                  } else {
                    toast({
                      title: "No email address",
                      description: "This contact doesn't have an email address on file.",
                      variant: "destructive"
                    });
                  }
                }}
                onSMSClick={() => {
                  if (lead?.contact?.phone) {
                    setShowSMSDialog(true);
                  } else {
                    toast({
                      title: "No phone number",
                      description: "This contact doesn't have a phone number on file.",
                      variant: "destructive"
                    });
                  }
                }}
              />
            </TabsContent>

            <TabsContent value="photos" className="mt-0 space-y-4">
              {/* Photo Uploader */}
              <LeadPhotoUploader 
                pipelineEntryId={id!} 
                onUploadComplete={refetchPhotos}
              />
              
              {/* Existing Photos */}
              {photos.length > 0 && (
                <div className="space-y-3">
                  <div 
                    className="relative aspect-video bg-muted rounded-lg flex items-center justify-center cursor-pointer overflow-hidden group max-h-32"
                    onClick={() => setShowFullScreenPhoto(true)}
                  >
                    <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to expand
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setCurrentPhotoIndex(Math.max(0, currentPhotoIndex - 1))}
                      disabled={currentPhotoIndex === 0}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {currentPhotoIndex + 1}/{photos.length}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setCurrentPhotoIndex(Math.min(photos.length - 1, currentPhotoIndex + 1))}
                      disabled={currentPhotoIndex === photos.length - 1}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <LeadActivityTimeline 
                pipelineEntryId={id!}
                contactId={lead.contact?.id}
              />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Hyperlink Bar Estimate System */}
      <EstimateHyperlinkBar
        activeSection={activeTab}
        onSectionChange={setActiveTab}
        pipelineEntryId={id}
        calculations={{
          measurements: lead.metadata?.roof_area_sq_ft ? {
            roof_area_sq_ft: lead.metadata.roof_area_sq_ft,
            squares: lead.metadata.roof_area_sq_ft / 100,
            has_template: !!lead.metadata?.template_binding
          } : undefined,
          materials_cost: requirements.hasMaterials ? 15000 : 0,
          labor_cost: requirements.hasLabor ? 8000 : 0,
          overhead_amount: requirements.hasEstimate ? 3500 : 0,
          profit_amount: requirements.hasEstimate ? 7500 : 0,
          selling_price: requirements.hasEstimate ? 34000 : 0,
          is_ready: requirements.allComplete,
          margin_percent: 30
        }}
      />

      {/* Dynamic Content Sections */}
      <div ref={estimateSectionRef} className="space-y-6">{renderActiveSection()}</div>

      {/* Quick Create Estimate FAB */}
      {activeTab !== 'estimate' && (
        <Button
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
          size="icon"
          onClick={() => {
            setActiveTab('estimate');
            setTimeout(() => {
              estimateSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }}
        >
          <Calculator className="h-6 w-6" />
        </Button>
      )}

      {/* Call Status Monitor */}
      {activeCall && (
        <div className="fixed bottom-4 right-4 w-96 z-50">
          <CallStatusMonitor
            callLog={activeCall}
            onCallEnded={() => {
              setShowDispositionDialog(true);
            }}
          />
        </div>
      )}

      {/* Phone Number Selector Dialog */}
      <PhoneNumberSelector
        open={showCallDialog}
        onOpenChange={setShowCallDialog}
        contactId={lead?.contact?.id || ''}
        contactName={`${lead?.contact?.first_name || ''} ${lead?.contact?.last_name || ''}`.trim()}
        phoneNumbers={availablePhoneNumbers}
        pipelineEntryId={id}
        onCallInitiated={(callLog) => {
          setActiveCall(callLog);
        }}
      />

      {/* Call Disposition Dialog */}
      {activeCall && (
        <CallDispositionDialog
          open={showDispositionDialog}
          onOpenChange={setShowDispositionDialog}
          callLog={activeCall}
          onSaved={() => {
            setActiveCall(null);
            setShowDispositionDialog(false);
          }}
        />
      )}

      {/* Email Composer */}
      {lead?.contact && (
        <FloatingEmailComposer
          isOpen={showEmailComposer}
          onClose={() => setShowEmailComposer(false)}
          defaultRecipient={{
            id: lead.contact.id,
            name: `${lead.contact.first_name} ${lead.contact.last_name}`,
            email: lead.contact.email || '',
            type: 'contact'
          }}
          onSendEmail={handleSendEmail}
        />
      )}

      {/* SMS Composer Dialog */}
      {lead?.contact && (
        <SMSComposerDialog
          open={showSMSDialog}
          onOpenChange={setShowSMSDialog}
          phoneNumbers={(() => {
            const options: { label: string; number: string }[] = [];
            if (lead.contact.phone) {
              options.push({ label: 'Primary', number: lead.contact.phone });
            }
            if ((lead.contact as any).secondary_phone) {
              options.push({ label: 'Secondary', number: (lead.contact as any).secondary_phone });
            }
            if ((lead.contact as any).additional_phones?.length) {
              (lead.contact as any).additional_phones.forEach((phone: string, i: number) => {
                if (phone) options.push({ label: `Additional ${i + 1}`, number: phone });
              });
            }
            return options;
          })()}
          contactName={`${lead.contact.first_name} ${lead.contact.last_name}`}
          onSend={async (message, selectedPhone) => {
            console.log('🔵 LeadDetails: SMS onSend triggered', {
              message,
              phone: selectedPhone,
              contactId: lead.contact.id,
              pipelineEntryId: id
            });
            
            try {
              await sendSMS({
                to: selectedPhone,
                message,
                contactId: lead.contact.id,
                jobId: id // Link to this lead
              });
              
              console.log('✅ LeadDetails: SMS sent successfully, closing dialog');
              setShowSMSDialog(false);
            } catch (error) {
              console.error('🔴 LeadDetails: Failed to send SMS:', error);
              // Dialog stays open on error so user can retry
            }
          }}
        />
      )}
    </div>
  );
};

export default LeadDetails;