import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Check, Clock, AlertCircle, ArrowRight, Loader2 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow, differenceInDays } from 'date-fns';

interface ProductionTimelineProps {
  projectId: string;
}

interface StageHistory {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  changed_by: string;
  notes: string | null;
}

const productionStages = [
  { key: 'submit_documents', label: 'Submit Documents', color: '#ef4444' },
  { key: 'permit_processing', label: 'Permit Processing', color: '#f97316' },
  { key: 'materials_labor', label: 'Materials & Labor', color: '#eab308' },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6' },
  { key: 'quality_control', label: 'Quality Control', color: '#8b5cf6' },
  { key: 'project_complete', label: 'Project Complete', color: '#10b981' },
  { key: 'final_inspection', label: 'Final Inspection', color: '#06b6d4' },
  { key: 'closed', label: 'Closed', color: '#6b7280' }
];

export const ProductionTimeline = ({ projectId }: ProductionTimelineProps) => {
  const [currentStage, setCurrentStage] = useState<string>('submit_documents');
  const [stageHistory, setStageHistory] = useState<StageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    fetchProductionData();
  }, [projectId]);

  const fetchProductionData = async () => {
    try {
      // Fetch current workflow
      const { data: workflow, error: workflowError } = await supabase
        .from('production_workflows')
        .select('id, current_stage')
        .eq('project_id', projectId)
        .maybeSingle();

      if (workflowError) throw workflowError;
      
      if (workflow) {
        setCurrentStage(workflow.current_stage);
      }

      // Fetch stage history
      const { data: history, error: historyError } = await supabase
        .from('production_stage_history')
        .select('*')
        .eq('production_workflow_id', workflow?.id)
        .order('changed_at', { ascending: true });

      if (historyError) throw historyError;
      
      setStageHistory(history || []);
    } catch (error) {
      console.error('Error fetching production data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceJob = async () => {
    const currentIndex = productionStages.findIndex(s => s.key === currentStage);
    if (currentIndex === productionStages.length - 1) {
      toast({
        title: "Already at final stage",
        description: "This job is already closed.",
      });
      return;
    }

    const nextStage = productionStages[currentIndex + 1];
    
    setAdvancing(true);
    try {
      const { error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'advance_stage',
          projectId: projectId,
          toStage: nextStage.key
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Advanced to ${nextStage.label}`,
      });

      await fetchProductionData();
    } catch (error) {
      console.error('Error advancing job:', error);
      toast({
        title: "Error",
        description: "Failed to advance job stage",
        variant: "destructive"
      });
    } finally {
      setAdvancing(false);
    }
  };

  const getStageStatus = (stageKey: string) => {
    const currentIndex = productionStages.findIndex(s => s.key === currentStage);
    const stageIndex = productionStages.findIndex(s => s.key === stageKey);

    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'current';
    return 'future';
  };

  const getStageDuration = (stageKey: string) => {
    const stageEntries = stageHistory.filter(h => h.to_stage === stageKey);
    if (stageEntries.length === 0) return null;

    const startEntry = stageEntries[0];
    const nextStageIndex = productionStages.findIndex(s => s.key === stageKey) + 1;
    
    if (nextStageIndex >= productionStages.length) {
      // Last stage - calculate from start to now
      return differenceInDays(new Date(), new Date(startEntry.changed_at));
    }

    const nextStage = productionStages[nextStageIndex];
    const endEntry = stageHistory.find(h => h.to_stage === nextStage.key);
    
    if (!endEntry) {
      // Current stage - calculate from start to now
      return differenceInDays(new Date(), new Date(startEntry.changed_at));
    }

    return differenceInDays(new Date(endEntry.changed_at), new Date(startEntry.changed_at));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Production Timeline
          </CardTitle>
          <Button 
            onClick={handleAdvanceJob}
            disabled={advancing || currentStage === 'closed'}
            size="sm"
            className="bg-primary hover:bg-primary/90"
          >
            {advancing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4 mr-2" />
            )}
            Advance Job
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

          {/* Stages */}
          <div className="space-y-6">
            {productionStages.map((stage, index) => {
              const status = getStageStatus(stage.key);
              const duration = getStageDuration(stage.key);
              const stageEntry = stageHistory.find(h => h.to_stage === stage.key);

              return (
                <div key={stage.key} className="relative pl-12">
                  {/* Stage icon */}
                  <div 
                    className={`absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center ${
                      status === 'completed' 
                        ? 'bg-success text-success-foreground' 
                        : status === 'current'
                        ? 'bg-primary text-primary-foreground animate-pulse'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {status === 'completed' && <Check className="h-4 w-4" />}
                    {status === 'current' && <Clock className="h-4 w-4" />}
                    {status === 'future' && <AlertCircle className="h-4 w-4" />}
                  </div>

                  {/* Stage content */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge 
                        style={{ 
                          backgroundColor: status !== 'future' ? stage.color : undefined 
                        }}
                        className={status === 'future' ? 'bg-muted text-muted-foreground' : 'text-white'}
                      >
                        {stage.label}
                      </Badge>
                      {status === 'current' && (
                        <Badge variant="outline" className="animate-pulse">
                          In Progress
                        </Badge>
                      )}
                    </div>

                    {stageEntry && (
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>
                          Started: {formatDistanceToNow(new Date(stageEntry.changed_at), { addSuffix: true })}
                        </div>
                        {duration !== null && (
                          <div>
                            Duration: {duration} {duration === 1 ? 'day' : 'days'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};