import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Clock, User, Phone, Mail, MessageSquare, Plus, Filter, BarChart3, TrendingUp } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";

interface PipelineStage {
  id: string;
  name: string;
  description: string;
  stage_order: number;
  probability_percent: number;
  color: string;
  is_active: boolean;
}

type PipelineStatus = Database['public']['Enums']['pipeline_status'];

interface PipelineEntry {
  id: string;
  contact_id: string | null;
  status: PipelineStatus | null;
  priority: string;
  lead_quality_score: number;
  estimated_value: number | null;
  assigned_to: string | null;
  created_at: string;
  contacts: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    lead_score: number;
    qualification_status: string | null;
  } | null;
}

interface Activity {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string | null;
  priority: string | null;
  scheduled_at: string | null;
  assigned_to: string | null;
  created_at: string | null;
}

export function EnhancedPipeline() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PipelineEntry | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadPipelineData();
  }, []);

  const loadPipelineData = async () => {
    try {
      // Load pipeline stages
      const { data: stagesData, error: stagesError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('is_active', true)
        .order('stage_order');

      if (stagesError) throw stagesError;

      // Load pipeline entries with contacts
      const { data: entriesData, error: entriesError } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
          contacts (
            first_name,
            last_name,
            email,
            phone,
            lead_score,
            qualification_status
          )
        `)
        .order('created_at', { ascending: false });

      if (entriesError) throw entriesError;

      // Load recent activities
      const { data: activitiesData, error: activitiesError } = await supabase
        .from('pipeline_activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (activitiesError) throw activitiesError;

      setStages(stagesData || []);
      setEntries(entriesData as any || []);
      setActivities(activitiesData || []);
    } catch (error) {
      console.error('Error loading pipeline data:', error);
      toast({
        title: "Error loading pipeline",
        description: "Failed to load pipeline data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const moveEntry = async (entryId: string, newStage: PipelineStatus) => {
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ status: newStage })
        .eq('id', entryId);

      if (error) throw error;

      // Get current user tenant ID for RLS
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get user's tenant_id from profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      // Log the stage change activity
      await supabase
        .from('pipeline_activities')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: entryId,
          contact_id: entries.find(e => e.id === entryId)?.contact_id,
          activity_type: 'status_change',
          title: `Stage changed to ${newStage}`,
          description: `Pipeline entry moved to ${newStage}`,
          status: 'completed'
        });

      loadPipelineData();
      toast({
        title: "Stage updated",
        description: "Pipeline entry moved successfully.",
      });
    } catch (error) {
      console.error('Error moving entry:', error);
      toast({
        title: "Error",
        description: "Failed to move pipeline entry.",
        variant: "destructive",
      });
    }
  };

  const addActivity = async (data: {
    title: string;
    description: string;
    activity_type: string;
    priority: string;
    scheduled_at?: string;
  }) => {
    if (!selectedEntry) return;

    try {
      // Get current user tenant ID for RLS
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get user's tenant_id from profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const { error } = await supabase
        .from('pipeline_activities')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: selectedEntry.id,
          contact_id: selectedEntry.contact_id,
          ...data
        });

      if (error) throw error;

      loadPipelineData();
      setShowActivityDialog(false);
      toast({
        title: "Activity added",
        description: "New activity has been scheduled.",
      });
    } catch (error) {
      console.error('Error adding activity:', error);
      toast({
        title: "Error",
        description: "Failed to add activity.",
        variant: "destructive",
      });
    }
  };

  const getStageEntries = (stageId: string) => {
    return entries.filter(entry => entry.status?.toLowerCase() === stageId.toLowerCase());
  };

  const getStageColor = (stageId: string) => {
    const stage = stages.find(s => s.name.toLowerCase() === stageId.toLowerCase());
    return stage?.color || '#6b7280';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'secondary';
      case 'medium': return 'outline';
      default: return 'outline';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading pipeline...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pipeline Management</h1>
          <p className="text-muted-foreground">Track and manage your sales pipeline</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedStage} onValueChange={setSelectedStage}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.name.toLowerCase()}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="kanban" className="w-full">
        <TabsList>
          <TabsTrigger value="kanban">Kanban Board</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stages.map((stage) => {
              const stageEntries = getStageEntries(stage.name.toLowerCase());
              const totalValue = stageEntries.reduce((sum, entry) => sum + (entry.estimated_value || 0), 0);

              return (
                <Card key={stage.id} className="min-h-96">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg" style={{ color: stage.color }}>
                        {stage.name}
                      </CardTitle>
                      <Badge variant="outline">{stageEntries.length}</Badge>
                    </div>
                    <CardDescription>
                      {stage.probability_percent}% close rate • ${totalValue.toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {stageEntries.map((entry) => (
                      <Card 
                        key={entry.id} 
                        className="p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => setSelectedEntry(entry)}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {entry.contacts?.first_name} {entry.contacts?.last_name}
                            </span>
                            <Badge variant={getPriorityColor(entry.priority)}>
                              {entry.priority}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Score: {entry.contacts?.lead_score} • ${entry.estimated_value?.toLocaleString()}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />
                            {entry.assigned_to || 'Unassigned'}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="list" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline Entries</CardTitle>
              <CardDescription>All pipeline entries in list format</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="font-medium">
                          {entry.contacts?.first_name} {entry.contacts?.last_name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {entry.contacts?.email} • {entry.contacts?.phone}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge style={{ backgroundColor: getStageColor(entry.status) }}>
                        {entry.status}
                      </Badge>
                      <div className="text-sm font-medium">
                        ${entry.estimated_value?.toLocaleString()}
                      </div>
                      <Select 
                        value={entry.status || ''} 
                        onValueChange={(value) => moveEntry(entry.id, value as PipelineStatus)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.name.toLowerCase()}>
                              {stage.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Activities</CardTitle>
                  <CardDescription>Latest pipeline activities and interactions</CardDescription>
                </div>
                <Dialog open={showActivityDialog} onOpenChange={setShowActivityDialog}>
                  <DialogTrigger asChild>
                    <Button disabled={!selectedEntry}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Activity
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <ActivityForm onSubmit={addActivity} />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4 p-4 border rounded-lg">
                    <div className="flex-shrink-0">
                      {activity.activity_type === 'call' && <Phone className="h-5 w-5 text-blue-500" />}
                      {activity.activity_type === 'email' && <Mail className="h-5 w-5 text-green-500" />}
                      {activity.activity_type === 'meeting' && <Calendar className="h-5 w-5 text-purple-500" />}
                      {activity.activity_type === 'note' && <MessageSquare className="h-5 w-5 text-orange-500" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{activity.title}</h4>
                        <Badge variant={getPriorityColor(activity.priority)}>
                          {activity.priority}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {activity.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(activity.scheduled_at || activity.created_at || new Date()).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {activity.assigned_to}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Pipeline Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${entries.reduce((sum, entry) => sum + (entry.estimated_value || 0), 0).toLocaleString()}
                </div>
                <p className="text-sm text-muted-foreground">Total pipeline value</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Conversion Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stages.find(s => s.name === 'Closed Won')?.probability_percent || 0}%
                </div>
                <p className="text-sm text-muted-foreground">Average close rate</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total Opportunities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{entries.length}</div>
                <p className="text-sm text-muted-foreground">Active pipeline entries</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ActivityForm({ onSubmit }: { onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    activity_type: 'call',
    priority: 'medium',
    scheduled_at: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add New Activity</DialogTitle>
        <DialogDescription>
          Schedule a new activity for this pipeline entry.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Title</label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Activity title"
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium">Type</label>
          <Select value={formData.activity_type} onValueChange={(value) => setFormData({ ...formData, activity_type: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="meeting">Meeting</SelectItem>
              <SelectItem value="note">Note</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">Priority</label>
          <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">Description</label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Activity description"
            rows={3}
          />
        </div>

        <div>
          <label className="text-sm font-medium">Scheduled Date</label>
          <Input
            type="datetime-local"
            value={formData.scheduled_at}
            onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit">Add Activity</Button>
      </div>
    </form>
  );
}