import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BudgetTracker } from "@/features/projects";
import { JobInvoiceTracker, JobPhotoGallery, JobDocumentManager, JobTimelineTracker } from "@/features/jobs";
import PaymentForm from "@/features/payments/components/PaymentForm";
import { ContactCommunicationTab } from "@/components/contact-profile/ContactCommunicationTab";
import { JobActivityTimeline } from "@/components/JobActivityTimeline";
import { CollapsibleDeveloperToolbar } from "@/shared/components/CollapsibleDeveloperToolbar";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { 
  Loader2, ArrowLeft, MapPin, Calendar, User, Phone, Mail, 
  DollarSign, FileText, Camera, Clock, Settings, CreditCard,
  TrendingUp, TrendingDown, Target, AlertTriangle, ExternalLink
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

interface JobDetailsData {
  id: string;
  job_number: string;
  name: string;
  description?: string;
  status: string;
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
    start_date: string;
    estimated_completion_date?: string;
  };
  created_at: string;
  updated_at: string;
}

interface FinancialSummary {
  totalBudget: number;
  actualCosts: number;
  totalPaid: number;
  remainingBalance: number;
  profitMargin: number;
  salesRepCommission: number;
}

const JobDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetItems, setBudgetItems] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeSection, setActiveSection] = useState('jobs');
  const [financials, setFinancials] = useState<FinancialSummary>({
    totalBudget: 0,
    actualCosts: 0,
    totalPaid: 0,
    remainingBalance: 0,
    profitMargin: 0,
    salesRepCommission: 0
  });

  useEffect(() => {
    if (id) {
      fetchJobDetails();
      fetchBudgetItems();
      fetchFinancialSummary();
    }
  }, [id]);

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
        .eq('project_id', id);

      if (error) throw error;
      setBudgetItems(data || []);
    } catch (error) {
      console.error('Error fetching budget items:', error);
    }
  };

  const fetchFinancialSummary = async () => {
    try {
      // Fetch financial data - this would integrate with existing tables
      // For now using mock data, but would pull from:
      // - estimates table for budget
      // - payments table for paid amounts  
      // - project_costs for actual costs
      // - commission_calculations for rep commission

      setFinancials({
        totalBudget: 45000,
        actualCosts: 38000,
        totalPaid: 30000,
        remainingBalance: 15000,
        profitMargin: 18.5,
        salesRepCommission: 2250
      });
    } catch (error) {
      console.error('Error fetching financial summary:', error);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading job details...</span>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <h2 className="text-2xl font-bold">Job not found</h2>
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
      {/* Header with Contact Card */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4 flex-1">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              // Navigate back to contact if we have contact info, otherwise go back
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
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold">{job.name}</h1>
              <Badge className={getStatusColor(job.status)}>
                {job.status.replace('_', ' ')}
              </Badge>
            </div>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-1">
              <span className="font-mono">{job.job_number}</span>
              {job.project && (
                <span>Project: {job.project.project_number}</span>
              )}
            </div>
          </div>
        </div>

        {/* Minimized Contact Card */}
        {job.contact && (
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
                  onClick={() => navigate(`/contact/${job.contact?.id}`)}
                  title="View Contact Profile"
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-2">
                <p className="font-semibold">
                  {job.contact.first_name} {job.contact.last_name}
                </p>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {job.contact.phone && (
                    <div className="flex items-center space-x-2">
                      <Phone className="h-3 w-3" />
                      <span>{job.contact.phone}</span>
                    </div>
                  )}
                  {job.contact.email && (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-3 w-3" />
                      <span>{job.contact.email}</span>
                    </div>
                  )}
                  {job.contact.address_street && (
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-3 w-3" />
                      <span className="text-xs">
                        {job.contact.address_street}, {job.contact.address_city}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Save & Exit Button */}
        <Button 
          onClick={handleSaveAndExit}
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

      {/* Financial Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="gradient-primary text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm">Total Budget</p>
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
                <p className="text-muted-foreground text-sm">Profit Margin</p>
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
            <span>Live Profit & Loss</span>
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

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-9">
          <TabsTrigger value="overview" className="flex items-center space-x-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center space-x-1">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
          <TabsTrigger value="budget" className="flex items-center space-x-1">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Budget</span>
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center space-x-1">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Payments</span>
          </TabsTrigger>
          <TabsTrigger value="communication" className="flex items-center space-x-1">
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">Comms</span>
          </TabsTrigger>
          <TabsTrigger value="invoices" className="flex items-center space-x-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Invoices</span>
          </TabsTrigger>
          <TabsTrigger value="photos" className="flex items-center space-x-1">
            <Camera className="h-4 w-4" />
            <span className="hidden sm:inline">Photos</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center space-x-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Documents</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center space-x-1">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Timeline</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
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
          <PaymentForm 
            selectedJob={{
              id: job.id,
              customer: job.contact ? `${job.contact.first_name} ${job.contact.last_name}` : 'Unknown',
              email: job.contact?.email,
              address: job.contact?.address_street ? 
                `${job.contact.address_street}, ${job.contact.address_city}` : 
                'No address',
              totalAmount: financials.totalBudget,
              paidAmount: financials.totalPaid,
              remainingBalance: financials.remainingBalance,
              projectType: job.name
            }}
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
          <JobDocumentManager jobId={job.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <JobTimelineTracker jobId={job.id} />
        </TabsContent>
      </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default JobDetails;