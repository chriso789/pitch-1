import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { 
  FileText,
  Upload,
  CheckCircle,
  Clock,
  AlertCircle,
  Package,
  Truck,
  Wrench,
  ClipboardCheck,
  XCircle,
  ArrowRight,
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProductionWorkflowProps {
  projectId?: string;
  pipelineEntryId?: string;
}

const PRODUCTION_STAGES = [
  {
    key: 'submit_documents',
    name: 'Submit Documents to City',
    description: 'Upload required documents and submit permit application',
    icon: FileText,
    color: 'bg-blue-500',
    requirements: ['NOC uploaded', 'Permit application submitted']
  },
  {
    key: 'permit_submitted',
    name: 'Permit Submitted',
    description: 'Permit application has been submitted to the city',
    icon: Upload,
    color: 'bg-yellow-500'
  },
  {
    key: 'permit_approved',
    name: 'Permit Approved',
    description: 'City has approved the permit',
    icon: CheckCircle,
    color: 'bg-green-500'
  },
  {
    key: 'materials_ordered',
    name: 'Materials Ordered',
    description: 'All materials have been ordered from suppliers',
    icon: Package,
    color: 'bg-purple-500'
  },
  {
    key: 'materials_on_hold',
    name: 'Materials On Hold',
    description: 'Materials are ready but waiting for delivery window',
    icon: Clock,
    color: 'bg-orange-500'
  },
  {
    key: 'materials_delivered',
    name: 'Materials Delivered',
    description: 'All materials have been delivered to job site',
    icon: Truck,
    color: 'bg-indigo-500'
  },
  {
    key: 'in_progress',
    name: 'In Progress',
    description: 'Work is actively being performed',
    icon: Wrench,
    color: 'bg-blue-600'
  },
  {
    key: 'complete',
    name: 'Complete',
    description: 'All work has been completed',
    icon: CheckCircle,
    color: 'bg-green-600'
  },
  {
    key: 'final_inspection',
    name: 'Final Inspection',
    description: 'Final inspection by city/authority',
    icon: ClipboardCheck,
    color: 'bg-teal-500'
  },
  {
    key: 'final_check_needed',
    name: 'Final Check Needed',
    description: 'Internal final quality check required',
    icon: AlertCircle,
    color: 'bg-amber-500'
  },
  {
    key: 'closed',
    name: 'Closed',
    description: 'Project is fully completed and closed',
    icon: XCircle,
    color: 'bg-gray-500'
  }
];

export const ProductionWorkflow: React.FC<ProductionWorkflowProps> = ({
  projectId,
  pipelineEntryId
}) => {
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (projectId || pipelineEntryId) {
      fetchWorkflow();
    }
  }, [projectId, pipelineEntryId]);

  const fetchWorkflow = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('production_workflows')
        .select(`
          *,
          projects (
            id,
            name,
            pipeline_entry_id
          )
        `);

      if (projectId) {
        query = query.eq('project_id', projectId);
      } else if (pipelineEntryId) {
        query = query.eq('pipeline_entry_id', pipelineEntryId);
      }

      const { data, error } = await query.single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching workflow:', error);
        toast({
          title: "Error",
          description: "Failed to load production workflow",
          variant: "destructive",
        });
        return;
      }

      setWorkflow(data);
    } catch (error) {
      console.error('Error in fetchWorkflow:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateWorkflowStage = async (newStage: string) => {
    if (!workflow) return;

    try {
      setUpdating(true);

      const { error } = await supabase
        .from('production_workflows')
        .update({ 
          current_stage: newStage,
          updated_at: new Date().toISOString()
        })
        .eq('id', workflow.id);

      if (error) {
        toast({
          title: "Error",
          description: error.message || "Failed to update production stage",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: `Production stage updated to ${PRODUCTION_STAGES.find(s => s.key === newStage)?.name}`,
      });

      await fetchWorkflow();
    } catch (error) {
      console.error('Error updating workflow stage:', error);
      toast({
        title: "Error",
        description: "Failed to update production stage",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const updateRequirement = async (field: string, value: boolean) => {
    if (!workflow) return;

    try {
      const { error } = await supabase
        .from('production_workflows')
        .update({ 
          [field]: value,
          updated_at: new Date().toISOString()
        })
        .eq('id', workflow.id);

      if (error) {
        toast({
          title: "Error",
          description: "Failed to update requirement",
          variant: "destructive",
        });
        return;
      }

      await fetchWorkflow();
    } catch (error) {
      console.error('Error updating requirement:', error);
    }
  };

  const getCurrentStageIndex = () => {
    return PRODUCTION_STAGES.findIndex(stage => stage.key === workflow?.current_stage);
  };

  const getNextStage = () => {
    const currentIndex = getCurrentStageIndex();
    return currentIndex < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[currentIndex + 1] : null;
  };

  const canAdvanceFromSubmitDocuments = () => {
    return workflow?.noc_uploaded && workflow?.permit_application_submitted;
  };

  const canAdvanceStage = () => {
    if (workflow?.current_stage === 'submit_documents') {
      return canAdvanceFromSubmitDocuments();
    }
    return true; // For other stages, allow advancement
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading production workflow...</span>
      </div>
    );
  }

  if (!workflow) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <div className="text-muted-foreground">
            No production workflow found. This will be created automatically when a pipeline entry moves to "Project" status.
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentStageIndex = getCurrentStageIndex();
  const progress = ((currentStageIndex + 1) / PRODUCTION_STAGES.length) * 100;
  const nextStage = getNextStage();

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Production Workflow</span>
            <Badge variant="outline">
              Stage {currentStageIndex + 1} of {PRODUCTION_STAGES.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Overall Progress</span>
                <span className="text-sm font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Stage Details */}
      {PRODUCTION_STAGES.map((stage, index) => {
        const isActive = stage.key === workflow.current_stage;
        const isCompleted = index < currentStageIndex;
        const isPending = index > currentStageIndex;

        return (
          <Card key={stage.key} className={isActive ? 'ring-2 ring-primary' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isCompleted ? 'bg-green-500' : 
                  isActive ? stage.color : 
                  'bg-gray-300'
                }`}>
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5 text-white" />
                  ) : (
                    <stage.icon className="h-5 w-5 text-white" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {stage.name}
                    {isActive && <Badge>Current</Badge>}
                    {isCompleted && <Badge variant="secondary">Completed</Badge>}
                    {isPending && <Badge variant="outline">Pending</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground font-normal">
                    {stage.description}
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            
            {isActive && (
              <CardContent>
                {/* Submit Documents Stage Requirements */}
                {stage.key === 'submit_documents' && (
                  <div className="space-y-4 mb-4">
                    <div className="text-sm font-medium">Required Documents:</div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="noc_uploaded"
                        checked={workflow.noc_uploaded}
                        onCheckedChange={(checked) => 
                          updateRequirement('noc_uploaded', checked as boolean)
                        }
                      />
                      <label htmlFor="noc_uploaded" className="text-sm">
                        Recorded NOC uploaded to Documents area
                      </label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="permit_app_submitted"
                        checked={workflow.permit_application_submitted}
                        onCheckedChange={(checked) => 
                          updateRequirement('permit_application_submitted', checked as boolean)
                        }
                      />
                      <label htmlFor="permit_app_submitted" className="text-sm">
                        Permit application submitted
                      </label>
                    </div>

                    {!canAdvanceFromSubmitDocuments() && (
                      <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
                        <AlertCircle className="h-4 w-4 inline mr-2" />
                        Both requirements must be completed before advancing to the next stage.
                      </div>
                    )}
                  </div>
                )}

                {/* Advance Button */}
                {nextStage && (
                  <Button
                    onClick={() => updateWorkflowStage(nextStage.key)}
                    disabled={updating || !canAdvanceStage()}
                    className="w-full"
                  >
                    {updating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4 mr-2" />
                    )}
                    Advance to {nextStage.name}
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};