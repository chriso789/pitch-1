import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface JobApprovalDialogProps {
  pipelineEntry: any;
  onJobCreated?: (job: any) => void;
  children: React.ReactNode;
}

export const JobApprovalDialog: React.FC<JobApprovalDialogProps> = ({
  pipelineEntry,
  onJobCreated,
  children
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 'medium',
    estimated_start_date: '',
    estimated_completion_date: '',
    assigned_to: '',
    create_production_workflow: true,
    metadata: {}
  });

  const handleApprove = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('api-approve-job-from-lead', {
        body: {
          pipelineEntryId: pipelineEntry.id,
          jobDetails: {
            ...formData,
            estimated_start_date: formData.estimated_start_date || null,
            estimated_completion_date: formData.estimated_completion_date || null,
            assigned_to: formData.assigned_to || null,
            metadata: {
              ...formData.metadata,
              approved_from_pipeline: true,
              original_pipeline_status: pipelineEntry.status,
              roof_type: pipelineEntry.roof_type,
              probability_percent: pipelineEntry.probability_percent
            }
          }
        }
      });

      if (error) throw error;

      toast({
        title: "Job Created Successfully",
        description: `Job ${data.job.job_number} has been created from the pipeline entry.`,
      });

      onJobCreated?.(data.job);
      setOpen(false);
      
      // Reset form
      setFormData({
        name: '',
        description: '',
        priority: 'medium',
        estimated_start_date: '',
        estimated_completion_date: '',
        assigned_to: '',
        create_production_workflow: true,
        metadata: {}
      });

    } catch (error: any) {
      console.error('Error creating job:', error);
      toast({
        title: "Error Creating Job",
        description: error.message || 'Failed to create job from pipeline entry',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'hot_lead':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'warm_lead':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'cold_lead':
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-50';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50';
      case 'low':
        return 'text-green-600 bg-green-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStatusIcon(pipelineEntry.status)}
            Convert Lead to Job
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Pipeline Entry Summary */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Pipeline Entry Details</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Contact:</span>
                <p className="font-medium">
                  {pipelineEntry.contacts?.first_name} {pipelineEntry.contacts?.last_name}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Address:</span>
                <p className="font-medium">{pipelineEntry.contacts?.address_street}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Roof Type:</span>
                <p className="font-medium capitalize">{pipelineEntry.roof_type?.replace('_', ' ')}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Probability:</span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor('medium')}`}>
                  {pipelineEntry.probability_percent}%
                </span>
              </div>
            </div>
          </div>

          {/* Job Configuration */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Job Name</Label>
                <Input
                  id="name"
                  placeholder="Enter job name (optional)"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="low">Low Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Enter job description (optional)"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Estimated Start Date</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.estimated_start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimated_start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="completion_date">Estimated Completion Date</Label>
                <Input
                  id="completion_date"
                  type="date"
                  value={formData.estimated_completion_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimated_completion_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="create_workflow"
                checked={formData.create_production_workflow}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, create_production_workflow: checked }))
                }
              />
              <Label htmlFor="create_workflow">Create Production Workflow</Label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleApprove}
              disabled={loading}
              className="bg-primary hover:bg-primary/90"
            >
              {loading ? 'Creating Job...' : 'Create Job'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};