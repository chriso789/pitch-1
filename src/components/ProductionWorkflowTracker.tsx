import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  CheckCircle, 
  Clock, 
  FileText, 
  Truck, 
  Hammer, 
  ClipboardCheck,
  AlertTriangle,
  ArrowRight,
  Calendar,
  User
} from 'lucide-react';

interface ProductionWorkflowTrackerProps {
  jobId?: string;
  projectId?: string;
}

const STAGE_CONFIG = {
  submit_documents: {
    name: 'Submit Documents',
    icon: FileText,
    color: 'bg-blue-500',
    description: 'Upload NOC and submit permit application'
  },
  permit_submitted: {
    name: 'Permit Submitted',
    icon: Clock,
    color: 'bg-yellow-500',
    description: 'Waiting for permit approval'
  },
  permit_approved: {
    name: 'Permit Approved',
    icon: CheckCircle,
    color: 'bg-green-500',
    description: 'Permit has been approved'
  },
  materials_ordered: {
    name: 'Materials Ordered',
    icon: Truck,
    color: 'bg-purple-500',
    description: 'Materials have been ordered'
  },
  materials_on_hold: {
    name: 'Materials On Hold',
    icon: AlertTriangle,
    color: 'bg-orange-500',
    description: 'Materials delivery delayed'
  },
  materials_delivered: {
    name: 'Materials Delivered',
    icon: CheckCircle,
    color: 'bg-green-500',
    description: 'Materials delivered to site'
  },
  in_progress: {
    name: 'Work In Progress',
    icon: Hammer,
    color: 'bg-blue-600',
    description: 'Work is actively in progress'
  },
  complete: {
    name: 'Work Complete',
    icon: CheckCircle,
    color: 'bg-green-600',
    description: 'Work has been completed'
  },
  final_inspection: {
    name: 'Final Inspection',
    icon: ClipboardCheck,
    color: 'bg-indigo-500',
    description: 'Final inspection and approval'
  },
  final_check_needed: {
    name: 'Final Check Needed',
    icon: AlertTriangle,
    color: 'bg-red-500',
    description: 'Additional work or corrections needed'
  },
  closed: {
    name: 'Closed',
    icon: CheckCircle,
    color: 'bg-gray-500',
    description: 'Project completed and closed'
  }
};

