import React, { useState, useEffect } from 'react';
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
  ChevronRight, X, Camera, Image as ImageIcon, Edit2, Plus, MessageSquare
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SatelliteMeasurement from '@/components/SatelliteMeasurement';
import EstimateHyperlinkBar from '@/components/estimates/EstimateHyperlinkBar';
import ProfitSlider from '@/components/estimates/ProfitSlider';
import CommunicationHub from '@/components/communication/CommunicationHub';
import MeasurementGating from '@/components/estimates/MeasurementGating';
import { EnhancedEstimateBuilder } from '@/components/EnhancedEstimateBuilder';
import { ApprovalRequirementsBubbles } from '@/components/ApprovalRequirementsBubbles';
import { MultiTemplateSelector } from '@/components/estimates/MultiTemplateSelector';
import { DocumentsTab } from '@/components/DocumentsTab';
import { PhoneNumberSelector } from '@/components/communication/PhoneNumberSelector';
import { useLatestMeasurement } from '@/hooks/useMeasurement';
import { LinearFeaturesPanel } from '@/components/measurements/LinearFeaturesPanel';
import { CallStatusMonitor } from '@/components/communication/CallStatusMonitor';
import { CallDispositionDialog } from '@/components/communication/CallDispositionDialog';
import { SMSComposerDialog } from '@/components/communication/SMSComposerDialog';
import { FloatingEmailComposer } from '@/components/messaging/FloatingEmailComposer';
import { BackButton } from '@/shared/components/BackButton';
import { useSendSMS } from '@/hooks/useSendSMS';

interface LeadDetailsData {
  id: string;
  status: string;
  roof_type?: string;
  priority: string;
  estimated_value?: number;
  notes?: string;
  metadata?: any;
  verified_address?: {
    formatted_address: string;
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  };
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    latitude?: number;
    longitude?: number;
    verified_address?: {
      lat: number;
      lng: number;
      formatted_address?: string;
      [key: string]: any;
    };
  };
  assigned_rep?: {
    id: string;
    first_name: string;
    last_name: string;
  };
  created_at: string;
  updated_at: string;
}

interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

const LeadDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [lead, setLead] = useState<LeadDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [productionStage, setProductionStage] = useState<string | null>(null);
  const [estimateCalculations, setEstimateCalculations] = useState<any>(null);
  const [measurementReadiness, setMeasurementReadiness] = useState({ isReady: false, data: null });
  const [requirements, setRequirements] = useState<ApprovalRequirements>({
    hasContract: false,
    hasEstimate: false,
    hasMaterials: false,
    hasLabor: false,
    allComplete: false
  });
  const [photos, setPhotos] = useState<any[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showFullScreenPhoto, setShowFullScreenPhoto] = useState(false);
  
  // Fetch measurement data
  const { data: measurementData, isLoading: measurementLoading, refetch: refetchMeasurements } = useLatestMeasurement(id);
  
  // Call states
  const [showCallDialog, setShowCallDialog] = useState(false);
  const [activeCall, setActiveCall] = useState<any>(null);
  const [showDispositionDialog, setShowDispositionDialog] = useState(false);
  const [availablePhoneNumbers, setAvailablePhoneNumbers] = useState<any[]>([]);
  const [availableSalesReps, setAvailableSalesReps] = useState<any[]>([]);
  const [isEditingSalesRep, setIsEditingSalesRep] = useState(false);
  
  // Communication states
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  
  // SMS sending hook
  const { sendSMS } = useSendSMS();

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

  useEffect(() => {
    if (id) {
      fetchLeadDetails();
      checkApprovalRequirements();
      fetchPhotos();
      fetchProductionStage();
      loadSalesReps();
    }
  }, [id]);

  const loadSalesReps = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('role', ['sales_manager', 'regional_manager', 'corporate'])
        .eq('is_active', true)
        .order('first_name');
      
      if (error) throw error;
      setAvailableSalesReps(data || []);
    } catch (error) {
      console.error('Error loading sales reps:', error);
    }
  };

  const handleSalesRepUpdate = async (repId: string) => {
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ assigned_to: repId || null })
        .eq('id', id);
      
      if (error) throw error;
      
      toast({ title: "Sales rep updated successfully" });
      fetchLeadDetails();
      setIsEditingSalesRep(false);
    } catch (error) {
      console.error('Error updating sales rep:', error);
      toast({ 
        title: "Error updating sales rep", 
        variant: "destructive" 
      });
    }
  };

  const fetchProductionStage = async () => {
    try {
      // First check if there's a project for this pipeline entry
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', id)
        .maybeSingle();

      if (!project) return;

      // Fetch production workflow for this project
      const { data: workflow } = await supabase
        .from('production_workflows')
        .select('current_stage')
        .eq('project_id', project.id)
        .maybeSingle();

      if (workflow) {
        setProductionStage(workflow.current_stage);
      }
    } catch (error) {
      console.error('Error fetching production stage:', error);
    }
  };

  const fetchLeadDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
          contact:contacts(*),
          assigned_rep:profiles!pipeline_entries_assigned_to_fkey(id, first_name, last_name)
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        // Extract verified address from metadata
        const metadata = data.metadata as any;
        const leadData = {
          ...data,
          verified_address: metadata?.verified_address || null
        };
        setLead(leadData as any);
      }
    } catch (error) {
      console.error('Error fetching lead details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load lead details',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPhotos = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('pipeline_entry_id', id)
        .eq('document_type', 'inspection_photo')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPhotos(data || []);
    } catch (error) {
      console.error('Error fetching photos:', error);
    }
  };

  const checkApprovalRequirements = async () => {
    try {
      // Check for contract
      const { data: contracts } = await supabase
        .from('documents')
        .select('id')
        .eq('pipeline_entry_id', id)
        .eq('document_type', 'contract')
        .limit(1);

      // Check for enhanced estimates
      const { data: estimateData } = await supabase
        .from('enhanced_estimates')
        .select('id, selling_price, material_cost, labor_cost')
        .eq('pipeline_entry_id', id)
        .order('created_at', { ascending: false })
        .limit(1);

      // Check if a selected estimate exists in metadata
      const { data: pipelineEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', id)
        .maybeSingle();

      const metadata = pipelineEntry?.metadata as Record<string, any> | null;
      const selectedEstimateId = metadata?.selected_estimate_id || estimateData?.[0]?.id;

      // Check for materials and labor if estimate is selected
      let materials: any[] = [];
      let labor: any[] = [];
      
      if (selectedEstimateId) {
        const { data: materialData } = await supabase
          .from('estimate_line_items')
          .select('id')
          .eq('estimate_id', selectedEstimateId)
          .eq('item_category', 'material')
          .limit(1);
          
        const { data: laborData } = await supabase
          .from('estimate_line_items')
          .select('id')
          .eq('estimate_id', selectedEstimateId)
          .eq('item_category', 'labor')
          .limit(1);
          
        materials = materialData || [];
        labor = laborData || [];
      }

      const hasContract = (contracts?.length || 0) > 0;
      const hasEstimate = !!selectedEstimateId;
      const hasMaterials = (materials?.length || 0) > 0;
      const hasLabor = (labor?.length || 0) > 0;
      const allComplete = hasContract && hasEstimate && hasMaterials && hasLabor;

      setRequirements({
        hasContract,
        hasEstimate,
        hasMaterials,
        hasLabor,
        allComplete
      });
    } catch (error) {
      console.error('Error checking approval requirements:', error);
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
            onUploadComplete={checkApprovalRequirements}
          />
        );
      case 'estimate':
        return (
          <MultiTemplateSelector
            pipelineEntryId={id!}
            onCalculationsUpdate={(calculations) => {
              console.log('Template calculations updated:', calculations);
              checkApprovalRequirements();
            }}
          />
        );
      case 'measurements':
        return (
          <div className="space-y-6">
            <MeasurementGating
              pipelineEntryId={id!}
              onReadinessChange={handleReadinessChange}
            />
            
            {measurementData?.tags && (
              <LinearFeaturesPanel 
                tags={measurementData.tags}
                loading={measurementLoading}
              />
            )}
            
            <SatelliteMeasurement
              address={lead?.verified_address?.formatted_address || `${lead?.contact?.address_street}, ${lead?.contact?.address_city}, ${lead?.contact?.address_state}`}
              latitude={(lead?.contact?.verified_address as any)?.lat || lead?.contact?.latitude || lead?.verified_address?.geometry?.location?.lat}
              longitude={(lead?.contact?.verified_address as any)?.lng || lead?.contact?.longitude || lead?.verified_address?.geometry?.location?.lng}
              pipelineEntryId={id!}
              measurementTags={measurementData?.tags}
              onMeasurementsSaved={(measurements) => {
                toast({
                  title: "Measurements Saved",
                  description: `Property measurements saved successfully. Area: ${measurements.adjustedArea} sq ft`,
                });
                checkApprovalRequirements();
                refetchMeasurements();
              }}
            />
          </div>
        );
      case 'materials':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Material Specifications</CardTitle>
            </CardHeader>
            <CardContent>
              {measurementReadiness.isReady ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 text-primary mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Material calculations ready</p>
                  <p className="text-sm text-success">Based on {measurementReadiness.data?.roof_area_sq_ft} sq ft roof area</p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Complete measurements and template binding first</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case 'labor':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Labor Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {measurementReadiness.isReady ? (
                <div className="text-center py-12">
                  <Hammer className="h-12 w-12 text-primary mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Labor calculations ready</p>
                  <p className="text-sm text-success">
                    {((measurementReadiness.data?.roof_area_sq_ft || 0) / 100).toFixed(1)} squares of roofing work
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Hammer className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Complete measurements and template binding first</p>
                </div>
              )}
            </CardContent>
          </Card>
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
        return (
          <div className="space-y-6">
            <ProfitSlider
              value={30}
              onChange={(value) => console.log('Profit margin changed:', value)}
              estimateId={id}
              disabled={!measurementReadiness.isReady}
              sellingPrice={measurementReadiness.isReady ? 34000 : 0}
              costPreProfit={measurementReadiness.isReady ? 23800 : 0}
            />
          </div>
        );
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
          <EnhancedEstimateBuilder
            pipelineEntryId={id}
            contactId={lead?.contact?.id}
            onEstimateCreated={(estimate) => {
              checkApprovalRequirements();
              toast({
                title: 'Estimate Created',
                description: 'Excel-style estimate created successfully',
              });
            }}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading lead details...</span>
        </div>
      </div>
    );
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
    <div className="max-w-7xl mx-auto space-y-6">
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
                <div>
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Lead Property</span>
                  <p className="text-foreground font-medium">
                    {lead.verified_address?.formatted_address || 
                     `${lead.contact?.address_street}, ${lead.contact?.address_city}, ${lead.contact?.address_state} ${lead.contact?.address_zip}`}
                  </p>
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
            onApprove={handleApproveToProject}
            pipelineEntryId={id}
            onUploadComplete={checkApprovalRequirements}
          />
        </CardContent>
      </Card>

      {/* Communication Hub & Photos - Tabbed Interface */}
      <Card>
        <Tabs defaultValue="communication" className="w-full">
          <CardHeader className="pb-3">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="communication">Communication Hub</TabsTrigger>
              <TabsTrigger value="photos" className="flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Photos
                {photos.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {photos.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent>
            <TabsContent value="communication" className="mt-0">
              <div className="space-y-3">
                <CommunicationHub 
                  contactId={lead.contact?.id}
                  contactName={lead.contact ? `${lead.contact.first_name} ${lead.contact.last_name}` : undefined}
                  contactEmail={lead.contact?.email}
                  contactPhone={lead.contact?.phone}
                  assignedRep={lead.assigned_rep || undefined}
                  onCallClick={() => setShowCallDialog(true)}
                  onEmailClick={() => setShowEmailComposer(true)}
                  onSMSClick={() => setShowSMSDialog(true)}
                />
                
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => {
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
                  >
                    <Phone className="h-3 w-3 mr-1" />
                    Call
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => {
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
                  >
                    <Mail className="h-3 w-3 mr-1" />
                    Email
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => {
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
                  >
                    <MessageSquare className="h-3 w-3 mr-1" />
                    SMS
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="photos" className="mt-0">
              {photos.length > 0 ? (
                <div className="space-y-4">
                  {/* Photo Display */}
                  <div 
                    className="relative aspect-video bg-muted rounded-lg flex items-center justify-center cursor-pointer overflow-hidden group"
                    onClick={() => setShowFullScreenPhoto(true)}
                  >
                    <ImageIcon className="h-16 w-16 text-muted-foreground" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="text-sm text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to expand
                      </span>
                    </div>
                  </div>

                  {/* Navigation Controls */}
                  <div className="flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPhotoIndex(Math.max(0, currentPhotoIndex - 1))}
                      disabled={currentPhotoIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {currentPhotoIndex + 1} of {photos.length} - {photos[currentPhotoIndex]?.filename || 'Photo'}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPhotoIndex(Math.min(photos.length - 1, currentPhotoIndex + 1))}
                      disabled={currentPhotoIndex === photos.length - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center text-center p-6">
                  <Camera className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No photos uploaded yet</p>
                </div>
              )}
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
      <div className="space-y-6">{renderActiveSection()}</div>

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
        />
      )}

      {/* SMS Composer Dialog */}
      {lead?.contact && (
        <SMSComposerDialog
          open={showSMSDialog}
          onOpenChange={setShowSMSDialog}
          phoneNumber={lead.contact.phone || ''}
          contactName={`${lead.contact.first_name} ${lead.contact.last_name}`}
          onSend={async (message) => {
            console.log('🔵 LeadDetails: SMS onSend triggered', {
              message,
              phone: lead.contact.phone,
              contactId: lead.contact.id,
              contactName: `${lead.contact.first_name} ${lead.contact.last_name}`
            });
            
            try {
              await sendSMS({
                to: lead.contact.phone || '',
                message,
                contactId: lead.contact.id
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