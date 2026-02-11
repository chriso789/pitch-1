import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings, BarChart3, Phone, MessageSquare, FileText } from 'lucide-react';
import { CallAnalyticsDashboard } from '@/components/ai-agent/CallAnalyticsDashboard';
import { LiveCallTranscript } from '@/components/ai-agent/LiveCallTranscript';
import { OutboundCampaignBuilder } from '@/components/ai-agent/OutboundCampaignBuilder';
import { CallTranscriptViewer } from '@/components/ai-agent/CallTranscriptViewer';

export default function AIAgentDashboardPage() {
  const navigate = useNavigate();

  return (
    <GlobalLayout>
      <div className="container max-w-7xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold">AI Agent Command Center</h1>
              <p className="text-muted-foreground">Monitor and manage your AI call agent</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/settings/ai-agent')}>
            <Settings className="h-4 w-4 mr-2" />
            Agent Settings
          </Button>
        </div>

        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-4">
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="live" className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Live Calls
            </TabsTrigger>
            <TabsTrigger value="transcripts" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Transcripts
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Campaigns
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
            <CallAnalyticsDashboard />
          </TabsContent>

          <TabsContent value="live">
            <div className="grid lg:grid-cols-2 gap-6">
              <LiveCallTranscript />
              <div className="space-y-4">
                <div className="p-4 rounded-lg border bg-card">
                  <h3 className="font-semibold mb-2">Quick Actions</h3>
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full justify-start">
                      View Recent Transcripts
                    </Button>
                    <Button variant="outline" className="w-full justify-start">
                      Export Call Data
                    </Button>
                    <Button variant="outline" className="w-full justify-start">
                      Configure Escalation Rules
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="transcripts">
            <CallTranscriptViewer />
          </TabsContent>

          <TabsContent value="campaigns">
            <OutboundCampaignBuilder />
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
}
