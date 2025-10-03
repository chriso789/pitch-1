import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { 
  Loader2, ArrowLeft, CheckCircle2, XCircle, AlertCircle, 
  FileText, DollarSign, TrendingUp, User, Phone, Mail, MapPin,
  FileCheck, Signature, Target
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface PipelineEntryData {
  id: string;
  status: string;
  roof_type?: string;
  estimated_value?: number;
  requires_manager_approval?: boolean;
  contact_id: string;
  contacts?: {
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
  };
}

interface EligibilityChecks {
  hasEstimate: boolean;
  hasDocuments: boolean;
  hasSignature: boolean;
  meetsMargin: boolean;
  hasApproval: boolean;
}

interface EstimateData {
  selling_price: number;
  material_cost: number;
  labor_cost: number;
  actual_margin_percent: number;
}

const PipelineEntryReview = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<PipelineEntryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [activeSection, setActiveSection] = useState('pipeline');
  const [eligibility, setEligibility] = useState<EligibilityChecks>({
    hasEstimate: false,
    hasDocuments: false,
    hasSignature: false,
    meetsMargin: false,
    hasApproval: false
  });
  const [estimate, setEstimate] = useState<EstimateData | null>(null);

  useEffect(() => {
    if (id) {
      fetchPipelineEntry();
    }
  }, [id]);

  const fetchPipelineEntry = async () => {
    try {
      const { data: entryData, error } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
          contacts (*)
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (entryData) {
        setEntry(entryData as any);
        await checkEligibility(entryData.id);
      }
    } catch (error) {
      console.error('Error fetching pipeline entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to load pipeline entry details',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const checkEligibility = async (entryId: string) => {
    try {
      // Check for estimates
      const { data: estimateData } = await supabase
        .from('estimates')
        .select('selling_price, material_cost, labor_cost, actual_margin_percent')
        .eq('pipeline_entry_id', entryId)
        .maybeSingle();

      const hasEstimate = !!estimateData;
      if (estimateData) {
        setEstimate(estimateData);
      }

      // Check for required documents
      const { data: documents } = await supabase
        .from('documents')
        .select('id')
        .eq('pipeline_entry_id', entryId);

      const hasDocuments = (documents?.length || 0) > 0;

      // Check for signatures
      // @ts-ignore - Supabase type inference issue
      const signaturesQuery = await supabase
        .from('digital_signatures')
        .select('id')
        .eq('pipeline_entry_id', entryId)
        .eq('is_signed', true);

      const hasSignature = (signaturesQuery.data?.length || 0) > 0;

      // Check profit margin (30% minimum recommended)
      const meetsMargin = estimateData ? estimateData.actual_margin_percent >= 20 : false;

      // Check manager approval
      const { data: approval } = await supabase
        .from('manager_approval_queue')
        .select('status')
        .eq('pipeline_entry_id', entryId)
        .eq('status', 'approved')
        .maybeSingle();

      const hasApproval = !!approval;

      setEligibility({
        hasEstimate,
        hasDocuments,
        hasSignature,
        meetsMargin,
        hasApproval
      });
    } catch (error) {
      console.error('Error checking eligibility:', error);
    }
  };

  const handleConvertToJob = async () => {
    if (!entry) return;

    setConverting(true);
    try {
      const { data, error } = await supabase.functions.invoke('api-approve-job-from-lead', {
        body: {
          pipelineEntryId: entry.id,
          jobDetails: {
            name: `${entry.contacts?.first_name || ''} ${entry.contacts?.last_name || ''} - ${entry.roof_type?.replace('_', ' ') || 'Roofing Project'}`.trim(),
            description: `Job created from ${entry.roof_type?.replace('_', ' ') || 'roofing'} project`,
            priority: 'medium',
            create_production_workflow: true
          }
        }
      });

      if (error) throw error;

      toast({
        title: 'Job Created Successfully',
        description: `Job ${data.project_clj_number} has been created and moved to production.`,
      });

      // Navigate to the new job details page
      navigate(`/job/${data.project_id}`);
    } catch (error: any) {
      console.error('Error converting to job:', error);
      toast({
        title: 'Conversion Failed',
        description: error.message || 'Failed to convert pipeline entry to job',
        variant: 'destructive'
      });
    } finally {
      setConverting(false);
    }
  };

  const isEligible = eligibility.hasEstimate && eligibility.meetsMargin;
  const allChecksPass = Object.values(eligibility).every(check => check);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading pipeline entry...</span>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <h2 className="text-2xl font-bold">Pipeline entry not found</h2>
        <Button onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go back
        </Button>
      </div>
    );
  }

  return (
    <GlobalLayout 
      activeSection={activeSection} 
      onSectionChange={setActiveSection}
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4 flex-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (entry?.contacts?.id) {
                  navigate(`/contact/${entry.contacts.id}`);
                } else {
                  navigate(-1);
                }
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Contact
            </Button>
            <div className="flex-1">
              <div className="flex items-center space-x-3">
                <h1 className="text-3xl font-bold">
                  {entry.roof_type?.replace('_', ' ') || 'Pipeline Entry Review'}
                </h1>
                <Badge variant="outline" className="capitalize">
                  {entry.status.replace('_', ' ')}
                </Badge>
              </div>
            </div>
          </div>

          {/* Contact Card */}
          {entry.contacts && (
            <Card className="w-80 shadow-soft border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <User className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Contact</span>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold">
                    {entry.contacts.first_name} {entry.contacts.last_name}
                  </p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {entry.contacts.phone && (
                      <div className="flex items-center space-x-2">
                        <Phone className="h-3 w-3" />
                        <span>{entry.contacts.phone}</span>
                      </div>
                    )}
                    {entry.contacts.email && (
                      <div className="flex items-center space-x-2">
                        <Mail className="h-3 w-3" />
                        <span>{entry.contacts.email}</span>
                      </div>
                    )}
                    {entry.contacts.address_street && (
                      <div className="flex items-center space-x-2">
                        <MapPin className="h-3 w-3" />
                        <span className="text-xs">
                          {entry.contacts.address_street}, {entry.contacts.address_city}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Eligibility Checklist */}
        <Card className={isEligible ? 'border-success/50' : 'border-warning/50'}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Job Conversion Eligibility
              </span>
              {isEligible ? (
                <Badge className="bg-success text-success-foreground">Ready to Convert</Badge>
              ) : (
                <Badge variant="outline" className="border-warning text-warning">
                  Requirements Not Met
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <EligibilityItem
                label="Estimate Completed"
                checked={eligibility.hasEstimate}
                required={true}
                icon={FileText}
              />
              <EligibilityItem
                label="Minimum 20% Profit Margin"
                checked={eligibility.meetsMargin}
                required={true}
                icon={Target}
                details={estimate ? `Current: ${estimate.actual_margin_percent.toFixed(1)}%` : undefined}
              />
              <EligibilityItem
                label="Documents Uploaded"
                checked={eligibility.hasDocuments}
                required={false}
                icon={FileText}
              />
              <EligibilityItem
                label="Customer Signature"
                checked={eligibility.hasSignature}
                required={false}
                icon={Signature}
              />
              <EligibilityItem
                label="Manager Approval"
                checked={eligibility.hasApproval}
                required={entry.requires_manager_approval || false}
                icon={CheckCircle2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        {estimate && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Financial Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Selling Price</p>
                  <p className="text-2xl font-bold text-primary">
                    ${estimate.selling_price.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Material Cost</p>
                  <p className="text-xl font-semibold">
                    ${estimate.material_cost.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Labor Cost</p>
                  <p className="text-xl font-semibold">
                    ${estimate.labor_cost.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Profit Margin</p>
                  <p className={`text-2xl font-bold ${
                    estimate.actual_margin_percent >= 30 ? 'text-success' :
                    estimate.actual_margin_percent >= 20 ? 'text-warning' :
                    'text-destructive'
                  }`}>
                    {estimate.actual_margin_percent.toFixed(1)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Conversion Action */}
        <Card className="border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Convert to Job</h3>
                <p className="text-sm text-muted-foreground">
                  {isEligible 
                    ? 'This entry meets all required criteria and can be converted to a job.'
                    : 'Complete the required items above before converting to a job.'}
                </p>
              </div>
              <Button 
                onClick={handleConvertToJob}
                disabled={!isEligible || converting}
                size="lg"
                className="gradient-primary"
              >
                {converting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Approve & Convert to Job
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

interface EligibilityItemProps {
  label: string;
  checked: boolean;
  required: boolean;
  icon: React.ComponentType<{ className?: string }>;
  details?: string;
}

const EligibilityItem: React.FC<EligibilityItemProps> = ({ 
  label, 
  checked, 
  required, 
  icon: Icon,
  details 
}) => (
  <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {required && (
            <Badge variant="outline" className="text-xs border-destructive text-destructive">
              Required
            </Badge>
          )}
        </div>
        {details && (
          <span className="text-xs text-muted-foreground">{details}</span>
        )}
      </div>
    </div>
    {checked ? (
      <CheckCircle2 className="h-5 w-5 text-success" />
    ) : required ? (
      <XCircle className="h-5 w-5 text-destructive" />
    ) : (
      <AlertCircle className="h-5 w-5 text-warning" />
    )}
  </div>
);

export default PipelineEntryReview;
