import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { BudgetTracker } from '@/components/BudgetTracker';
import { JobInvoiceTracker } from '@/components/JobInvoiceTracker';
import { JobPhotoGallery } from '@/components/JobPhotoGallery';
import { JobDocumentManager } from '@/components/JobDocumentManager';
import { JobTimelineTracker } from '@/components/JobTimelineTracker';
import { Loader2, ArrowLeft, MapPin, Calendar, User, Phone, Mail, DollarSign, FileText, Camera, Clock, Settings } from 'lucide-react';
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

const JobDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetItems, setBudgetItems] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (id) {
      fetchJobDetails();
      fetchBudgetItems();
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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
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
        <Button>
          <Settings className="h-4 w-4 mr-2" />
          Job Settings
        </Button>
      </div>

      {/* Job Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-semibold">
                  {job.contact ? 
                    `${job.contact.first_name} ${job.contact.last_name}` : 
                    'No contact assigned'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MapPin className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-semibold text-sm">
                  {job.contact?.address_street ? (
                    `${job.contact.address_street}, ${job.contact.address_city}, ${job.contact.address_state}`
                  ) : (
                    'No address available'
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Start Date</p>
                <p className="font-semibold">
                  {job.project?.start_date ? 
                    new Date(job.project.start_date).toLocaleDateString() : 
                    'Not scheduled'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Completion</p>
                <p className="font-semibold">
                  {job.project?.estimated_completion_date ? 
                    new Date(job.project.estimated_completion_date).toLocaleDateString() : 
                    'Not estimated'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contact Information */}
      {job.contact && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {job.contact.phone && (
                <div className="flex items-center space-x-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{job.contact.phone}</span>
                </div>
              )}
              {job.contact.email && (
                <div className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{job.contact.email}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview" className="flex items-center space-x-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="budget" className="flex items-center space-x-1">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Budget</span>
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

        <TabsContent value="budget">
          <BudgetTracker 
            projectId={job.project?.id || job.id}
            budgetItems={budgetItems}
            onRefresh={fetchBudgetItems}
          />
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
  );
};

export default JobDetails;