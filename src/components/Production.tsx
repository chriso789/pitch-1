import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { 
  CheckCircle, 
  Clock, 
  DollarSign, 
  FileText,
  MapPin,
  User,
  AlertTriangle
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";

interface ProductionTask {
  id: string;
  name: string;
  completed: boolean;
  dueDate: Date;
  isOverdue: boolean;
}

interface ProductionProject {
  id: string;
  name: string;
  projectNumber: string;
  customerName: string;
  address: string;
  contractValue: number;
  amountPaid: number;
  balanceOwed: number;
  isFinanced: boolean;
  convertedDate: Date;
  daysInProduction: number;
  tasks: ProductionTask[];
  salesRep: string;
}

const Production = () => {
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductionProjects();
  }, []);

  const fetchProductionProjects = async () => {
    try {
      setLoading(true);
      
      // Fetch projects that are in production (approved estimates)
      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates!inner(*),
          payments(*)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Transform data into production format
      const productionProjects: ProductionProject[] = projectsData.map((project: any) => {
        const contact = project.pipeline_entries?.contacts;
        const estimate = project.estimates?.[0];
        const payments = project.payments || [];
        
        const totalPaid = payments.reduce((sum: number, payment: any) => 
          sum + Number(payment.amount), 0);
        const contractValue = estimate ? Number(estimate.selling_price) : 0;
        const balanceOwed = contractValue - totalPaid;
        
        const convertedDate = new Date(project.created_at);
        const daysInProduction = Math.floor(
          (new Date().getTime() - convertedDate.getTime()) / (1000 * 3600 * 24)
        );

        // Create production tasks
        const tasks: ProductionTask[] = [
          {
            id: `${project.id}-noc`,
            name: 'Record NOC',
            completed: false,
            dueDate: new Date(convertedDate.getTime() + 24 * 60 * 60 * 1000),
            isOverdue: daysInProduction > 1
          },
          {
            id: `${project.id}-permit-apply`,
            name: 'Applied for Permit',
            completed: false,
            dueDate: new Date(convertedDate.getTime() + 24 * 60 * 60 * 1000),
            isOverdue: daysInProduction > 1
          },
          {
            id: `${project.id}-permit-received`,
            name: 'Permit Received',
            completed: false,
            dueDate: new Date(convertedDate.getTime() + 24 * 60 * 60 * 1000),
            isOverdue: daysInProduction > 1
          },
          {
            id: `${project.id}-materials`,
            name: 'Materials Ordered',
            completed: false,
            dueDate: new Date(convertedDate.getTime() + 24 * 60 * 60 * 1000),
            isOverdue: daysInProduction > 1
          },
          {
            id: `${project.id}-labor`,
            name: 'Labor Scheduled',
            completed: false,
            dueDate: new Date(convertedDate.getTime() + 24 * 60 * 60 * 1000),
            isOverdue: daysInProduction > 1
          }
        ];

        return {
          id: project.id,
          name: project.name,
          projectNumber: project.project_number,
          customerName: contact ? `${contact.first_name} ${contact.last_name}` : 'Unknown',
          address: contact ? `${contact.address_street}, ${contact.address_city}` : 'Unknown',
          contractValue,
          amountPaid: totalPaid,
          balanceOwed,
          isFinanced: false, // This would come from project metadata
          convertedDate,
          daysInProduction,
          tasks,
          salesRep: 'Unknown' // This would come from user data
        };
      });

      setProjects(productionProjects);
    } catch (error) {
      console.error('Error fetching production projects:', error);
      toast({
        title: "Error",
        description: "Failed to load production projects",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = (projectId: string, taskId: string) => {
    setProjects(prev => 
      prev.map(project => 
        project.id === projectId 
          ? {
              ...project,
              tasks: project.tasks.map(task =>
                task.id === taskId ? { ...task, completed: !task.completed } : task
              )
            }
          : project
      )
    );
  };

  const getTasksCompletedCount = (tasks: ProductionTask[]) => {
    return tasks.filter(task => task.completed).length;
  };

  const getOverdueTasksCount = (tasks: ProductionTask[]) => {
    return tasks.filter(task => !task.completed && task.isOverdue).length;
  };

  if (loading) {
    return <div className="p-6">Loading production projects...</div>;
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
            {projects.length} active projects
          </span>
        </div>
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        {projects.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No projects in production yet
            </CardContent>
          </Card>
        ) : (
          projects.map((project) => {
            const completedTasks = getTasksCompletedCount(project.tasks);
            const overdueTasks = getOverdueTasksCount(project.tasks);
            const progressPercent = (completedTasks / project.tasks.length) * 100;

            return (
              <Card key={project.id} className="shadow-soft border-0">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        <Badge variant="outline" className="text-xs">
                          #{project.projectNumber}
                        </Badge>
                        {overdueTasks > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {overdueTasks} Overdue
                          </Badge>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          <span>{project.customerName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          <span>{project.address}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          <span>{project.daysInProduction} days in production</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Financial Summary */}
                    <div className="text-right space-y-1">
                      <div className="text-lg font-bold">
                        ${project.contractValue.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Paid: ${project.amountPaid.toLocaleString()}
                      </div>
                      <div className={`text-sm font-medium ${
                        project.balanceOwed > 0 ? 'text-warning' : 'text-success'
                      }`}>
                        Balance: ${project.balanceOwed.toLocaleString()}
                      </div>
                      {project.isFinanced && (
                        <Badge variant="outline" className="text-xs">
                          Financed
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mt-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-muted-foreground">
                        Tasks Completed: {completedTasks}/{project.tasks.length}
                      </span>
                      <span className="text-sm font-medium">
                        {progressPercent.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-success h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  {/* Production Tasks */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                      Production Tasks (Complete within 24 hours)
                    </h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {project.tasks.map((task) => (
                        <div
                          key={task.id}
                          className={`flex items-center space-x-3 p-3 rounded-lg border transition-smooth ${
                            task.completed 
                              ? 'bg-success/10 border-success/20' 
                              : task.isOverdue 
                                ? 'bg-destructive/10 border-destructive/20'
                                : 'bg-muted/50 border-border'
                          }`}
                        >
                          <Checkbox
                            id={task.id}
                            checked={task.completed}
                            onCheckedChange={() => toggleTask(project.id, task.id)}
                            className="data-[state=checked]:bg-success data-[state=checked]:border-success"
                          />
                          <label
                            htmlFor={task.id}
                            className={`text-sm font-medium cursor-pointer flex-1 ${
                              task.completed 
                                ? 'text-success line-through' 
                                : task.isOverdue 
                                  ? 'text-destructive'
                                  : 'text-foreground'
                            }`}
                          >
                            {task.name}
                          </label>
                          {task.isOverdue && !task.completed && (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          )}
                          {task.completed && (
                            <CheckCircle className="h-4 w-4 text-success" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Production;