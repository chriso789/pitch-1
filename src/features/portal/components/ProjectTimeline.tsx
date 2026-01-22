import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  FileCheck,
  Calendar,
  Hammer,
  ClipboardCheck,
  DollarSign
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ProjectTimelineProps {
  projectId: string;
}

interface StageHistoryItem {
  id: string;
  from_stage: string;
  to_stage: string;
  changed_at: string;
  notes?: string;
}

interface WorkflowData {
  current_stage: string;
  stage_data: Record<string, any> | null;
  stage_changed_at: string | null;
}

const PRODUCTION_STAGES = [
  { key: 'contract_deposit', name: 'Contract & Deposit', icon: FileText, description: 'Contract signed and deposit received' },
  { key: 'permit_submitted', name: 'Permit Submitted', icon: FileCheck, description: 'Building permit application submitted' },
  { key: 'permit_approved', name: 'Permit Approved', icon: CheckCircle2, description: 'Permit approved and ready for scheduling' },
  { key: 'job_scheduled', name: 'Job Scheduled', icon: Calendar, description: 'Work dates confirmed' },
  { key: 'install', name: 'Installation', icon: Hammer, description: 'Installation in progress' },
  { key: 'final_inspection', name: 'Final Inspection', icon: ClipboardCheck, description: 'Final inspection and walkthrough' },
  { key: 'paid_in_full', name: 'Paid in Full', icon: DollarSign, description: 'Project complete and paid' },
];

export const ProjectTimeline: React.FC<ProjectTimelineProps> = ({ projectId }) => {
  const [loading, setLoading] = useState(true);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [stageHistory, setStageHistory] = useState<StageHistoryItem[]>([]);

  useEffect(() => {
    fetchTimelineData();
  }, [projectId]);

  const fetchTimelineData = async () => {
    setLoading(true);
    try {
      // Fetch workflow data
      const { data: workflowData, error: workflowError } = await supabase
        .from('production_workflows')
        .select('current_stage, stage_data, stage_changed_at')
        .eq('project_id', projectId)
        .maybeSingle();

      if (workflowError) {
        console.error('Workflow fetch error:', workflowError);
      }

      if (workflowData) {
        setWorkflow({
          current_stage: workflowData.current_stage,
          stage_data: workflowData.stage_data as Record<string, any> | null,
          stage_changed_at: workflowData.stage_changed_at
        });

        // Fetch stage history
        const { data: historyData, error: historyError } = await supabase
          .from('production_stage_history')
          .select('id, from_stage, to_stage, changed_at, notes')
          .eq('production_workflow_id', projectId)
          .order('changed_at', { ascending: true });

        if (!historyError && historyData) {
          setStageHistory(historyData);
        }
      }
    } catch (error) {
      console.error('Timeline fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCurrentStageIndex = () => {
    if (!workflow?.current_stage) return -1;
    return PRODUCTION_STAGES.findIndex(s => s.key === workflow.current_stage);
  };

  const getStageStatus = (stageIndex: number) => {
    const currentIndex = getCurrentStageIndex();
    if (currentIndex === -1) return 'pending';
    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'current';
    return 'pending';
  };

  const getStageDate = (stageKey: string) => {
    const historyItem = stageHistory.find(h => h.to_stage === stageKey);
    return historyItem?.changed_at;
  };

  if (loading) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-6">Project Timeline</h3>
        <div className="space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (!workflow) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Project Timeline</h3>
        <div className="text-center py-8">
          <Clock className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            Timeline will be available once your project begins production.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Project Timeline</h3>
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
          {PRODUCTION_STAGES[getCurrentStageIndex()]?.name || 'Not Started'}
        </Badge>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-border" />

        <div className="space-y-1">
          {PRODUCTION_STAGES.map((stage, index) => {
            const status = getStageStatus(index);
            const stageDate = getStageDate(stage.key);
            const StageIcon = stage.icon;

            return (
              <div key={stage.key} className="relative flex items-start gap-4 pb-6 last:pb-0">
                {/* Icon circle */}
                <div
                  className={cn(
                    'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    status === 'completed' && 'bg-primary border-primary text-primary-foreground',
                    status === 'current' && 'bg-background border-primary text-primary animate-pulse',
                    status === 'pending' && 'bg-muted border-muted-foreground/30 text-muted-foreground'
                  )}
                >
                  {status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <StageIcon className="h-5 w-5" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className={cn(
                      'font-medium',
                      status === 'pending' && 'text-muted-foreground'
                    )}>
                      {stage.name}
                    </h4>
                    {status === 'current' && (
                      <Badge variant="secondary" className="text-xs">
                        In Progress
                      </Badge>
                    )}
                  </div>
                  
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {stage.description}
                  </p>

                  {stageDate && status === 'completed' && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Completed {format(new Date(stageDate), 'MMM d, yyyy')}
                    </p>
                  )}

                  {status === 'current' && workflow.stage_changed_at && (
                    <p className="text-xs text-primary mt-1.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Started {formatDistanceToNow(new Date(workflow.stage_changed_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
