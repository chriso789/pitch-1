import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { PipelineSkeleton } from './PipelineSkeleton';
import { 
  AlertCircle,
  CheckCircle,
  FileText,
  User,
  Home,
  HourglassIcon,
  CircleDot,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { auditService } from "@/services/auditService";
import { usePipelineData, type PipelineEntry } from '@/hooks/usePipelineData';

// Default icon for stages without a specific icon
const DefaultStageIcon = CircleDot;

const KanbanPipeline = () => {
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Use React Query cached data with dynamic stages
  const { 
    entries, 
    groupedData, 
    stages, // Dynamic stages from database
    isLoading, 
    userCanDelete,
    updateEntryStatus,
    revertEntryStatus,
    removeEntry,
    refetch 
  } = usePipelineData();

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

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
    const validStageKeys = stages.map(s => s.key);
    
    if (!validStageKeys.includes(newStatus)) {
      // over.id is not a stage key, it's a card ID - find which column it belongs to
      let foundStageKey: string | null = null;
      
      for (const [stageKey, jobs] of Object.entries(groupedData)) {
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
    const movedEntry = entries.find(e => e.id === entryId);
    if (!movedEntry) return;
    
    const fromStatus = movedEntry.status;

    // Capture audit context before change
    await auditService.captureAuditContext();

    // Optimistically update UI via React Query cache
    updateEntryStatus(entryId, fromStatus, newStatus);

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
        // Revert optimistic update
        revertEntryStatus(entryId, fromStatus);

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

    } catch (error) {
      console.error('Error moving pipeline entry:', error);
      
      // Revert optimistic update
      revertEntryStatus(entryId, fromStatus);

      toast({
        title: "Error",
        description: "Failed to move pipeline entry",
        variant: "destructive",
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      // Optimistically remove from UI
      removeEntry(jobId);

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
        // Revert by refetching
        refetch();
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

    } catch (error) {
      console.error('Error deleting job:', error);
      // Revert by refetching
      refetch();
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

  if (isLoading) {
    return <PipelineSkeleton />;
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
          <div className="flex gap-2 min-h-[600px] pb-4" style={{ minWidth: `${stages.length * 60}px` }}>
            {stages.map((stage) => {
              const stageEntries = groupedData[stage.key] || [];

              return (
                <div key={stage.key} className="flex-shrink-0 w-[56px]">
                  <KanbanColumn
                    id={stage.key}
                    title={stage.name}
                    color={stage.color}
                    icon={DefaultStageIcon}
                    count={stageEntries.length}
                    total={formatCurrency(0)}
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
              {entries.find(e => e.id === activeId) && (
                <div className="bg-card border-2 border-primary rounded-lg shadow-2xl">
                  <KanbanCard
                    id={activeId}
                    entry={entries.find(e => e.id === activeId)!}
                    onView={() => {}}
                    isDragging={true}
                  />
                </div>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Empty State Message */}
      {entries.length === 0 && (
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