import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, ArrowLeft, MapPin, User, Phone, Mail, 
  FileText, CheckCircle, AlertCircle, ExternalLink,
  DollarSign, Hammer, Package, Settings
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import SatelliteMeasurement from '@/components/SatelliteMeasurement';
import EstimateHyperlinkBar from '@/components/estimates/EstimateHyperlinkBar';
import ProfitSlider from '@/components/estimates/ProfitSlider';
import CommunicationHub from '@/components/communication/CommunicationHub';
import MeasurementGating from '@/components/estimates/MeasurementGating';
import { EnhancedEstimateBuilder } from '@/components/EnhancedEstimateBuilder';

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
  const [lead, setLead] = useState<LeadDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [estimateCalculations, setEstimateCalculations] = useState<any>(null);
  const [measurementReadiness, setMeasurementReadiness] = useState({ isReady: false, data: null });
  const [requirements, setRequirements] = useState<ApprovalRequirements>({
    hasContract: false,
    hasEstimate: false,
    hasMaterials: false,
    hasLabor: false,
    allComplete: false
  });

  useEffect(() => {
    if (id) {
      fetchLeadDetails();
      checkApprovalRequirements();
    }
  }, [id]);

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

  const checkApprovalRequirements = async () => {
    try {
      // Check for contract
      const { data: contracts, error: contractError } = await supabase
        .from('documents')
        .select('id')
        .eq('pipeline_entry_id', id)
        .eq('document_type', 'contract')
        .limit(1);

      // Check for estimate
      const { data: estimates, error: estimateError } = await supabase
        .from('enhanced_estimates')
        .select('id')
        .eq('pipeline_entry_id', id)
        .limit(1);

      // Check for materials and labor if estimate exists
      let materials: any[] = [];
      let labor: any[] = [];
      
      if (estimates && estimates.length > 0) {
        const { data: materialData } = await supabase
          .from('estimate_line_items')
          .select('id')
          .eq('estimate_id', estimates[0].id)
          .eq('item_category', 'material')
          .limit(1);
          
        const { data: laborData } = await supabase
          .from('estimate_line_items')
          .select('id')
          .eq('estimate_id', estimates[0].id)
          .eq('item_category', 'labor')
          .limit(1);
          
        materials = materialData || [];
        labor = laborData || [];
      }

      const hasContract = (contracts?.length || 0) > 0;
      const hasEstimate = (estimates?.length || 0) > 0;
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
      case 'overview':
        return (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Lead overview and communication hub displayed above</p>
          </div>
        );
      case 'measurements':
        return (
          <div className="space-y-6">
            <MeasurementGating
              pipelineEntryId={id!}
              onReadinessChange={React.useCallback((isReady, data) => 
                setMeasurementReadiness({ isReady, data })
              , [])}
            />
            <SatelliteMeasurement
              address={lead?.verified_address?.formatted_address || `${lead?.contact?.address_street}, ${lead?.contact?.address_city}, ${lead?.contact?.address_state}`}
              latitude={lead?.verified_address?.geometry?.location?.lat || lead?.contact?.latitude}
              longitude={lead?.verified_address?.geometry?.location?.lng || lead?.contact?.longitude}
              pipelineEntryId={id!}
              onMeasurementsSaved={(measurements) => {
                toast({
                  title: "Measurements Saved",
                  description: `Property measurements saved successfully. Area: ${measurements.adjustedArea} sq ft`,
                });
                checkApprovalRequirements();
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
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold">
                {lead.contact ? `${lead.contact.first_name} ${lead.contact.last_name}` : 'Lead'}
              </h1>
              <Badge className={getStatusColor(lead.status)}>
                {lead.status.replace('_', ' ')}
              </Badge>
            </div>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-1">
              {lead.roof_type && <span>Roof: {lead.roof_type.replace('_', ' ')}</span>}
              {lead.estimated_value && <span>Est. Value: ${lead.estimated_value.toLocaleString()}</span>}
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
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-primary" />
              <span>Approval Requirements</span>
            </CardTitle>
            {requirements.allComplete ? (
              <Button onClick={handleApproveToProject} className="gradient-primary">
                Approve to Project
              </Button>
            ) : (
              <Button disabled variant="outline">
                Complete Requirements to Approve
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Progress</span>
                <span className="text-sm text-muted-foreground">
                  {Object.values(requirements).filter(Boolean).length - 1} / 4 complete
                </span>
              </div>
              <Progress value={getProgressPercentage()} className="h-2" />
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center space-x-2">
                {requirements.hasContract ? 
                  <CheckCircle className="h-4 w-4 text-success" /> :
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                }
                <div className="flex items-center space-x-1">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm">Contract</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {requirements.hasEstimate ? 
                  <CheckCircle className="h-4 w-4 text-success" /> :
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                }
                <div className="flex items-center space-x-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-sm">Estimate</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {requirements.hasMaterials ? 
                  <CheckCircle className="h-4 w-4 text-success" /> :
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                }
                <div className="flex items-center space-x-1">
                  <Package className="h-4 w-4" />
                  <span className="text-sm">Materials</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {requirements.hasLabor ? 
                  <CheckCircle className="h-4 w-4 text-success" /> :
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                }
                <div className="flex items-center space-x-1">
                  <Hammer className="h-4 w-4" />
                  <span className="text-sm">Labor</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lead Information */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Priority</label>
              <p className="capitalize">{lead.priority}</p>
            </div>
            {lead.roof_type && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Roof Type</label>
                <p className="capitalize">{lead.roof_type.replace('_', ' ')}</p>
              </div>
            )}
            {lead.estimated_value && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Estimated Value</label>
                <p>${lead.estimated_value.toLocaleString()}</p>
              </div>
            )}
            {lead.notes && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Notes</label>
                <p className="text-muted-foreground">{lead.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Communication Hub</CardTitle>
          </CardHeader>
          <CardContent>
            {lead.assigned_rep ? (
              <div className="flex items-center space-x-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {lead.assigned_rep.first_name} {lead.assigned_rep.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">Sales Representative</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground mb-4">No representative assigned</p>
            )}
            
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="outline" className="flex items-center space-x-1">
                <Phone className="h-3 w-3" />
                <span>Call</span>
              </Button>
              <Button size="sm" variant="outline" className="flex items-center space-x-1">
                <Mail className="h-3 w-3" />
                <span>Email</span>
              </Button>
              <Button size="sm" variant="outline" className="flex items-center space-x-1">
                <Phone className="h-3 w-3" />
                <span>SMS</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
};

export default LeadDetails;