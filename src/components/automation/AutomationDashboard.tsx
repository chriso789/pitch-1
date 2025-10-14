import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Play, Pause, RefreshCw, Plus, Zap, AlertTriangle, CheckCircle, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { Database } from '@/integrations/supabase/types';

type WorkflowTask = Database['public']['Tables']['workflow_tasks']['Row'];
type PhaseHistory = Database['public']['Tables']['workflow_phase_history']['Row'];

export const AutomationDashboard = () => {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [history, setHistory] = useState<PhaseHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRunEnabled, setAutoRunEnabled] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');

  useEffect(() => {
    fetchTasks();
    fetchHistory();

    // Set up realtime
    const channel = supabase
      .channel('workflow-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workflow_tasks'
        },
        () => {
          fetchTasks();
          fetchHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!autoRunEnabled) return;

    const interval = setInterval(() => {
      runAutomation();
    }, 30000); // Run every 30 seconds

    return () => clearInterval(interval);
  }, [autoRunEnabled]);

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('workflow_tasks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks:', error);
      return;
    }

    setTasks(data || []);
  };

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('workflow_phase_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching history:', error);
      return;
    }

    setHistory(data || []);
  };

  const runAutomation = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('workflow-automation', {
        body: {}
      });

      if (error) throw error;

      if (data?.tasks_processed > 0) {
        toast.success(`Processed ${data.tasks_processed} tasks`);
        fetchTasks();
        fetchHistory();
      }
    } catch (error) {
      console.error('Automation error:', error);
      toast.error('Failed to run automation');
    } finally {
      setLoading(false);
    }
  };

  const runButtonAudit = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('audit-button-pathways', {
        body: {}
      });

      if (error) throw error;

      toast.success(`Audited ${data.files_audited} files`);
    } catch (error) {
      console.error('Audit error:', error);
      toast.error('Failed to run button audit');
    } finally {
      setLoading(false);
    }
  };

  const createTask = async () => {
    if (!newTaskName) {
      toast.error('Task name is required');
      return;
    }

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .single();

      const { error } = await supabase
        .from('workflow_tasks')
        .insert({
          tenant_id: profile?.tenant_id || '',
          task_name: newTaskName,
          description: newTaskDesc,
          current_phase: 'planning',
          is_active: true
        } as any);

      if (error) throw error;

      toast.success('Task created');
      setNewTaskName('');
      setNewTaskDesc('');
      fetchTasks();
    } catch (error) {
      console.error('Create task error:', error);
      toast.error('Failed to create task');
    }
  };

  const getPhaseColor = (phase: string) => {
    const colors: Record<string, string> = {
      planning: 'bg-blue-500/10 text-blue-500',
      implementation: 'bg-purple-500/10 text-purple-500',
      testing: 'bg-yellow-500/10 text-yellow-500',
      deployment: 'bg-green-500/10 text-green-500',
      monitoring: 'bg-orange-500/10 text-orange-500',
      optimization: 'bg-pink-500/10 text-pink-500'
    };
    return colors[phase] || 'bg-muted';
  };

  const getPhaseProgress = (phase: string) => {
    const progress: Record<string, number> = {
      planning: 16,
      implementation: 33,
      testing: 50,
      deployment: 66,
      monitoring: 83,
      optimization: 100
    };
    return progress[phase] || 0;
  };

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Autonomous Workflow Automation
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant={autoRunEnabled ? 'destructive' : 'default'}
                onClick={() => setAutoRunEnabled(!autoRunEnabled)}
              >
                {autoRunEnabled ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Stop Auto-Run
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Auto-Run
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={runAutomation}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Run Now
              </Button>
              <Button
                variant="outline"
                onClick={runButtonAudit}
                disabled={loading}
              >
                <Zap className="h-4 w-4 mr-2" />
                Audit Buttons
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {autoRunEnabled && (
            <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg">
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-sm text-success">
                Automation running every 30 seconds
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create New Task */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create New Task
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Task name"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
          />
          <Textarea
            placeholder="Task description"
            value={newTaskDesc}
            onChange={(e) => setNewTaskDesc(e.target.value)}
          />
          <Button onClick={createTask}>
            <Plus className="h-4 w-4 mr-2" />
            Create Task
          </Button>
        </CardContent>
      </Card>

      {/* Tasks Overview */}
      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="active">Active Tasks ({tasks.filter(t => t.is_active).length})</TabsTrigger>
          <TabsTrigger value="history">Phase History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <ScrollArea className="h-[600px]">
            <div className="space-y-4">
              {tasks.filter(t => t.is_active).map((task) => (
                <Card key={task.id}>
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-lg">{task.task_name}</h3>
                          <p className="text-sm text-muted-foreground">{task.description}</p>
                        </div>
                        <Badge className={getPhaseColor(task.current_phase)}>
                          {task.current_phase}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{getPhaseProgress(task.current_phase)}%</span>
                        </div>
                        <Progress value={getPhaseProgress(task.current_phase)} />
                      </div>

                      {task.ai_context && (task.ai_context as any).completion_percentage && (
                        <div className="text-xs text-muted-foreground">
                          AI Completion: {(task.ai_context as any).completion_percentage}%
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {tasks.filter(t => t.is_active).length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active tasks</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <ScrollArea className="h-[600px]">
            <div className="space-y-2">
              {history.map((entry) => (
                <Card key={entry.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-success mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge className={getPhaseColor(entry.from_phase || 'planning')} variant="outline">
                          {entry.from_phase}
                        </Badge>
                        <span className="text-xs text-muted-foreground">→</span>
                        <Badge className={getPhaseColor(entry.to_phase)}>
                          {entry.to_phase}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.ai_reasoning}</p>
                      {entry.actions_taken && (entry.actions_taken as string[]).length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Actions: {(entry.actions_taken as string[]).join(', ')}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};