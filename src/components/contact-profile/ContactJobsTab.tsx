import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LeadCreationDialog } from "@/components/LeadCreationDialog";
import { PipelineToJobConverter } from "@/components/PipelineToJobConverter";
import { 
  Plus, 
  Briefcase, 
  Calendar, 
  DollarSign, 
  Eye, 
  Edit3,
  Loader2,
  Clock,
  TrendingUp,
  FileText,
  CheckCircle,
  ArrowRight,
  Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface ContactJobsTabProps {
  contact: any;
  jobs: any[];
  pipelineEntries?: any[];
  onJobsUpdate: (jobs: any[]) => void;
}

// Define unified job item type
interface UnifiedJobItem {
  id: string;
  type: 'pipeline' | 'job';
  name: string;
  status: string;
  description?: string;
  created_at: string;
  updated_at: string;
  estimated_value?: number;
  probability_percent?: number;
  roof_type?: string;
  job_number?: string;
  // Pipeline entry specific
  pipeline_entry_id?: string;
  // Job specific
  project?: any;
  // Project navigation
  projectId?: string | null;
  projectNumber?: string | null;
  originalStatus?: string;
}

export const ContactJobsTab = ({ contact, jobs, pipelineEntries = [], onJobsUpdate }: ContactJobsTabProps) => {
  const [showLeadDialog, setShowLeadDialog] = useState(false);
  const [unifiedJobs, setUnifiedJobs] = useState<UnifiedJobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchUnifiedJobs();
  }, [contact.id, jobs, pipelineEntries]);

  // Helper function to map pipeline status to job-friendly status
  const mapPipelineStatusToJobStatus = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'lead':
        return 'Lead Generated';
      case 'hot_lead':
        return 'Hot Lead';
      case 'warm_lead':
        return 'Warm Lead';
      case 'cold_lead':
        return 'Cold Lead';
      case 'estimate':
        return 'Estimate Pending';
      case 'estimate_sent':
        return 'Estimate Sent';
      case 'contract':
        return 'Contract Review';
      case 'contract_signed':
        return 'Contract Signed';
      case 'project':
        return 'Active Project';
      case 'hold_manager_review':
        return 'Manager Review';
      case 'closed_won':
        return 'Won';
      case 'closed_lost':
        return 'Lost';
      default:
        return status?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
    }
  };

  const fetchUnifiedJobs = async () => {
    if (!contact.id) return;
    
    setLoading(true);
    try {
      // Use pipeline entries passed as prop instead of fetching them
      // This eliminates duplicate fetching and ensures consistency

      // Fetch actual jobs for this contact
      const { data: actualJobs, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('contact_id', contact.id);

      if (jobsError) throw jobsError;

      // Transform pipeline entries to unified job items
      const pipelineJobItems: UnifiedJobItem[] = (pipelineEntries || []).map(entry => {
        console.log('Pipeline entry:', entry.id, 'Status:', entry.status, 'Projects:', entry.projects);
        return {
          id: entry.id,
          type: 'pipeline' as const,
          name: `${entry.contacts?.first_name || 'Unknown'} ${entry.contacts?.last_name || 'Customer'} - ${entry.roof_type || 'Roofing'} Lead`,
          status: mapPipelineStatusToJobStatus(entry.status),
          description: `${entry.roof_type || 'Roofing'} project${entry.estimated_value ? ` - Est. $${entry.estimated_value.toLocaleString()}` : ''}`,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          estimated_value: entry.estimated_value,
          probability_percent: entry.probability_percent,
          roof_type: entry.roof_type,
          pipeline_entry_id: entry.id,
          projectId: entry.projects?.[0]?.id || null,
          projectNumber: entry.projects?.[0]?.project_number || null,
          originalStatus: entry.status
        };
      });

      // Transform actual jobs to unified job items
      const actualJobItems: UnifiedJobItem[] = (actualJobs || []).map(job => ({
        id: job.id,
        type: 'job' as const,
        name: job.name || `Job #${job.job_number}`,
        status: job.status?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown',
        description: job.description,
        created_at: job.created_at,
        updated_at: job.updated_at,
        job_number: job.job_number,
        project: null // Remove projects reference for now
      }));

      // Combine both arrays with pipeline entries first (most recent first)
      const unified = [
        ...pipelineJobItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        ...actualJobItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      ];

      setUnifiedJobs(unified);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast({
        title: "Error",
        description: "Failed to load jobs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLeadCreated = () => {
    toast({
      title: "Lead Created",
      description: "Lead created successfully. It will appear in the pipeline for approval.",
    });
    fetchUnifiedJobs(); // Refresh jobs list
  };

  const handleDeleteJob = async (job: UnifiedJobItem) => {
    if (job.type !== 'pipeline') return;
    
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .delete()
        .eq('id', job.pipeline_entry_id);

      if (error) throw error;

      toast({
        title: "Lead Deleted",
        description: "Lead has been successfully deleted.",
      });
      
      fetchUnifiedJobs(); // Refresh jobs list
    } catch (error) {
      console.error('Error deleting lead:', error);
      toast({
        title: "Error",
        description: "Failed to delete lead. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobs.length === 0) return;
    
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .delete()
        .in('id', selectedJobs);

      if (error) throw error;

      toast({
        title: "Bulk Delete Complete",
        description: `Successfully deleted ${selectedJobs.length} leads.`,
      });
      
      setSelectedJobs([]);
      setShowBulkDelete(false);
      fetchUnifiedJobs(); // Refresh jobs list
    } catch (error) {
      console.error('Error bulk deleting leads:', error);
      toast({
        title: "Error",
        description: "Failed to delete leads. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleJobSelection = (jobId: string, checked: boolean) => {
    setSelectedJobs(prev => 
      checked 
        ? [...prev, jobId]
        : prev.filter(id => id !== jobId)
    );
  };

  const selectAllJobs = () => {
    const pipelineJobIds = unifiedJobs
      .filter(job => job.type === 'pipeline')
      .map(job => job.pipeline_entry_id!)
      .filter(id => id);
    setSelectedJobs(pipelineJobIds);
  };

  const clearSelection = () => {
    setSelectedJobs([]);
  };

  const getStatusColor = (status: string, type: 'pipeline' | 'job') => {
    if (type === 'pipeline') {
      // Pipeline entry status colors
      switch (status?.toLowerCase()) {
        case 'lead generated':
        case 'hot lead':
        case 'warm lead':
          return 'bg-gradient-to-r from-orange-500 to-red-500 text-white';
        case 'cold lead':
          return 'bg-gradient-to-r from-blue-400 to-blue-600 text-white';
        case 'estimate pending':
        case 'estimate sent':
          return 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white';
        case 'contract review':
        case 'contract signed':
          return 'bg-gradient-to-r from-emerald-500 to-green-500 text-white';
        case 'active project':
          return 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';
        case 'won':
          return 'bg-gradient-to-r from-green-500 to-emerald-600 text-white';
        case 'lost':
          return 'bg-gradient-to-r from-red-500 to-rose-600 text-white';
        default:
          return 'bg-gradient-to-r from-slate-400 to-slate-500 text-white';
      }
    } else {
      // Actual job status colors
      switch (status?.toLowerCase()) {
        case 'completed':
          return 'bg-success text-success-foreground';
        case 'in progress':
          return 'bg-warning text-warning-foreground';
        case 'scheduled':
          return 'bg-info text-info-foreground';
        case 'materials ordered':
          return 'bg-primary text-primary-foreground';
        case 'quality check':
          return 'bg-secondary text-secondary-foreground';
        case 'invoiced':
          return 'bg-accent text-accent-foreground';
        case 'closed':
          return 'bg-muted text-muted-foreground';
        default:
          return 'bg-muted text-muted-foreground';
      }
    }
  };

  const getNextStageAction = (job: UnifiedJobItem) => {
    if (job.type !== 'pipeline') return null;
    
    const status = job.status.toLowerCase();
    if (status.includes('lead')) {
      return { label: 'Create Estimate', icon: FileText, action: 'estimate' };
    } else if (status.includes('estimate')) {
      return { label: 'Send Contract', icon: Edit3, action: 'contract' };
    } else if (status.includes('contract')) {
      return { label: 'Convert to Job', icon: CheckCircle, action: 'convert' };
    }
    return null;
  };

  // Calculate statistics based on unified jobs
  const totalJobs = unifiedJobs.length;
  const activeJobs = unifiedJobs.filter(job => {
    if (job.type === 'pipeline') {
      return !job.status.toLowerCase().includes('lost') && !job.status.toLowerCase().includes('won');
    } else {
      return ['scheduled', 'in progress', 'materials ordered', 'quality check'].some(s => 
        job.status.toLowerCase().includes(s.toLowerCase())
      );
    }
  }).length;
  const completedJobs = unifiedJobs.filter(job => {
    if (job.type === 'pipeline') {
      return job.status.toLowerCase().includes('won');
    } else {
      return job.status.toLowerCase().includes('completed');
    }
  }).length;

  return (
    <div className="space-y-6">
      {/* Pipeline to Job Converter */}
      <PipelineToJobConverter 
        pipelineEntries={pipelineEntries}
        onJobCreated={fetchUnifiedJobs}
      />

      {/* Jobs Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Total Jobs</p>
                <p className="text-2xl font-bold">{totalJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Active Jobs</p>
                <p className="text-2xl font-bold">{activeJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-success" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Completed</p>
                <p className="text-2xl font-bold">{completedJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Jobs & Leads ({totalJobs})
            {selectedJobs.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {selectedJobs.length} selected
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {selectedJobs.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                >
                  Clear Selection
                </Button>
                <AlertDialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowBulkDelete(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Selected ({selectedJobs.length})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Bulk Delete Leads</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete {selectedJobs.length} selected leads? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={handleBulkDelete}
                      >
                        Delete {selectedJobs.length} Leads
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            {unifiedJobs.filter(job => job.type === 'pipeline').length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllJobs}
                disabled={selectedJobs.length === unifiedJobs.filter(job => job.type === 'pipeline').length}
              >
                Select All Leads
              </Button>
            )}
            <LeadCreationDialog 
              contact={contact}
              onLeadCreated={handleLeadCreated}
              trigger={
                <Button className="gradient-primary">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Lead
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading jobs...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unifiedJobs
                .filter(job => job.originalStatus !== 'contingency_signed')
                .map((job) => {
                const nextAction = getNextStageAction(job);
                return (
                  <div key={job.id} className="border rounded-lg p-4 hover:shadow-soft transition-smooth relative">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        {job.type === 'pipeline' && (
                          <input
                            type="checkbox"
                            checked={selectedJobs.includes(job.pipeline_entry_id!)}
                            onChange={(e) => handleJobSelection(job.pipeline_entry_id!, e.target.checked)}
                            className="mt-1 mr-2"
                          />
                        )}
                        <div className="flex-1 min-w-0 pr-2">
                          <h3 className="font-semibold text-sm leading-tight truncate max-w-full">{job.name}</h3>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge 
                              variant={job.type === 'pipeline' ? 'secondary' : 'outline'} 
                              className="text-xs"
                            >
                              {job.type === 'pipeline' ? 'Lead' : 'Job'}
                            </Badge>
                            {job.job_number && (
                              <Badge variant="outline" className="text-xs">
                                {job.job_number}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {job.type === 'pipeline' && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive absolute top-2 right-2"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Lead</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this lead? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => handleDeleteJob(job)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                      
                      <Badge className={`text-xs ${getStatusColor(job.status, job.type)} w-fit`}>
                        {job.status}
                      </Badge>
                      
                      {job.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 break-words pr-8">{job.description}</p>
                      )}

                      {job.type === 'pipeline' && (
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {job.estimated_value && (
                            <div className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              ${job.estimated_value.toLocaleString()}
                            </div>
                          )}
                          {job.probability_percent && (
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3" />
                              {job.probability_percent}%
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-muted-foreground pr-8">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">Created: {new Date(job.created_at).toLocaleDateString()}</span>
                        </div>
                        {job.updated_at !== job.created_at && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">Updated: {new Date(job.updated_at).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 mt-4">
                        {job.type === 'pipeline' && nextAction && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="flex-1 text-xs"
                            onClick={() => {
                              toast({
                                title: "Feature Coming Soon",
                                description: `${nextAction.label} functionality will be available soon.`,
                              });
                            }}
                          >
                            <nextAction.icon className="h-3 w-3 mr-1" />
                            {nextAction.label}
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className={job.type === 'pipeline' && nextAction ? "px-3" : "flex-1"}
                          onClick={() => {
                            console.log('View button clicked for job:', job.type, 'projectId:', job.projectId, 'originalStatus:', job.originalStatus);
                            if (job.type === 'pipeline') {
                              // If pipeline entry has associated project, go to project details
                              if (job.projectId) {
                                console.log('Navigating to project:', job.projectId);
                                navigate(`/project/${job.projectId}`);
                              } else {
                                console.log('Navigating to lead:', job.pipeline_entry_id);
                                navigate(`/lead/${job.pipeline_entry_id}`);
                              }
                            } else {
                              // For actual jobs, navigate to job details for now
                              console.log('Navigating to job:', job.id);
                              navigate(`/job/${job.id}`);
                            }
                          }}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          {job.type === 'pipeline' && nextAction ? '' : 'View'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {unifiedJobs.length === 0 && (
                <Card className="border-dashed border-2 col-span-full">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No jobs or leads yet</h3>
                    <p className="text-muted-foreground mb-4 text-center">
                      Create the first lead for this contact to get started.
                    </p>
                    <Button onClick={() => setShowLeadDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Lead
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};