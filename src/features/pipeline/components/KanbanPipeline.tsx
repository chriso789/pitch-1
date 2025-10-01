import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { LeadForm } from '@/features/contacts';
import { 
  Plus, 
  Filter, 
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle,
  FileText,
  User,
  Home,
  HourglassIcon,
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { auditService } from "@/services/auditService";

interface JobEntry {
  id: string;
  job_number: string;
  contact_id: string;
  project_id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  contacts: {
    id: string;
    contact_number: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  };
  projects?: {
    id: string;
    name: string;
  };
}

const KanbanPipeline = () => {
  const [pipelineData, setPipelineData] = useState<Record<string, JobEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userCanDelete, setUserCanDelete] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const jobStages = [
    { name: "Scheduled", key: "scheduled", color: "bg-blue-500", icon: Clock },
    { name: "Materials Ordered", key: "materials_ordered", color: "bg-yellow-500", icon: FileText },
    { name: "In Progress", key: "in_progress", color: "bg-orange-500", icon: Loader2 },
    { name: "Quality Check", key: "quality_check", color: "bg-purple-500", icon: AlertCircle },
    { name: "Completed", key: "completed", color: "bg-green-500", icon: CheckCircle },
    { name: "Invoiced", key: "invoiced", color: "bg-emerald-600", icon: FileText },
    { name: "Closed", key: "closed", color: "bg-gray-500", icon: CheckCircle }
  ];

  useEffect(() => {
    getCurrentUser();
    fetchJobsData();
  }, []);

  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setCurrentUser(profile);
      
      // Check if user can delete jobs (managers and admins only)
      const canDelete = profile?.role && ['admin', 'manager', 'master'].includes(profile.role);
      setUserCanDelete(canDelete);
    }
  };

  const fetchJobsData = async () => {
    try {
      setLoading(true);
      
      // Fetch jobs first (exclude soft-deleted jobs)
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (jobsError) {
        console.error('Error fetching jobs data:', jobsError);
        toast({
          title: "Error",
          description: "Failed to load jobs data",
          variant: "destructive",
        });
        return;
      }

      // If no jobs, set empty state
      if (!jobsData || jobsData.length === 0) {
        const emptyData: Record<string, JobEntry[]> = {};
        jobStages.forEach(stage => {
          emptyData[stage.key] = [];
        });
        setPipelineData(emptyData);
        return;
      }

      // Fetch contacts for all jobs
      const contactIds = [...new Set(jobsData.map(job => job.contact_id).filter(Boolean))];
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('id, contact_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip')
        .in('id', contactIds);

      if (contactsError) {
        console.error('Error fetching contacts:', contactsError);
      }

      // Fetch projects for all jobs
      const projectIds = [...new Set(jobsData.map(job => job.project_id).filter(Boolean))];
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('id, name')
        .in('id', projectIds);

      if (projectsError) {
        console.error('Error fetching projects:', projectsError);
      }

      // Create lookup maps
      const contactsMap = new Map(contactsData?.map(c => [c.id, c]) || []);
      const projectsMap = new Map(projectsData?.map(p => [p.id, p]) || []);

      // Combine the data
      const combinedJobs: JobEntry[] = jobsData
        .map(job => {
          const contact = contactsMap.get(job.contact_id);
          if (!contact) return null; // Skip jobs without valid contacts
          
          return {
            id: job.id,
            job_number: job.job_number,
            contact_id: job.contact_id,
            project_id: job.project_id,
            name: job.name,
            description: job.description,
            status: job.status,
            created_at: job.created_at,
            contacts: contact,
            projects: job.project_id ? projectsMap.get(job.project_id) : undefined
          };
        })
        .filter(Boolean) as JobEntry[];

      // Group data by status
      const groupedData: Record<string, JobEntry[]> = {};
      jobStages.forEach(stage => {
        groupedData[stage.key] = combinedJobs.filter(job => job.status === stage.key) || [];
      });

      setPipelineData(groupedData);
    } catch (error) {
      console.error('Error in fetchJobsData:', error);
      toast({
        title: "Error",
        description: "Failed to load jobs data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDragging(true);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDragging(false);

    if (!over || active.id === over.id) return;

    const entryId = active.id as string;
    const newStatus = over.id as string;

    // Find the job being moved
    let movedJob: JobEntry | null = null;
    let fromStatus = '';

    for (const [status, jobs] of Object.entries(pipelineData)) {
      const job = jobs.find(j => j.id === entryId);
      if (job) {
        movedJob = job;
        fromStatus = status;
        break;
      }
    }

    if (!movedJob) return;

    // Capture audit context before change
    await auditService.captureAuditContext();

    // Optimistically update UI
    const newPipelineData = { ...pipelineData };
    newPipelineData[fromStatus] = newPipelineData[fromStatus].filter(j => j.id !== entryId);
    newPipelineData[newStatus] = [...newPipelineData[newStatus], { ...movedJob, status: newStatus }];
    setPipelineData(newPipelineData);

    // Log the change
    await auditService.logChange(
      'jobs',
      'UPDATE',
      entryId,
      { status: fromStatus },
      { status: newStatus }
    );

    try {
      const { data, error } = await supabase.functions.invoke('pipeline-drag-handler', {
        body: {
          pipelineEntryId: entryId,
          newStatus: newStatus,
          fromStatus: fromStatus
        }
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        // Revert optimistic update
        const revertedData = { ...pipelineData };
        revertedData[newStatus] = revertedData[newStatus].filter(j => j.id !== entryId);
        revertedData[fromStatus] = [...revertedData[fromStatus], movedJob];
        setPipelineData(revertedData);

        toast({
          title: "Access Denied",
          description: data.message || data.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: data.message || "Job moved successfully",
      });

      // Refresh data to ensure consistency
      await fetchJobsData();

    } catch (error) {
      console.error('Error moving pipeline entry:', error);
      
      // Revert optimistic update
      const revertedData = { ...pipelineData };
      revertedData[newStatus] = revertedData[newStatus].filter(j => j.id !== entryId);
      revertedData[fromStatus] = [...revertedData[fromStatus], movedJob];
      setPipelineData(revertedData);

      toast({
        title: "Error",
        description: "Failed to move job",
        variant: "destructive",
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('delete-pipeline-entry', {
        body: { 
          entryId: jobId,
          entryType: 'job'
        }
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        toast({
          title: "Error",
          description: data.message || data.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: data.message || "Job deleted successfully",
      });

      // Remove the job from local state immediately
      const newPipelineData = { ...pipelineData };
      for (const [status, jobs] of Object.entries(newPipelineData)) {
        newPipelineData[status] = jobs.filter(job => job.id !== jobId);
      }
      setPipelineData(newPipelineData);

      // Refresh data to ensure consistency
      await fetchJobsData();

    } catch (error) {
      console.error('Error deleting job:', error);
      toast({
        title: "Error",
        description: "Failed to delete job",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (amount: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStageTotal = (stageKey: string) => {
    const jobs = pipelineData[stageKey] || [];
    // For now, we don't have project values, so return 0
    return 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading pipeline data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Jobs Pipeline
          </h1>
          <p className="text-muted-foreground">
            Manage jobs through the roofing production workflow
          </p>
        </div>
      </div>

      {/* Kanban Board with Horizontal Scrolling */}
      <DndContext 
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="w-full">
          <div className="flex gap-2 min-h-[600px] pb-4" style={{ minWidth: `${jobStages.length * 120}px` }}>
            {jobStages.map((stage) => {
              const stageJobs = pipelineData[stage.key] || [];
              const stageTotal = getStageTotal(stage.key);

              return (
                <div key={stage.key} className="flex-shrink-0 w-[112px]">
                  <KanbanColumn
                    id={stage.key}
                    title={stage.name}
                    color={stage.color}
                    icon={stage.icon}
                    count={stageJobs.length}
                    total={formatCurrency(stageTotal)}
                    items={stageJobs.map(job => job.id)}
                  >
                    {stageJobs.map((job) => (
                      <KanbanCard
                        key={job.id}
                        id={job.id}
                        entry={job}
                        onView={(contactId) => navigate(`/contact/${contactId}`)}
                        onDelete={handleDeleteJob}
                        canDelete={userCanDelete}
                      />
                    ))}
                  </KanbanColumn>
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeId ? (
            <div className="transform rotate-3 opacity-90">
              {/* Find the active entry and render it */}
              {Object.values(pipelineData).flat().map(entry => 
                entry.id === activeId ? (
                  <KanbanCard
                    key={entry.id}
                    id={entry.id}
                    entry={entry}
                    onView={() => {}}
                    isDragging={true}
                  />
                ) : null
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Empty State Message */}
      {Object.values(pipelineData).flat().length === 0 && (
        <div className="text-center p-8 bg-card rounded-lg border-2 border-dashed border-border mt-6">
          <Home className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Jobs Yet</h3>
          <p className="text-muted-foreground mb-4">
            Jobs are created from contacts. Visit the contacts page to create your first job.
          </p>
          <Button onClick={() => navigate('/contacts')}>
            <User className="h-4 w-4 mr-2" />
            Go to Contacts
          </Button>
        </div>
      )}


    </div>
  );
};

export default KanbanPipeline;