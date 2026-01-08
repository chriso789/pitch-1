import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraduationCap, Plus, PlayCircle, CheckCircle, Clock, FileText } from 'lucide-react';
import { TrainingSessionList } from './TrainingSessionList';
import { TrainingSessionDetail } from './TrainingSessionDetail';
import { TrainingLeadSelector } from './TrainingLeadSelector';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { toast } from 'sonner';

export interface TrainingSession {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  status: 'draft' | 'in_progress' | 'completed' | 'reviewed';
  property_address?: string;
  lat?: number;
  lng?: number;
  satellite_image_url?: string;
  pipeline_entry_id?: string;
  contact_id?: string;
  ai_measurement_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  created_by?: string;
}

export function RoofTrainingLab() {
  const { activeCompanyId } = useCompanySwitcher();
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null);
  const [showLeadSelector, setShowLeadSelector] = useState(false);
  const [activeTab, setActiveTab] = useState<'sessions' | 'analytics'>('sessions');

  // Fetch training sessions
  const { data: sessions = [], isLoading, refetch } = useQuery({
    queryKey: ['roof-training-sessions', activeCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .select('*')
        .eq('tenant_id', activeCompanyId!)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as TrainingSession[];
    },
    enabled: !!activeCompanyId,
  });

  const handleCreateSession = async (leadData: {
    pipelineEntryId: string;
    contactId?: string;
    address: string;
    lat: number;
    lng: number;
    name: string;
    satelliteImageUrl?: string;
    aiMeasurementId?: string;
  }) => {
    try {
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .insert({
          tenant_id: activeCompanyId,
          pipeline_entry_id: leadData.pipelineEntryId,
          contact_id: leadData.contactId,
          name: leadData.name,
          property_address: leadData.address,
          lat: leadData.lat,
          lng: leadData.lng,
          satellite_image_url: leadData.satelliteImageUrl,
          ai_measurement_id: leadData.aiMeasurementId,
          status: 'draft',
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Training session created');
      setShowLeadSelector(false);
      setSelectedSession(data as TrainingSession);
      refetch();
    } catch (err) {
      console.error('Error creating session:', err);
      toast.error('Failed to create training session');
    }
  };

  const handleSessionUpdate = () => {
    refetch();
  };

  // Stats
  const stats = {
    total: sessions.length,
    completed: sessions.filter(s => s.status === 'completed' || s.status === 'reviewed').length,
    inProgress: sessions.filter(s => s.status === 'in_progress').length,
    draft: sessions.filter(s => s.status === 'draft').length,
  };

  if (selectedSession) {
    return (
      <TrainingSessionDetail
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
        onUpdate={handleSessionUpdate}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Roof Measurement Training Lab</h1>
            <p className="text-muted-foreground">
              Train the AI by tracing roof components on satellite imagery
            </p>
          </div>
        </div>
        <Button onClick={() => setShowLeadSelector(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Training Session
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Sessions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.completed}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <PlayCircle className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.inProgress}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.draft}</p>
                <p className="text-sm text-muted-foreground">Drafts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'sessions' | 'analytics')}>
        <TabsList>
          <TabsTrigger value="sessions">Training Sessions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="mt-4">
          <TrainingSessionList
            sessions={sessions}
            isLoading={isLoading}
            onSelectSession={setSelectedSession}
          />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Training Analytics</CardTitle>
              <CardDescription>
                Track AI accuracy improvement over time (coming soon)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                Complete more training sessions to see analytics
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Lead Selector Dialog */}
      <TrainingLeadSelector
        open={showLeadSelector}
        onClose={() => setShowLeadSelector(false)}
        onSelect={handleCreateSession}
      />
    </div>
  );
}