export const ProductionWorkflowTracker: React.FC<ProductionWorkflowTrackerProps> = ({
  jobId,
  projectId
}) => {
  const { toast } = useToast();
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState('');
  const [notes, setNotes] = useState('');
  const [documentUpdates, setDocumentUpdates] = useState({
    noc_uploaded: false,
    permit_application_submitted: false,
    permit_approved: false,
    materials_ordered: false,
    materials_delivered: false,
    work_completed: false,
    final_inspection_passed: false
  });

  useEffect(() => {
    if (jobId || projectId) {
      loadWorkflow();
    }
  }, [jobId, projectId]);

  const loadWorkflow = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'get_workflow',
          job_id: jobId,
          project_id: projectId
        }
      });

      if (error) throw error;

      if (data.workflow) {
        setWorkflow(data.workflow);
        setDocumentUpdates({
          noc_uploaded: data.workflow.noc_uploaded || false,
          permit_application_submitted: data.workflow.permit_application_submitted || false,
          permit_approved: data.workflow.permit_approved || false,
          materials_ordered: data.workflow.materials_ordered || false,
          materials_delivered: data.workflow.materials_delivered || false,
          work_completed: data.workflow.work_completed || false,
          final_inspection_passed: data.workflow.final_inspection_passed || false
        });
      }
    } catch (error: any) {
      console.error('Error loading workflow:', error);
      // If workflow doesn't exist, create it
      if (error.message?.includes('not found')) {
        await createWorkflow();
      } else {
        toast({
          title: "Error",
          description: error.message || 'Failed to load production workflow',
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const createWorkflow = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'create_workflow',
          job_id: jobId,
          project_id: projectId
        }
      });

      if (error) throw error;

      setWorkflow(data.workflow);
      toast({
        title: "Success",
        description: "Production workflow created successfully",
      });
    } catch (error: any) {
      console.error('Error creating workflow:', error);
      toast({
        title: "Error",
        description: error.message || 'Failed to create production workflow',
        variant: "destructive",
      });
    }
  };

  const advanceStage = async () => {
    if (!selectedStage) return;

    setUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'advance_stage',
          job_id: jobId,
          project_id: projectId,
          new_stage: selectedStage,
          notes: notes.trim() || undefined
        }
      });

      if (error) throw error;

      toast({
        title: "Stage Updated",
        description: data.message,
      });

      setStageDialogOpen(false);
      setNotes('');
      setSelectedStage('');
      await loadWorkflow();

    } catch (error: any) {
      console.error('Error advancing stage:', error);
      toast({
        title: "Error",
        description: error.message || 'Failed to advance stage',
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const updateDocuments = async () => {
    setUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'update_documents',
          job_id: jobId,
          project_id: projectId,
          document_updates: documentUpdates
        }
      });

      if (error) throw error;

      toast({
        title: "Documents Updated",
        description: data.message,
      });

      setDocumentDialogOpen(false);
      await loadWorkflow();

    } catch (error: any) {
      console.error('Error updating documents:', error);
      toast({
        title: "Error",
        description: error.message || 'Failed to update documents',
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const getNextStages = (currentStage: string) => {
    const stages = Object.keys(STAGE_CONFIG);
    const currentIndex = stages.indexOf(currentStage);
    
    // Allow moving to next stage or going backwards
    const availableStages = [];
    
    // Add next stage if not at the end
    if (currentIndex < stages.length - 1) {
      availableStages.push(stages[currentIndex + 1]);
    }
    
    // Allow going back to previous stages
    for (let i = Math.max(0, currentIndex - 2); i < currentIndex; i++) {
      availableStages.push(stages[i]);
    }
    
    return availableStages;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading production workflow...</div>
        </CardContent>
      </Card>
    );
  }

  if (!workflow) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <p>No production workflow found</p>
            <Button onClick={createWorkflow}>Create Workflow</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentStageConfig = STAGE_CONFIG[workflow.current_stage];
  const CurrentStageIcon = currentStageConfig?.icon || Clock;

  return (
    <div className="space-y-6">
      {/* Current Stage Status */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CurrentStageIcon className="h-5 w-5" />
              Production Workflow
            </CardTitle>
            <div className="flex gap-2">
              <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <FileText className="h-4 w-4 mr-2" />
                    Documents
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Update Document Status</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {Object.entries(documentUpdates).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between">
                        <Label htmlFor={key} className="text-sm capitalize">
                          {key.replace(/_/g, ' ')}
                        </Label>
                        <Switch
                          id={key}
                          checked={value}
                          onCheckedChange={(checked) => 
                            setDocumentUpdates(prev => ({ ...prev, [key]: checked }))
                          }
                        />
                      </div>
                    ))}
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => setDocumentDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={updateDocuments} disabled={updating}>
                        {updating ? 'Updating...' : 'Update Documents'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Advance Stage
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Advance Production Stage</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Select New Stage</Label>
                      <div className="space-y-2 mt-2">
                        {getNextStages(workflow.current_stage).map(stage => {
                          const config = STAGE_CONFIG[stage];
                          const StageIcon = config.icon;
                          return (
                            <div
                              key={stage}
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                selectedStage === stage ? 'border-primary bg-primary/5' : 'border-border'
                              }`}
                              onClick={() => setSelectedStage(stage)}
                            >
                              <div className="flex items-center gap-2">
                                <StageIcon className="h-4 w-4" />
                                <span className="font-medium">{config.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {config.description}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="notes">Notes (Optional)</Label>
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add notes about this stage transition..."
                        rows={3}
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setStageDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={advanceStage} 
                        disabled={!selectedStage || updating}
                      >
                        {updating ? 'Updating...' : 'Advance Stage'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full ${currentStageConfig?.color || 'bg-gray-500'} text-white`}>
              <CurrentStageIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{currentStageConfig?.name}</h3>
              <p className="text-muted-foreground">{currentStageConfig?.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Document Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Document Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(documentUpdates).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center ${value ? 'bg-green-500' : 'bg-gray-300'}`}>
                  {value && <CheckCircle className="h-3 w-3 text-white" />}
                </div>
                <span className={`text-sm capitalize ${value ? 'text-green-700' : 'text-muted-foreground'}`}>
                  {key.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stage History */}
      {workflow.stage_history && workflow.stage_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Stage History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {workflow.stage_history.map((entry: any, index: number) => {
                const stageConfig = STAGE_CONFIG[entry.to_stage];
                const StageIcon = stageConfig?.icon || Clock;
                
                return (
                  <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className={`p-2 rounded-full ${stageConfig?.color || 'bg-gray-500'} text-white`}>
                      <StageIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{stageConfig?.name}</h4>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDate(entry.changed_at)}
                        </div>
                      </div>
                      {entry.from_stage && (
                        <p className="text-sm text-muted-foreground">
                          From: {STAGE_CONFIG[entry.from_stage]?.name}
                        </p>
                      )}
                      {entry.notes && (
                        <p className="text-sm mt-1">{entry.notes}</p>
                      )}
                      {entry.profiles && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {entry.profiles.first_name} {entry.profiles.last_name}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};