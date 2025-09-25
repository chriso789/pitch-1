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
  Home
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

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
  const { toast } = useToast();
  const navigate = useNavigate();

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
    fetchProductionData();
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

        const { data: newStages, error: insertError } = await supabase
          .from('production_stages')
          .insert(defaultStages.map(stage => ({
            tenant_id: profile.tenant_id,
            name: stage.name,
            stage_key: stage.stage_key,
            sort_order: stage.sort_order,
            color: stage.color,
            icon: stage.icon.name
          })))
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

      // Fetch projects with related data
      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates(*),
          payments(*),
          production_workflows(*)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Transform data into production format
      const productionProjects: ProductionProject[] = (projectsData || []).map((project: any) => {
        const contact = project.pipeline_entries?.contacts;
        const estimates = project.estimates || [];
        const payments = project.payments || [];
        const workflow = project.production_workflows?.[0];
        
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
          stage: workflow?.current_stage || 'submit_documents',
          days_in_stage: daysInStage,
          created_at: project.created_at,
          pipeline_entry_id: project.pipeline_entry_id,
          contacts: contact,
          estimates,
          payments
        };
      });

      // Group by stage
      const groupedData: Record<string, ProductionProject[]> = {};
      stages.forEach(stage => {
        groupedData[stage.stage_key] = productionProjects.filter(
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
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      // Update production workflow stage
      const { error } = await supabase
        .from('production_workflows')
        .upsert({
          tenant_id: profile.tenant_id,
          project_id: projectId,
          pipeline_entry_id: movedProject.pipeline_entry_id,
          current_stage: newStage,
          stage_changed_at: new Date().toISOString()
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Project moved to ${stages.find(s => s.stage_key === newStage)?.name}`,
      });

      // Refresh data
      await fetchProductionData();
    } catch (error) {
      console.error('Error moving project:', error);
      
      // Revert optimistic update
      const revertedData = { ...productionData };
      revertedData[newStage] = revertedData[newStage].filter(p => p.id !== projectId);
      revertedData[fromStage] = [...revertedData[fromStage], movedProject];
      setProductionData(revertedData);

      toast({
        title: "Error",
        description: "Failed to move project",
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
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {Object.values(productionData).flat().length} active projects
          </span>
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
            {stages.map((stage, index) => {
              const stageProjects = productionData[stage.stage_key] || [];
              const stageTotal = getStageTotal(stage.stage_key);

              return (
                <div key={`stage-${stage.stage_key}-${index}`} className="flex-shrink-0 w-[260px]">
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
    </div>
  );
};

export default ProductionKanban;