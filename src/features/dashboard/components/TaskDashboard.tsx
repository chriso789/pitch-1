import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Phone, 
  Calendar, 
  FileText,
  User,
  Plus
} from 'lucide-react';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date: string | null;
  ai_generated: boolean;
  contacts?: {
    first_name: string;
    last_name: string;
    phone: string;
  };
  pipeline_entries?: {
    status: string;
    estimated_value: number;
  };
  created_at: string;
}

const TaskDashboard: React.FC = () => {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'urgent' | 'today'>('all');

  useEffect(() => {
    fetchTasks();
  }, [filter]);

  const fetchTasks = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      let query = supabase
        .from('tasks')
        .select(`
          *,
          contacts(first_name, last_name, phone),
          pipeline_entries(status, estimated_value)
        `)
        .eq('assigned_to', user.user.id)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filter === 'pending') {
        query = query.eq('status', 'pending');
      } else if (filter === 'urgent') {
        query = query.eq('priority', 'urgent');
      } else if (filter === 'today') {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        query = query.lte('due_date', today.toISOString());
      }

      const { data: tasksData, error } = await query;

      if (error) throw error;

      setTasks((tasksData || []) as Task[]);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast({
        title: "Error",
        description: "Failed to load tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status,
          completed_at: status === 'completed' ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) throw error;

      // Refresh tasks
      fetchTasks();

      toast({
        title: "Task Updated",
        description: `Task marked as ${status}`,
      });
    } catch (error) {
      console.error('Error updating task:', error);
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertTriangle className="h-4 w-4" />;
      case 'high': return <Clock className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const formatDueDate = (dueDate: string | null) => {
    if (!dueDate) return null;
    
    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Overdue';
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return `Due in ${diffDays} days`;
  };

  const urgentTasks = tasks.filter(t => t.priority === 'urgent' && t.status === 'pending');
  const todayTasks = tasks.filter(t => {
    if (!t.due_date) return false;
    const due = new Date(t.due_date);
    const today = new Date();
    return due.toDateString() === today.toDateString();
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center p-6">
            <AlertTriangle className="h-8 w-8 text-red-500 mr-3" />
            <div>
              <p className="text-2xl font-bold">{urgentTasks.length}</p>
              <p className="text-muted-foreground">Urgent Tasks</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center p-6">
            <Clock className="h-8 w-8 text-orange-500 mr-3" />
            <div>
              <p className="text-2xl font-bold">{todayTasks.length}</p>
              <p className="text-muted-foreground">Due Today</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center p-6">
            <CheckCircle2 className="h-8 w-8 text-green-500 mr-3" />
            <div>
              <p className="text-2xl font-bold">
                {tasks.filter(t => t.status === 'completed').length}
              </p>
              <p className="text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Task Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
          size="sm"
        >
          All Tasks ({tasks.length})
        </Button>
        <Button
          variant={filter === 'pending' ? 'default' : 'outline'}
          onClick={() => setFilter('pending')}
          size="sm"
        >
          Pending ({tasks.filter(t => t.status === 'pending').length})
        </Button>
        <Button
          variant={filter === 'urgent' ? 'default' : 'outline'}
          onClick={() => setFilter('urgent')}
          size="sm"
        >
          Urgent ({urgentTasks.length})
        </Button>
        <Button
          variant={filter === 'today' ? 'default' : 'outline'}
          onClick={() => setFilter('today')}
          size="sm"
        >
          Due Today ({todayTasks.length})
        </Button>
      </div>

      {/* Tasks List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            My Tasks
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Task
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No tasks found. Ask your AI assistant to create some tasks for you!
                </div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`border rounded-lg p-4 transition-colors ${
                      task.status === 'completed' 
                        ? 'bg-muted/50 opacity-75' 
                        : 'bg-background hover:bg-muted/25'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge 
                            className={`${getPriorityColor(task.priority)} text-white`}
                          >
                            {getPriorityIcon(task.priority)}
                            {task.priority}
                          </Badge>
                          
                          {task.ai_generated && (
                            <Badge variant="secondary">
                              AI Generated
                            </Badge>
                          )}
                          
                          {task.due_date && (
                            <Badge variant="outline">
                              <Clock className="h-3 w-3 mr-1" />
                              {formatDueDate(task.due_date)}
                            </Badge>
                          )}
                        </div>
                        
                        <h3 className={`font-semibold mb-1 ${
                          task.status === 'completed' ? 'line-through' : ''
                        }`}>
                          {task.title}
                        </h3>
                        
                        {task.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {task.description}
                          </p>
                        )}
                        
                        {task.contacts && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-4 w-4" />
                            {task.contacts.first_name} {task.contacts.last_name}
                            {task.contacts.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {task.contacts.phone}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        {task.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateTaskStatus(task.id, 'in_progress')}
                            >
                              Start
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => updateTaskStatus(task.id, 'completed')}
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        
                        {task.status === 'in_progress' && (
                          <Button
                            size="sm"
                            onClick={() => updateTaskStatus(task.id, 'completed')}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Complete
                          </Button>
                        )}
                        
                        {task.status === 'completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateTaskStatus(task.id, 'pending')}
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaskDashboard;