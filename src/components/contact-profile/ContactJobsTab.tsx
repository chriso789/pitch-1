import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { 
  Briefcase, 
  Plus, 
  Calendar,
  DollarSign,
  Clock,
  User,
  Loader2,
  ExternalLink,
  Edit
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ContactJobsTabProps {
  contact: any;
  jobs: any[];
  onJobsUpdate: (jobs: any[]) => void;
}

export const ContactJobsTab: React.FC<ContactJobsTabProps> = ({ 
  contact, 
  jobs, 
  onJobsUpdate 
}) => {
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  
  const form = useForm({
    defaultValues: {
      name: '',
      description: ''
    }
  });

  const handleCreateJob = async (data: any) => {
    if (!data.name.trim()) {
      toast({
        title: "Error",
        description: "Job name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingJob(true);

      const { data: tenantData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const { data: jobData, error } = await supabase
        .from('jobs')
        .insert({
          contact_id: contact.id,
          name: data.name,
          description: data.description || null,
          tenant_id: tenantData?.tenant_id,
          created_by: (await supabase.auth.getUser()).data.user?.id,
          status: 'scheduled'
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: `Job "${jobData.name}" created successfully`,
      });

      onJobsUpdate([jobData, ...jobs]);
      form.reset();
      setDialogOpen(false);
      
    } catch (error) {
      console.error('Error creating job:', error);
      toast({
        title: "Error",
        description: "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setIsCreatingJob(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-500 text-white';
      case 'in_progress':
        return 'bg-orange-500 text-white';
      case 'scheduled':
        return 'bg-blue-500 text-white';
      case 'materials_ordered':
        return 'bg-yellow-500 text-white';
      case 'quality_check':
        return 'bg-purple-500 text-white';
      case 'invoiced':
        return 'bg-emerald-600 text-white';
      case 'closed':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Jobs Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Total Jobs</p>
                <p className="text-2xl font-bold">{jobs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Active Jobs</p>
                <p className="text-2xl font-bold">
                  {jobs.filter(job => ['scheduled', 'in_progress', 'materials_ordered', 'quality_check'].includes(job.status)).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-success" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Completed</p>
                <p className="text-2xl font-bold">
                  {jobs.filter(job => job.status === 'completed').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Jobs ({jobs.length})
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary">
                <Plus className="h-4 w-4 mr-2" />
                Create Job
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Job</DialogTitle>
                <DialogDescription>
                  Create a new job for {contact?.first_name} {contact?.last_name}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleCreateJob)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter job name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Enter job description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <DialogFooter>
                    <Button 
                      type="submit" 
                      disabled={isCreatingJob}
                      className="gradient-primary"
                    >
                      {isCreatingJob && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Job
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {jobs.length > 0 ? (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-4 hover:shadow-soft transition-smooth">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-lg">{job.name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {job.job_number}
                        </Badge>
                        <Badge className={`text-xs ${getStatusColor(job.status)}`}>
                          {job.status?.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                      
                      {job.description && (
                        <p className="text-sm text-muted-foreground">{job.description}</p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Created: {new Date(job.created_at).toLocaleDateString()}
                        </div>
                        {job.updated_at !== job.created_at && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Updated: {new Date(job.updated_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Jobs Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create the first job for {contact?.first_name} {contact?.last_name}
              </p>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary">
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Job
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};