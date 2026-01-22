import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { CLJBadge } from '@/components/CLJBadge';
import { useToast } from '@/hooks/use-toast';
import {
  Building2,
  Calendar,
  DollarSign,
  FileText,
  MessageSquare,
  Package,
  User,
  Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ProjectTimeline } from './ProjectTimeline';
import { CustomerMessages } from './CustomerMessages';

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  start_date: string;
  estimated_completion_date: string;
  actual_completion_date?: string;
  clj_formatted_number: string;
  project_number: string;
}

interface Payment {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  description: string;
}

export const CustomerPortal: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchCustomerData();
  }, []);

  const fetchCustomerData = async () => {
    try {
      setLoading(true);

      // Fetch projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;
      setProjects(projectsData || []);

      // Fetch payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (paymentsError) {
        console.warn('Payments not available:', paymentsError);
      } else {
        setPayments(paymentsData || []);
      }

      if (projectsData && projectsData.length > 0) {
        setSelectedProject(projectsData[0]);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'active': 'bg-green-500/10 text-green-500 border-green-500/20',
      'planning': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      'on_hold': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      'completed': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      'cancelled': 'bg-red-500/10 text-red-500 border-red-500/20'
    };
    return colors[status] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  };

  const getProgressPercentage = (project: Project) => {
    if (project.actual_completion_date) return 100;
    if (!project.start_date || !project.estimated_completion_date) return 0;

    const start = new Date(project.start_date).getTime();
    const end = new Date(project.estimated_completion_date).getTime();
    const now = Date.now();

    if (now < start) return 0;
    if (now > end) return 100;

    return Math.round(((now - start) / (end - start)) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading your projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Customer Portal</h1>
              <p className="text-sm text-muted-foreground">
                View your projects and payment history
              </p>
            </div>
            <Button variant="outline">
              <User className="h-4 w-4 mr-2" />
              My Account
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        {projects.length === 0 ? (
          <Card className="p-12 text-center">
            <Building2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-2">No Active Projects</h2>
            <p className="text-muted-foreground">
              You don't have any projects yet. Contact us to get started!
            </p>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Projects List */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Your Projects</h2>
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                    selectedProject?.id === project.id ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedProject(project)}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <CLJBadge cljNumber={project.clj_formatted_number} size="sm" />
                      <Badge variant="outline" className={getStatusColor(project.status)}>
                        {project.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {project.description}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{getProgressPercentage(project)}%</span>
                      </div>
                      <Progress value={getProgressPercentage(project)} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Project Details */}
            <div className="lg:col-span-2">
              {selectedProject && (
                <Tabs defaultValue="overview" className="space-y-4">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview">
                      <FileText className="h-4 w-4 mr-2" />
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="timeline">
                      <Calendar className="h-4 w-4 mr-2" />
                      Timeline
                    </TabsTrigger>
                    <TabsTrigger value="payments">
                      <DollarSign className="h-4 w-4 mr-2" />
                      Payments
                    </TabsTrigger>
                    <TabsTrigger value="messages">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Messages
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h2 className="text-2xl font-bold mb-2">{selectedProject.name}</h2>
                            <div className="flex items-center gap-2 mb-4">
                              <CLJBadge cljNumber={selectedProject.clj_formatted_number} />
                              <Badge variant="outline" className={getStatusColor(selectedProject.status)}>
                                {selectedProject.status.replace('_', ' ').toUpperCase()}
                              </Badge>
                            </div>
                          </div>
                          <Package className="h-12 w-12 text-muted-foreground" />
                        </div>

                        <p className="text-muted-foreground">
                          {selectedProject.description}
                        </p>

                        <div className="grid md:grid-cols-2 gap-4 pt-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <Calendar className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Start Date</p>
                              <p className="font-semibold">
                                {new Date(selectedProject.start_date).toLocaleDateString()}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <Clock className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Est. Completion</p>
                              <p className="font-semibold">
                                {new Date(selectedProject.estimated_completion_date).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4">
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Overall Progress</span>
                            <span className="font-semibold">{getProgressPercentage(selectedProject)}%</span>
                          </div>
                          <Progress value={getProgressPercentage(selectedProject)} className="h-3" />
                        </div>
                      </div>
                    </Card>
                  </TabsContent>

                  <TabsContent value="timeline">
                    <ProjectTimeline projectId={selectedProject.id} />
                  </TabsContent>

                  <TabsContent value="payments">
                    <Card className="p-6">
                      <h3 className="text-lg font-semibold mb-4">Payment History</h3>
                      {payments.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                          No payment history available
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {payments.map((payment) => (
                            <div key={payment.id} className="flex items-center justify-between p-4 border rounded-lg">
                              <div>
                                <p className="font-semibold">{payment.description}</p>
                                <p className="text-sm text-muted-foreground">
                                  {formatDistanceToNow(new Date(payment.created_at), { addSuffix: true })}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-primary">
                                  ${payment.amount.toLocaleString()}
                                </p>
                                <Badge variant="outline">{payment.status}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </TabsContent>

                  <TabsContent value="messages">
                    <CustomerMessages projectId={selectedProject.id} />
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
