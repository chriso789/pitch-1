import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { LeadForm } from './LeadForm';
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

interface PipelineEntry {
  id: string;
  contact_id: string;
  status: string;
  priority: string;
  estimated_value: number;
  lead_quality_score: number;
  roof_type: string;
  source: string;
  created_at: string;
  contacts: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  };
  estimates: Array<{
    id: string;
    estimate_number: string;
    selling_price: number;
    status: string;
    actual_margin_percent: number;
  }>;
  profiles: {
    first_name: string;
    last_name: string;
  };
}

const KanbanPipeline = () => {
  const [pipelineData, setPipelineData] = useState<Record<string, PipelineEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const pipelineStages = [
    { name: "Lead", key: "lead", color: "bg-status-lead", icon: User },
    { name: "Legal", key: "legal_review", color: "bg-status-legal", icon: FileText },
    { name: "Contingency", key: "contingency_signed", color: "bg-status-contingency", icon: AlertCircle },
    { name: "Hold (Mgr Review)", key: "hold_mgr_review", color: "bg-amber-500", icon: HourglassIcon },
    { name: "Project", key: "project", color: "bg-status-project", icon: Home },
    { name: "Completed", key: "completed", color: "bg-status-completed", icon: CheckCircle },
    { name: "Closed", key: "closed", color: "bg-status-closed", icon: Clock }
  ];

  useEffect(() => {
    getCurrentUser();
    fetchPipelineData();
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
    }
  };

  const fetchPipelineData = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
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
          estimates (
            id,
            estimate_number,
            selling_price,
            status,
            actual_margin_percent,
            created_at
          ),
          profiles!pipeline_entries_assigned_to_fkey (
            first_name,
            last_name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching pipeline data:', error);
        toast({
          title: "Error",
          description: "Failed to load pipeline data",
          variant: "destructive",
        });
        return;
      }

      // Group data by status - entries without contacts are already filtered out by inner join
      const groupedData: Record<string, PipelineEntry[]> = {};
      
      pipelineStages.forEach(stage => {
        groupedData[stage.key] = data?.filter(entry => entry.status === stage.key) || [];
      });

      setPipelineData(groupedData);
    } catch (error) {
      console.error('Error in fetchPipelineData:', error);
      toast({
        title: "Error",
        description: "Failed to load pipeline data",
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

    // Optimistically update UI
    const newPipelineData = { ...pipelineData };
    newPipelineData[fromStatus] = newPipelineData[fromStatus].filter(e => e.id !== entryId);
    newPipelineData[newStatus] = [...newPipelineData[newStatus], { ...movedEntry, status: newStatus }];
    setPipelineData(newPipelineData);

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
        revertedData[newStatus] = revertedData[newStatus].filter(e => e.id !== entryId);
        revertedData[fromStatus] = [...revertedData[fromStatus], movedEntry];
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

      if (data.autoApprovalCreated) {
        toast({
          title: "Approval Requested",
          description: "Your request has been submitted for manager approval",
        });
      }

      // Refresh data to ensure consistency
      await fetchPipelineData();

    } catch (error) {
      console.error('Error moving pipeline entry:', error);
      
      // Revert optimistic update
      const revertedData = { ...pipelineData };
      revertedData[newStatus] = revertedData[newStatus].filter(e => e.id !== entryId);
      revertedData[fromStatus] = [...revertedData[fromStatus], movedEntry];
      setPipelineData(revertedData);

      toast({
        title: "Error",
        description: "Failed to move pipeline entry",
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
    return entries.reduce((sum, entry) => {
      const estimate = entry.estimates?.[0];
      return sum + (estimate?.selling_price || entry.estimated_value || 0);
    }, 0);
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
            Sales Pipeline
          </h1>
          <p className="text-muted-foreground">
            Drag and drop leads through the roofing sales process
          </p>
        </div>
        <Button className="gradient-primary" onClick={() => setShowLeadForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Lead
        </Button>
      </div>

      {/* Kanban Board */}
      <DndContext 
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-6 min-h-[600px]">
          {pipelineStages.map((stage) => {
            const stageEntries = pipelineData[stage.key] || [];
            const stageTotal = getStageTotal(stage.key);

            return (
              <KanbanColumn
                key={stage.key}
                id={stage.key}
                title={stage.name}
                color={stage.color}
                icon={stage.icon}
                count={stageEntries.length}
                total={formatCurrency(stageTotal)}
              >
                <SortableContext 
                  items={stageEntries.map(entry => entry.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {stageEntries.map((entry) => (
                    <KanbanCard
                      key={entry.id}
                      id={entry.id}
                      entry={entry}
                      onView={(contactId) => navigate(`/contact/${contactId}`)}
                    />
                  ))}
                </SortableContext>
              </KanbanColumn>
            );
          })}
        </div>

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

      {/* Lead Form Dialog */}
      <LeadForm 
        open={showLeadForm} 
        onOpenChange={setShowLeadForm}
        onLeadCreated={() => {
          fetchPipelineData();
        }}
      />
    </div>
  );
};

export default KanbanPipeline;