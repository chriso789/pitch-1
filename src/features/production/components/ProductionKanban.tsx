import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ProductionColumn } from './ProductionColumn';
import { ProductionCard } from './ProductionCard';
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  FileText,
  Clock,
  Package,
  Wrench,
  CheckCircle,
  Trophy,
  Search,
  Archive,
  Loader2,
  Home,
  Receipt,
  AlertCircle,
  Ruler,
  PenTool,
  Camera
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useQuery } from "@tanstack/react-query";
import { FinalInspectionCostDialog } from "@/components/production/FinalInspectionCostDialog";

interface ProductionProject {
  id: string;
  name: string;
  project_number: string;
  customer_name: string;
  customer_address: string;
  contract_value: number;
  amount_paid: number;
  balance_owed: number;
  stage: string;
  days_in_stage: number;
  created_at: string;
  pipeline_entry_id?: string;
  contacts?: {
    id: string;
    first_name: string;
    last_name: string;
    address_street: string;
    address_city: string;
  };
  estimates?: {
    selling_price: number;
  }[];
  payments?: {
    amount: number;
  }[];
}

const ProductionKanban = () => {
  const [productionData, setProductionData] = useState<Record<string, ProductionProject[]>>({});
  const [stages, setStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [costDialogProject, setCostDialogProject] = useState<ProductionProject | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Fetch FINANCIAL metrics
  const { data: financialWorksheetsNeeded = 0 } = useQuery({
    queryKey: ['production-financial-worksheets'],
    queryFn: async () => {
      const { data: entries } = await supabase
        .from('pipeline_entries')
        .select('id')
        .in('status', ['project', 'production']);
      
      if (!entries?.length) return 0;
      
      const { data: documents } = await supabase
        .from('documents')
        .select('pipeline_entry_id')
        .in('pipeline_entry_id', entries.map(e => e.id))
        .ilike('document_type', '%financial%');
      
      const entriesWithWorksheets = new Set(documents?.map(d => d.pipeline_entry_id) || []);
      return entries.length - entriesWithWorksheets.size;
    }
  });

  const { data: pendingInvoices = 0 } = useQuery({
    queryKey: ['production-pending-invoices'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .in('status', ['project', 'production', 'completed']);
      const pending = data?.filter(entry => {
        const metadata = entry.metadata as any;
        return metadata?.invoice_status === 'pending' || 
          (metadata?.invoice_sent === true && !metadata?.invoice_paid);
      }) || [];
      return pending.length;
    }
  });

  const { data: overdueInvoices = 0 } = useQuery({
    queryKey: ['production-overdue-invoices'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .in('status', ['project', 'production', 'completed']);
      const now = new Date();
      const overdue = data?.filter(entry => {
        const metadata = entry.metadata as any;
        const dueDate = metadata?.invoice_due_date;
        return dueDate && new Date(dueDate) < now && !metadata?.invoice_paid;
      }) || [];
      return overdue.length;
    }
  });

  const { data: canceledJobs = 0 } = useQuery({
    queryKey: ['production-canceled-jobs'],
    queryFn: async () => {
      const { count } = await supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'cancelled');
      return count || 0;
    }
  });

  // Fetch MANAGEMENT metrics
  const { data: materialOrders = 0 } = useQuery({
    queryKey: ['production-material-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .in('status', ['project', 'production']);
      const needsOrders = data?.filter(entry => {
        const metadata = entry.metadata as any;
        return metadata?.materials_ordered !== true;
      }) || [];
      return needsOrders.length;
    }
  });

  const { data: measurementRequests = 0 } = useQuery({
    queryKey: ['production-measurement-requests'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .in('status', ['estimate', 'negotiating']);
      const needsMeasurement = data?.filter(entry => {
        const metadata = entry.metadata as any;
        return metadata?.measurement_requested === true || metadata?.needs_measurement === true;
      }) || [];
      return needsMeasurement.length;
    }
  });

  const { data: pendingSignatures = 0 } = useQuery({
    queryKey: ['production-pending-signatures'],
    queryFn: async () => {
      const { count } = await supabase
        .from('agreement_instances')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent')
        .is('completed_at', null);
      return count || 0;
    }
  });

  const { data: photosToday = 0 } = useQuery({
    queryKey: ['production-photos-today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { count } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .ilike('mime_type', 'image%');
      return count || 0;
    }
  });

  const defaultStages = [
    { stage_key: "submit_documents", name: "Submit Documents", color: "#ef4444", icon: FileText, sort_order: 1 },
    { stage_key: "permit_processing", name: "Permit Processing", color: "#f97316", icon: Clock, sort_order: 2 },
    { stage_key: "materials_labor", name: "Materials & Labor", color: "#eab308", icon: Package, sort_order: 3 },
    { stage_key: "in_progress", name: "In Progress", color: "#3b82f6", icon: Wrench, sort_order: 4 },
    { stage_key: "quality_control", name: "Quality Control", color: "#8b5cf6", icon: CheckCircle, sort_order: 5 },
    { stage_key: "project_complete", name: "Project Complete", color: "#10b981", icon: Trophy, sort_order: 6 },
    { stage_key: "final_inspection", name: "Final Inspection", color: "#06b6d4", icon: Search, sort_order: 7 },
    { stage_key: "closed", name: "Closed", color: "#6b7280", icon: Archive, sort_order: 8 }
  ];

  useEffect(() => {
    initializeStages();
  }, []);

  useEffect(() => {
    if (stages.length > 0) {
      fetchProductionData();
    }
  }, [stages]);

  // Set up real-time listeners for production workflow changes
  useEffect(() => {
    const channel = supabase
      .channel('production-workflow-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_workflows'
        },
        () => {
          // Refetch data when any production workflow changes
          fetchProductionData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const initializeStages = async () => {
    try {
      // Try to fetch existing stages
      const { data: existingStages, error } = await supabase
        .from('production_stages')
        .select('*')
        .order('sort_order');

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error fetching stages:', error);
      }

      if (!existingStages || existingStages.length === 0) {
        // Create default stages with tenant_id
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();

        if (!profile?.tenant_id) return;

        // Use upsert with ON CONFLICT to prevent duplicate insert issues
        const { data: newStages, error: insertError } = await supabase
          .from('production_stages')
          .upsert(
            defaultStages.map(stage => ({
              tenant_id: profile.tenant_id,
              name: stage.name,
              stage_key: stage.stage_key,
              sort_order: stage.sort_order,
              color: stage.color,
              icon: stage.icon.name
            })),
            { onConflict: 'tenant_id,stage_key', ignoreDuplicates: true }
          )
          .select();

        if (insertError) {
          console.error('Error creating default stages:', insertError);
          setStages(defaultStages);
        } else {
          setStages(newStages);
        }
      } else {
        // Map existing stages to include icons
        const mappedStages = existingStages.map(stage => {
          const defaultStage = defaultStages.find(ds => ds.stage_key === stage.stage_key);
          return {
            ...stage,
            icon: defaultStage?.icon || FileText
          };
        });
        setStages(mappedStages);
      }
    } catch (error) {
      console.error('Error initializing stages:', error);
      setStages(defaultStages);
    }
  };

  const fetchProductionData = async () => {
    try {
      setLoading(true);

      // Fetch projects with related data using explicit foreign key relationships
      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates(*),
          payments(*)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch production workflows separately
      let workflowsMap: Record<string, any> = {};
      if (projectsData && projectsData.length > 0) {
        const projectIds = projectsData.map((p: any) => p.id);
        const { data: workflows } = await supabase
          .from('production_workflows')
          .select('*')
          .in('project_id', projectIds);
        
        if (workflows) {
          workflows.forEach((workflow: any) => {
            workflowsMap[workflow.project_id] = workflow;
          });
        }
      }

      // Create workflows for projects that don't have them
      if (projectsData) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();

          if (profile?.tenant_id) {
            const projectsWithoutWorkflows = projectsData.filter(
              (p: any) => !workflowsMap[p.id]
            );

            for (const project of projectsWithoutWorkflows) {
              try {
                // Use upsert with onConflict to prevent duplicate key errors
                const { data: workflow } = await supabase
                  .from('production_workflows')
                  .upsert({
                    tenant_id: profile.tenant_id,
                    project_id: project.id,
                    pipeline_entry_id: project.pipeline_entry_id,
                    current_stage: 'submit_documents',
                  }, { onConflict: 'project_id,tenant_id' })
                  .select()
                  .single();

                if (workflow) {
                  // Add workflow to map
                  workflowsMap[project.id] = workflow;
                  
                  // Only create history if this is a new workflow
                  const { data: existingHistory } = await supabase
                    .from('production_stage_history')
                    .select('id')
                    .eq('production_workflow_id', workflow.id)
                    .limit(1);
                  
                  if (!existingHistory?.length) {
                    await supabase
                      .from('production_stage_history')
                      .insert({
                        tenant_id: profile.tenant_id,
                        production_workflow_id: workflow.id,
                        to_stage: 'submit_documents',
                        notes: 'Production workflow auto-created',
                      });
                  }
                }
              } catch (err) {
                console.error('Error creating workflow:', err);
              }
            }
          }
        }
      }

      // Transform data into production format
      const productionProjects: ProductionProject[] = (projectsData || []).map((project: any) => {
        const contact = project.pipeline_entries?.contacts;
        const estimates = project.estimates || [];
        const payments = project.payments || [];
        const workflow = workflowsMap[project.id];
        
        const totalPaid = payments.reduce((sum: number, payment: any) => 
          sum + Number(payment.amount), 0);
        const contractValue = estimates.length > 0 ? Number(estimates[0].selling_price) : 0;
        const balanceOwed = contractValue - totalPaid;
        
        const createdDate = new Date(project.created_at);
        const daysInStage = Math.floor(
          (new Date().getTime() - createdDate.getTime()) / (1000 * 3600 * 24)
        );

        return {
          id: project.id,
          name: project.name || 'Untitled Project',
          project_number: project.project_number || '',
          customer_name: contact ? `${contact.first_name} ${contact.last_name}` : 'Unknown',
          customer_address: contact ? `${contact.address_street}, ${contact.address_city}` : 'Unknown',
          contract_value: contractValue,
          amount_paid: totalPaid,
          balance_owed: balanceOwed,
          stage: workflow?.current_stage || 'submit_documents', // Default to submit_documents if no workflow
          days_in_stage: daysInStage,
          created_at: project.created_at,
          pipeline_entry_id: project.pipeline_entry_id,
          contacts: contact,
          estimates,
          payments
        };
      });

      // Deduplicate projects by ID to prevent duplicate cards
      const uniqueProjects = productionProjects.reduce((acc, project) => {
        if (!acc.find(p => p.id === project.id)) {
          acc.push(project);
        }
        return acc;
      }, [] as ProductionProject[]);

      // Group by stage using deduplicated projects
      const groupedData: Record<string, ProductionProject[]> = {};
      stages.forEach(stage => {
        groupedData[stage.stage_key] = uniqueProjects.filter(
          project => project.stage === stage.stage_key
        );
      });

      setProductionData(groupedData);
    } catch (error) {
      console.error('Error fetching production data:', error);
      toast({
        title: "Error",
        description: "Failed to load production data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const projectId = active.id as string;
    const newStage = over.id as string;

    // Find the project being moved
    let movedProject: ProductionProject | null = null;
    let fromStage = '';

    for (const [stage, projects] of Object.entries(productionData)) {
      const project = projects.find(p => p.id === projectId);
      if (project) {
        movedProject = project;
        fromStage = stage;
        break;
      }
    }

    if (!movedProject) return;

    // Optimistically update UI
    const newProductionData = { ...productionData };
    newProductionData[fromStage] = newProductionData[fromStage].filter(p => p.id !== projectId);
    newProductionData[newStage] = [...newProductionData[newStage], { ...movedProject, stage: newStage }];
    setProductionData(newProductionData);

    try {
      // Get user tenant_id for the workflow update
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No authenticated user found');
        throw new Error('You must be logged in to move projects');
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_id, role')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        throw new Error('Could not verify your permissions');
      }

      if (!profile?.tenant_id) {
        console.error('User has no tenant_id');
        throw new Error('Your account is not properly configured');
      }

      // Log the move attempt for debugging
      console.log(`[ProductionKanban] User ${user.id} (role: ${profile.role}) moving project ${projectId} from ${fromStage} to ${newStage}`);

      // Update production workflow stage with proper onConflict to prevent duplicate key errors
      const { error } = await supabase
        .from('production_workflows')
        .upsert({
          tenant_id: profile.tenant_id,
          project_id: projectId,
          pipeline_entry_id: movedProject.pipeline_entry_id,
          current_stage: newStage,
          stage_changed_at: new Date().toISOString()
        }, { onConflict: 'project_id,tenant_id' });

      if (error) {
        console.error('Production workflow update failed:', error);
        console.error('User role:', profile.role, 'Tenant:', profile.tenant_id);
        throw error;
      }

      // Also update the job status to match the production stage
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update({ 
          status: newStage === 'closed' ? 'closed' : 'production',
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId);

      if (jobUpdateError) {
        console.error('Error updating job status:', jobUpdateError);
      }

      toast({
        title: "Success",
        description: `Project moved to ${stages.find(s => s.stage_key === newStage)?.name}`,
      });

      // Show cost verification dialog when moving to final_inspection
      if (newStage === 'final_inspection') {
        setCostDialogProject(movedProject);
        setCostDialogOpen(true);
      }

      // Refresh data
      await fetchProductionData();
    } catch (error: any) {
      console.error('Error moving project:', error);
      
      // Revert optimistic update
      const revertedData = { ...productionData };
      revertedData[newStage] = revertedData[newStage].filter(p => p.id !== projectId);
      revertedData[fromStage] = [...revertedData[fromStage], movedProject];
      setProductionData(revertedData);

      toast({
        title: "Error",
        description: error.message || "Failed to move project. Please check your permissions.",
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
    const projects = productionData[stageKey] || [];
    return projects.reduce((sum, project) => sum + project.contract_value, 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading production data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Production Tracking
          </h1>
          <p className="text-muted-foreground">
            Monitor and manage active construction projects
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button 
            onClick={fetchProductionData} 
            disabled={loading}
            variant="outline"
            size="sm"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {Object.values(productionData).flat().length} active projects
            </span>
          </div>
        </div>
      </div>

      {/* Job Action Items */}
      <div className="space-y-6">
        {/* FINANCIAL Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground tracking-wide">FINANCIAL</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Financial Worksheets Needed"
              count={financialWorksheetsNeeded}
              icon={FileText}
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Pending Invoices"
              count={pendingInvoices}
              icon={Receipt}
              variant="warning"
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Overdue Invoices"
              count={overdueInvoices}
              icon={Clock}
              variant="danger"
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Canceled Jobs w/ Outstanding Balance"
              count={canceledJobs}
              icon={AlertCircle}
              variant="danger"
              onClick={() => navigate('/pipeline')}
            />
          </div>
        </div>

        {/* MANAGEMENT Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground tracking-wide">MANAGEMENT</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Material Orders to Place"
              count={materialOrders}
              icon={Package}
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Measurement Requests"
              count={measurementRequests}
              icon={Ruler}
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Pending Signatures"
              count={pendingSignatures}
              icon={PenTool}
              variant="warning"
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Photos Today"
              count={photosToday}
              icon={Camera}
              onClick={() => navigate('/pipeline')}
            />
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext 
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="w-full">
          <div className="flex gap-6 min-h-[600px] pb-4" style={{ minWidth: `${stages.length * 280}px` }}>
            {stages.filter((stage, index, self) => 
              index === self.findIndex(s => s.stage_key === stage.stage_key)
            ).map((stage) => {
              const stageProjects = productionData[stage.stage_key] || [];
              const stageTotal = getStageTotal(stage.stage_key);

              return (
                <div key={stage.stage_key} className="flex-shrink-0 w-[260px]">
                  <ProductionColumn
                    id={stage.stage_key}
                    title={stage.name}
                    color={stage.color}
                    icon={stage.icon}
                    count={stageProjects.length}
                    total={formatCurrency(stageTotal)}
                  >
                    <SortableContext 
                      items={stageProjects.map(project => project.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {stageProjects.map((project) => (
                        <ProductionCard
                          key={`project-${project.id}`}
                          id={project.id}
                          project={project}
                          onView={(contactId) => navigate(`/contact/${contactId}`)}
                        />
                      ))}
                    </SortableContext>
                  </ProductionColumn>
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeId ? (
            <div className="transform rotate-3 opacity-90">
              {Object.values(productionData).flat().map(project => 
                project.id === activeId ? (
                  <ProductionCard
                    key={project.id}
                    id={project.id}
                    project={project}
                    onView={() => {}}
                    isDragging={true}
                  />
                ) : null
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Empty State */}
      {Object.values(productionData).flat().length === 0 && (
        <div className="text-center p-8 bg-card rounded-lg border-2 border-dashed border-border mt-6">
          <Home className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Projects in Production</h3>
          <p className="text-muted-foreground mb-4">
            Projects appear here when estimates are approved and move to production.
          </p>
          <Button onClick={() => navigate('/estimates')}>
            <FileText className="h-4 w-4 mr-2" />
            View Estimates
          </Button>
        </div>
      )}

      {/* Cost Verification Dialog */}
      <FinalInspectionCostDialog
        open={costDialogOpen}
        onOpenChange={setCostDialogOpen}
        projectId={costDialogProject?.id || ''}
        projectName={costDialogProject?.name || costDialogProject?.project_number}
      />
    </div>
  );
};

export default ProductionKanban;