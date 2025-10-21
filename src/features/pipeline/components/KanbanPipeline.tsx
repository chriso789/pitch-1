import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
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

interface PipelineEntry {
  id: string;
  clj_formatted_number: string;
  contact_id: string;
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
  project?: {
    id: string;
    project_number: string;
  };
}

const KanbanPipeline = () => {
  const [pipelineData, setPipelineData] = useState<Record<string, PipelineEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userCanDelete, setUserCanDelete] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  const leadStages = [
    { name: "New Lead", key: "lead", color: "bg-blue-500", icon: User },
    { name: "Qualified", key: "qualified", color: "bg-green-500", icon: CheckCircle },
    { name: "Contingency Signed", key: "contingency_signed", color: "bg-yellow-500", icon: FileText },
    { name: "Legal Review", key: "legal_review", color: "bg-purple-500", icon: AlertCircle },
    { name: "Ready for Approval", key: "ready_for_approval", color: "bg-orange-500", icon: HourglassIcon },
    { name: "Approved/Project", key: "project", color: "bg-emerald-600", icon: CheckCircle }
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
      
      // Check if user can delete jobs (hierarchy-based permissions)
      const canDelete = profile?.role && ['master', 'corporate', 'office_admin'].includes(profile.role);
      setUserCanDelete(canDelete);
    }
  };

  const fetchJobsData = async () => {
    try {
      setLoading(true);
      
      // Fetch pipeline entries with contacts (exclude soft-deleted entries)
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          clj_formatted_number,
          contact_id,
          status,
          created_at,
          contacts!inner (
            id,
            contact_number,
            first_name,
            last_name,
            email,
            phone,
            address_street,
            address_city,
            address_state,
            address_zip
          ),
          projects!left (
            id,
            project_number,
            pipeline_entry_id
          )
        `)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (pipelineError) {
        console.error('Error fetching pipeline data:', pipelineError);
        toast({
          title: "Error",
          description: "Failed to load pipeline data",
          variant: "destructive",
        });
        return;
      }

      // If no pipeline entries, set empty state
      if (!pipelineData || pipelineData.length === 0) {
        const emptyData: Record<string, PipelineEntry[]> = {};
        leadStages.forEach(stage => {
          emptyData[stage.key] = [];
        });
        setPipelineData(emptyData);
        return;
      }

      // Transform data - contacts are already joined via !inner
      const combinedEntries: PipelineEntry[] = pipelineData.map(entry => ({
        id: entry.id,
        clj_formatted_number: entry.clj_formatted_number,
        contact_id: entry.contact_id,
        status: entry.status,
        created_at: entry.created_at,
        contacts: Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contacts,
        project: entry.projects ? (Array.isArray(entry.projects) ? entry.projects[0] : entry.projects) : undefined
      }));

      // Group data by status
      const groupedData: Record<string, PipelineEntry[]> = {};
      leadStages.forEach(stage => {
        groupedData[stage.key] = combinedEntries.filter(entry => entry.status === stage.key) || [];
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
    let newStatus = over.id as string;

    // VALIDATION: Check if over.id is a valid stage key
    const validStageKeys = leadStages.map(s => s.key);
    
    if (!validStageKeys.includes(newStatus)) {
      // over.id is not a stage key, it's a card ID - find which column it belongs to
      let foundStageKey: string | null = null;
      
      for (const [stageKey, jobs] of Object.entries(pipelineData)) {
        if (jobs.some(j => j.id === newStatus)) {
          foundStageKey = stageKey;
          break;
        }
      }
      
      if (!foundStageKey) {
        console.error('Could not determine target column for drop');
        toast({
          title: "Error",
          description: "Could not determine where to move the item",
          variant: "destructive",
        });
        return;
      }
      
      newStatus = foundStageKey;
    }

    // Find the entry being moved
    let movedEntry: PipelineEntry | null = null;
    let fromStatus = '';

    for (const [status, entries] of Object.entries(pipelineData)) {
      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        movedEntry = entry;
        fromStatus = status;
        break;
      }
    }

    if (!movedEntry) return;

    // Capture audit context before change
    await auditService.captureAuditContext();

    // Store original state for potential revert
    const originalPipelineData = { ...pipelineData };
    const originalFromJobs = [...pipelineData[fromStatus]];
    const originalToJobs = [...pipelineData[newStatus]];

    // Optimistically update UI
    const newPipelineData = { ...pipelineData };
    newPipelineData[fromStatus] = newPipelineData[fromStatus].filter(e => e.id !== entryId);
    newPipelineData[newStatus] = [...newPipelineData[newStatus], { ...movedEntry, status: newStatus }];
    setPipelineData(newPipelineData);

    // Log the change
    await auditService.logChange(
      'pipeline_entries',
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
        // Revert optimistic update using original state
        const revertedData = { ...originalPipelineData };
        revertedData[fromStatus] = originalFromJobs;
        revertedData[newStatus] = originalToJobs;
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
        description: data.message || "Pipeline entry moved successfully",
      });

      // Refresh data to ensure consistency
      await fetchJobsData();

    } catch (error) {
      console.error('Error moving pipeline entry:', error);
      
      // Revert optimistic update using original state
      const revertedData = { ...originalPipelineData };
      revertedData[fromStatus] = originalFromJobs;
      revertedData[newStatus] = originalToJobs;
      setPipelineData(revertedData);

      toast({
        title: "Error",
        description: "Failed to move pipeline entry",
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

      // Remove the entry from local state immediately
      const newPipelineData = { ...pipelineData };
      for (const [status, entries] of Object.entries(newPipelineData)) {
        newPipelineData[status] = entries.filter(entry => entry.id !== jobId);
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
    const entries = pipelineData[stageKey] || [];
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
            Leads Pipeline
          </h1>
          <p className="text-muted-foreground">
            Manage leads through the sales pipeline. Once approved, leads become jobs.
          </p>
        </div>
      </div>

      {/* Kanban Board with Horizontal Scrolling */}
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="w-full">
          <div className="flex gap-2 min-h-[600px] pb-4" style={{ minWidth: `${leadStages.length * 60}px` }}>
            {leadStages.map((stage) => {
              const stageEntries = pipelineData[stage.key] || [];
              const stageTotal = getStageTotal(stage.key);

              return (
                <div key={stage.key} className="flex-shrink-0 w-[56px]">
                  <KanbanColumn
                    id={stage.key}
                    title={stage.name}
                    color={stage.color}
                    icon={stage.icon}
                    count={stageEntries.length}
                    total={formatCurrency(stageTotal)}
                    items={stageEntries.map(entry => entry.id)}
                  >
                    {stageEntries.map((entry) => (
                      <KanbanCard
                        key={entry.id}
                        id={entry.id}
                        entry={entry}
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

        <DragOverlay dropAnimation={null}>
          {activeId ? (
            <div className="transform rotate-6 scale-110 shadow-2xl animate-fade-in">
              {/* Find the active entry and render it */}
              {Object.values(pipelineData).flat().map(entry => 
                entry.id === activeId ? (
                  <div className="bg-card border-2 border-primary rounded-lg shadow-2xl">
                    <KanbanCard
                      key={entry.id}
                      id={entry.id}
                      entry={entry}
                      onView={() => {}}
                      isDragging={true}
                    />
                  </div>
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
          <h3 className="text-lg font-semibold mb-2">No Leads Yet</h3>
          <p className="text-muted-foreground mb-4">
            Leads are created from contacts. Visit the contacts page to create your first lead.
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