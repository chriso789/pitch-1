import { calculateJobFinancials, type FinancialSummary } from '@/features/jobs/financialSummary';
import { RecordScanDocuments } from '@/components/documents/RecordScanDocuments';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BudgetTracker } from "@/features/projects";
import { JobInvoiceTracker, JobPhotoGallery, JobDocumentManager, JobTimelineTracker } from "@/features/jobs";
import { RecordPaymentDialog } from "@/components/payments/RecordPaymentDialog";
import { useQuery } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { ContactCommunicationTab } from "@/components/contact-profile/ContactCommunicationTab";
import { JobActivityTimeline } from "@/components/JobActivityTimeline";
import { ProductionTimeline } from "@/components/job-details/ProductionTimeline";
import { JobActivitySection } from "@/components/job-details/JobActivitySection";
import { QuickBooksInvoiceCard } from "@/components/jobs/QuickBooksInvoiceCard";
import { QuickBooksPaymentHistory } from "@/components/jobs/QuickBooksPaymentHistory";
import { QuickBooksInvoiceManager } from "@/components/jobs/QuickBooksInvoiceManager";
import { AuditTrailViewer } from "@/components/audit/AuditTrailViewer";
import { CollapsibleDeveloperToolbar } from "@/shared/components/CollapsibleDeveloperToolbar";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { 
  Loader2, ArrowLeft, MapPin, Calendar, User, Phone, Mail, 
  DollarSign, FileText, Camera, Clock, Settings, CreditCard,
  TrendingUp, TrendingDown, Target, AlertTriangle, ExternalLink, Sparkles, Download, Receipt
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { ProfessionalTemplatesDialog } from '@/components/documents/ProfessionalTemplatesDialog';
import { BudgetChips } from '@/components/production/BudgetChips';
import { CostConfirmationDialog } from '@/components/production/CostConfirmationDialog';
import { SendReferralLinkButton } from '@/components/referrals/SendReferralLinkButton';

interface JobDetailsData {
  id: string;
  job_number: string;
  name: string;
  description?: string;
  status: string;
  tenant_id?: string;
  project_id?: string;
  pipeline_entry_id?: string;
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
  };
  project?: {
    id: string;
    project_number: string;
    pipeline_entry_id?: string;
    start_date: string;
    estimated_completion_date?: string;
  };
  created_at: string;
  updated_at: string;
}

const JobDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetItems, setBudgetItems] = useState([]);
  const [productionStage, setProductionStage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showSmartDocs, setShowSmartDocs] = useState(false);
  const [showCostConfirmation, setShowCostConfirmation] = useState(false);
  const tenantId = useEffectiveTenantId();
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const projectId = job?.project_id || job?.project?.id;
  const pipelineEntryId = job?.pipeline_entry_id || job?.project?.pipeline_entry_id;
  const { data: financials, error: financialError, refetch: refreshFinancials } = useQuery({
    queryKey: ['job-financials', tenantId, id, projectId, pipelineEntryId],
    enabled: !!tenantId && !!job && job.tenant_id === tenantId,
    refetchInterval: 30000,
    queryFn: async (): Promise<FinancialSummary> => {
      if (!projectId || !pipelineEntryId) throw new Error('Link this job to its project and lead to load financials');
      const results = await Promise.all([
        supabase.rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId }),
        supabase.from('project_scopes').select('current_contract_amount_cents').eq('tenant_id', tenantId).eq('project_id', projectId).neq('status', 'cancelled'),
        supabase.from('project_costs').select('total_cost').eq('tenant_id', tenantId).eq('project_id', projectId),
        supabase.from('project_payments').select('amount').eq('tenant_id', tenantId).eq('pipeline_entry_id', pipelineEntryId),
        supabase.from('commission_calculations').select('commission_amount, status').eq('tenant_id', tenantId).eq('project_id', projectId),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const estimate = results[0].data as { sale_price?: number } | null;
      const scopes = results[1].data || [];
      const totalBudget = scopes.length ? scopes.reduce((sum, row) => sum + Number(row.current_contract_amount_cents), 0) / 100 : Number(estimate?.sale_price);
      if (!Number.isFinite(totalBudget)) throw new Error('No priced estimate or contract is available');
      return calculateJobFinancials({ contractValue: totalBudget, costs: results[2].data || [],
        payments: results[3].data || [], commissions: results[4].data || [] });
    },
  });

  // Safety guard: handle invalid IDs like "new"
  useEffect(() => {
    if (id === 'new' || !id) {
      toast({
        title: 'Invalid Route',
        description: 'Jobs are created from contacts. Please go to a contact profile to create a job.',
        variant: 'destructive'
      });
      navigate('/jobs');
      return;
    }
  }, [id, navigate]);

  useEffect(() => {
    if (id && id !== 'new' && tenantId) {
      fetchJobDetails();
    }
  }, [id, tenantId]);

  useEffect(() => {
    if (projectId && tenantId && job?.tenant_id === tenantId) { void fetchBudgetItems(); void fetchProductionStage(); }
  }, [projectId, tenantId, job?.tenant_id]);

  // Set up real-time listener for production workflow changes
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`job-production-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_workflows',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          if (payload.new && 'current_stage' in payload.new) {
            setProductionStage(payload.new.current_stage as string);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const fetchProductionStage = async () => {
    try {
      const { data: workflow } = await supabase
        .from('production_workflows')
        .select('current_stage')
        .eq('project_id', projectId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (workflow) {
        setProductionStage(workflow.current_stage);
      }
    } catch (error) {
      console.error('Error fetching production stage:', error);
    }
  };

  const fetchJobDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          contact:contacts(*),
          project:projects(*)
        `)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setJob(data as any);
      }
    } catch (error) {
      console.error('Error fetching job details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load job details',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchBudgetItems = async () => {
    try {
      const { data, error } = await supabase
        .from('project_budget_items')
        .select('*')
        .eq('project_id', projectId)
        .eq('tenant_id', tenantId);

      if (error) throw error;
      setBudgetItems(data || []);
    } catch (error) {
      console.error('Error fetching budget items:', error);
    }
  };

  const handleSaveAndExit = async () => {
    if (!job) return;
    
    setLoading(true);
    try {
      // Ensure job exists in database and is properly saved
      const { data: existingJob, error: checkError } = await supabase
        .from('jobs')
        .select('id, tenant_id')
        .eq('id', id)
        .maybeSingle();

      if (checkError) throw checkError;
      
      if (!existingJob) {
        // Job doesn't exist in jobs table, create it
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("No authenticated user");

        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .maybeSingle();

        if (!profile) throw new Error("No user profile found");

        const { data: newJob, error: createError } = await supabase
          .from('jobs')
          .insert([{
            tenant_id: profile.tenant_id,
            contact_id: job.contact?.id,
            name: job.name,
            description: job.description,
            status: job.status as any,
            created_by: user.id
          }])
          .select()
          .single();

        if (createError) throw createError;
        
        toast({
          title: 'Job Saved',
          description: 'Job has been successfully saved to the database',
        });
      } else {
        // Job exists, just update timestamp
        const { error: updateError } = await supabase
          .from('jobs')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', job.id);

        if (updateError) throw updateError;

        toast({
          title: 'Job Saved',
          description: 'Job has been successfully updated',
        });
      }

      // Navigate back to previous page
      navigate(-1);
      
    } catch (error) {
      console.error('Error saving job:', error);
      toast({
        title: 'Error',
        description: 'Failed to save job. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      'pending': 'bg-warning text-warning-foreground',
      'active': 'bg-status-project text-white',
      'completed': 'bg-status-completed text-white',
      'on_hold': 'bg-muted text-muted-foreground'
    };
    return colors[status as keyof typeof colors] || 'bg-muted';
  };

  if (loading || (job && job.tenant_id !== tenantId)) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading job details...</span>
          </div>
        </div>
      </GlobalLayout>
    );
  }

  if (!job) {
    return (
      <GlobalLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <h2 className="text-2xl font-bold">Job not found</h2>
          <Button onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go back
          </Button>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="max-w-7xl mx-auto space-y-6">
      {/* Header with Contact Card */}
      <div className="space-y-2">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => {
            if (job?.contact?.id) {
              navigate(`/contact/${job.contact.id}`);
            } else {
              navigate(-1);
            }
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Contact
        </Button>
        {/* Row 2: Title + badges (left) | Action buttons (right) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold truncate" title={job.contact ? `${job.contact.first_name} ${job.contact.last_name}` : job.name}>
                {job.contact ? `${job.contact.first_name} ${job.contact.last_name}` : job.name}
              </h1>
              <Badge className={getStatusColor(job.status)}>
                {job.status.replace('_', ' ')}
              </Badge>
              {productionStage && (
                <Badge variant="outline" className="border-primary text-primary">
                  Production: {productionStage.replace('_', ' ')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
              <span className="font-mono">{job.job_number}</span>
              {job.project && (
                <span>Project: {job.project.project_number}</span>
              )}
              {job.contact?.address_street && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {job.contact.address_street}, {job.contact.address_city}, {job.contact.address_state} {job.contact.address_zip}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button 
              onClick={() => setShowCostConfirmation(true)}
              variant="outline"
              size="sm"
              title="Record material/labor costs"
            >
              <Receipt className="h-4 w-4 mr-2" />
              Confirm Cost
            </Button>
            <Button 
              onClick={() => setShowSmartDocs(true)}
              variant="outline"
              size="sm"
              title="Generate and manage photo reports"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
            {job.contact?.id && ['completed', 'sold', 'paid'].includes(job.status) && (
              <SendReferralLinkButton contactId={job.contact.id} jobId={job.id} />
            )}
            <Button 
              onClick={handleSaveAndExit}
              size="sm"
              className="bg-success hover:bg-success/90 text-success-foreground"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Settings className="h-4 w-4 mr-2" />
              )}
              Save & Exit
            </Button>
          </div>
        </div>

        {/* Row 3: Compact Contact Bar */}
        {job.contact && (
          <div className="flex items-center gap-4 flex-wrap rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
            <button 
              onClick={() => navigate(`/contact/${job.contact?.id}`)}
              className="flex items-center gap-2 font-medium hover:text-primary transition-colors"
            >
              <User className="h-4 w-4 text-primary" />
              {job.contact.first_name} {job.contact.last_name}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </button>
            {job.contact.phone && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Phone className="h-3 w-3" />
                {job.contact.phone}
              </span>
            )}
            {job.contact.email && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="h-3 w-3" />
                {job.contact.email}
              </span>
            )}
            {job.contact.address_street && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {job.contact.address_street}, {job.contact.address_city}, {job.contact.address_state} {job.contact.address_zip}
              </span>
            )}
          </div>
        )}
      </div>

      <ProfessionalTemplatesDialog
        open={showSmartDocs}
        onClose={() => setShowSmartDocs(false)}
        jobId={id}
      />

      <CostConfirmationDialog
        open={showCostConfirmation}
        onOpenChange={setShowCostConfirmation}
        projectId={projectId!}
        onSuccess={() => {
          // Budgets will auto-refresh via their query refetch interval
        }}
      />

      {/* Budget Tracking (Pre-Cap vs Cap-Out) */}
      {id && (
        <div className="mb-6">
          <BudgetChips projectId={projectId} targetMarginPercent={30} />
        </div>
      )}

      {/* Financial Dashboard */}
      {!financials && <Card className="p-4">{financialError ? String(financialError.message) : 'Loading financials…'}</Card>}
      {financials && <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="gradient-primary text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm">Contract / Estimate Value</p>
                <p className="text-2xl font-bold">${financials.totalBudget.toLocaleString()}</p>
              </div>
              <Target className="h-8 w-8 text-white/60" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Actual Costs</p>
                <p className="text-2xl font-bold">${financials.actualCosts.toLocaleString()}</p>
              </div>
              <DollarSign className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Total Paid</p>
                <p className="text-2xl font-bold text-success">${financials.totalPaid.toLocaleString()}</p>
              </div>
              <CreditCard className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Balance Due</p>
                <p className="text-2xl font-bold text-destructive">${financials.remainingBalance.toLocaleString()}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Recorded Margin</p>
                <p className="text-2xl font-bold text-primary">{financials.profitMargin}%</p>
              </div>
              {financials.profitMargin >= 15 ? 
                <TrendingUp className="h-8 w-8 text-success" /> :
                <TrendingDown className="h-8 w-8 text-destructive" />
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Real-time P&L Summary */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Recorded Cash Flow</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Revenue</p>
              <p className="text-xl font-bold text-success">
                ${financials.totalPaid.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Costs</p>
              <p className="text-xl font-bold text-destructive">
                ${financials.actualCosts.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Rep Commission</p>
              <p className="text-xl font-bold text-warning">
                ${financials.salesRepCommission.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Net Profit</p>
              <p className="text-xl font-bold text-primary">
                ${(financials.totalPaid - financials.actualCosts - financials.salesRepCommission).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      </>}
      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="relative">
          <TabsList className="flex w-full overflow-x-auto justify-start scrollbar-thin scrollbar-thumb-muted-foreground/20 pb-1">
            <TabsTrigger value="overview" className="flex-shrink-0 flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-shrink-0 flex items-center space-x-1">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Activity</span>
            </TabsTrigger>
            <TabsTrigger value="budget" className="flex-shrink-0 flex items-center space-x-1">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Budget</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex-shrink-0 flex items-center space-x-1">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Payments</span>
            </TabsTrigger>
            <TabsTrigger value="communication" className="flex-shrink-0 flex items-center space-x-1">
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">Comms</span>
            </TabsTrigger>
            <TabsTrigger value="invoices" className="flex-shrink-0 flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Invoices</span>
            </TabsTrigger>
            <TabsTrigger value="quickbooks" className="flex-shrink-0 flex items-center space-x-1">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">QBO</span>
            </TabsTrigger>
            <TabsTrigger value="photos" className="flex-shrink-0 flex items-center space-x-1">
              <Camera className="h-4 w-4" />
              <span className="hidden sm:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex-shrink-0 flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex-shrink-0 flex items-center space-x-1">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Timeline</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex-shrink-0 flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Audit</span>
            </TabsTrigger>
          </TabsList>
          <div className="absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
        </div>

        <TabsContent value="overview" className="space-y-6">
          {/* QuickBooks Invoice Card */}
          {job.project?.id && job.tenant_id && (
            <>
              <QuickBooksInvoiceCard 
                projectId={job.project.id} 
                tenantId={job.tenant_id} 
              />
              <QuickBooksPaymentHistory 
                projectId={job.project.id} 
                tenantId={job.tenant_id} 
              />
            </>
          )}

          {/* Production Timeline */}
          {job.project?.id && (
            <ProductionTimeline projectId={job.project.id} />
          )}

          {/* Job Activity Metrics */}
          <JobActivitySection 
            projectId={job.project?.id || job.id}
            contactId={job.contact?.id}
          />

          {/* Description and Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Job Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {job.description || 'No description provided'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full" variant="outline">
                  Update Job Status
                </Button>
                <Button className="w-full" variant="outline">
                  Schedule Appointment
                </Button>
                <Button className="w-full" variant="outline">
                  Create Estimate
                </Button>
                <Button className="w-full" variant="outline">
                  Generate Report
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <JobActivityTimeline jobId={job.id} />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetTracker 
            projectId={job.project?.id || job.id}
            budgetItems={budgetItems}
            onRefresh={fetchBudgetItems}
          />
        </TabsContent>

        <TabsContent value="payments">
          {financials && pipelineEntryId && tenantId ? <>
            <Button onClick={() => setRecordPaymentOpen(true)}>Record payment</Button>
            <RecordPaymentDialog open={recordPaymentOpen} onOpenChange={(open) => {
              setRecordPaymentOpen(open); if (!open) void refreshFinancials();
            }} pipelineEntryId={pipelineEntryId} tenantId={tenantId} projectName={job.name}
              sellingPrice={financials.totalBudget} totalPaid={financials.totalPaid} />
          </> : <p>Financials must be available before recording a payment.</p>}
        </TabsContent>

        <TabsContent value="quickbooks">
          <QuickBooksInvoiceManager
            projectId={projectId!}
            tenantId={job.tenant_id!}
          />
        </TabsContent>


        <TabsContent value="communication">
          {job.contact ? (
            <ContactCommunicationTab contact={job.contact} />
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-muted-foreground">No contact associated with this job</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="invoices">
          <JobInvoiceTracker jobId={job.id} />
        </TabsContent>

        <TabsContent value="photos">
          <JobPhotoGallery jobId={job.id} />
        </TabsContent>

        <TabsContent value="documents">
          <div className="mb-4"><RecordScanDocuments recordType="job" recordId={job.id} title="Scanned job documents" /></div>
          <JobDocumentManager jobId={job.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <JobTimelineTracker jobId={job.id} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTrailViewer recordId={job.id} tableName="jobs" />
        </TabsContent>
      </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default JobDetails;