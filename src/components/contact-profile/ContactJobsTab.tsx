import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadCreationDialog } from "@/components/LeadCreationDialog";
import { 
  Plus, 
  Briefcase, 
  Calendar, 
  DollarSign, 
  Eye, 
  Edit3,
  Loader2,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface ContactJobsTabProps {
  contact: any;
  jobs: any[];
  onJobsUpdate: (jobs: any[]) => void;
}

export const ContactJobsTab = ({ contact, jobs, onJobsUpdate }: ContactJobsTabProps) => {
  const [showLeadDialog, setShowLeadDialog] = useState(false);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchAllJobs();
  }, [contact.id, jobs]);

  const fetchAllJobs = async () => {
    if (!contact.id) return;
    
    setLoading(true);
    try {
      // Fetch direct jobs
      const { data: directJobs, error: jobsError } = await supabase
        .from('jobs')
        .select(`
          *,
          projects (
            name,
            status,
            estimated_completion_date
          )
        `)
        .eq('contact_id', contact.id);

      if (jobsError) throw jobsError;

      // Fetch jobs from pipeline entries
      const { data: pipelineJobs, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          status,
          created_at,
          updated_at,
          estimated_value,
          roof_type,
          jobs (
            id,
            job_number,
            name,
            description,
            status,
            created_at,
            updated_at,
            projects (
              name,
              status,
              estimated_completion_date
            )
          )
        `)
        .eq('contact_id', contact.id)
        .not('jobs', 'is', null);

      if (pipelineError) throw pipelineError;

      // Combine and deduplicate jobs
      const combinedJobs = [
        ...(directJobs || []),
        ...(pipelineJobs?.flatMap(pe => pe.jobs || []) || [])
      ];

      // Remove duplicates by ID
      const uniqueJobs = combinedJobs.filter((job, index, arr) => 
        arr.findIndex(j => j.id === job.id) === index
      );

      setAllJobs(uniqueJobs);
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
    fetchAllJobs(); // Refresh jobs list
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-green-500 text-white';
      case 'in_progress':
        return 'bg-orange-500 text-white';
      case 'scheduled':
        return 'bg-blue-500 text-white';
      case 'materials_ordered':
        return 'bg-yellow-500 text-white';
      case 'quality_check':
        return 'bg-purple-500 text-white';
      case 'invoiced':
        return 'bg-emerald-600 text-white';
      case 'closed':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Jobs Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Total Jobs</p>
                <p className="text-2xl font-bold">{allJobs.length}</p>
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
                <p className="text-2xl font-bold">
                  {allJobs.filter(job => ['scheduled', 'in_progress', 'materials_ordered', 'quality_check'].includes(job.status)).length}
                </p>
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
                <p className="text-2xl font-bold">
                  {allJobs.filter(job => job.status === 'completed').length}
                </p>
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
            Jobs ({allJobs.length})
          </CardTitle>
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
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading jobs...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allJobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-4 hover:shadow-soft transition-smooth">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">{job.name}</h3>
                      <Badge variant="outline" className="text-xs">
                        {job.job_number}
                      </Badge>
                    </div>
                    <Badge className={`text-xs ${getStatusColor(job.status)} w-fit`}>
                      {job.status?.replace('_', ' ').toUpperCase()}
                    </Badge>
                    
                    {job.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Created: {new Date(job.created_at).toLocaleDateString()}
                      </div>
                      {job.updated_at !== job.created_at && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Updated: {new Date(job.updated_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-4">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => navigate(`/job/${job.id}`)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View Details
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {allJobs.length === 0 && (
                <Card className="border-dashed border-2 col-span-full">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No jobs yet</h3>
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