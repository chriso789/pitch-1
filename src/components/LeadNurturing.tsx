import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Play, Pause, Users, Mail, MessageCircle, Target, TrendingUp, Clock, CheckCircle, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { CampaignBuilder } from '@/components/CampaignBuilder';
import { MessageTemplates } from '@/components/MessageTemplates';

interface NurturingCampaign {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_conditions: any;
  target_audience: any;
  is_active: boolean;
  priority: number;
  total_enrolled: number;
  total_completed: number;
  conversion_rate: number;
  created_at: string;
  steps?: CampaignStep[];
}

interface CampaignStep {
  id: string;
  step_order: number;
  step_name: string;
  step_type: string;
  delay_hours: number;
  content_template: string;
  is_active: boolean;
  success_count: number;
  failure_count: number;
}

interface NurturingStats {
  total_campaigns: number;
  active_campaigns: number;
  total_enrolled: number;
  total_completed: number;
  avg_conversion_rate: number;
  pending_actions: number;
}

export const LeadNurturing = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [campaigns, setCampaigns] = useState<NurturingCampaign[]>([]);
  const [nurturingStats, setNurturingStats] = useState<NurturingStats>({
    total_campaigns: 0,
    active_campaigns: 0,
    total_enrolled: 0,
    total_completed: 0,
    avg_conversion_rate: 0,
    pending_actions: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isCampaignBuilderOpen, setIsCampaignBuilderOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      await Promise.all([
        fetchCampaigns(),
        fetchNurturingStats()
      ]);
    } catch (error) {
      console.error('Error fetching nurturing data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const { data, error } = await supabase
        .from('nurturing_campaigns')
        .select(`
          *,
          nurturing_campaign_steps (
            id,
            step_order,
            step_name,
            step_type,
            delay_hours,
            content_template,
            is_active,
            success_count,
            failure_count
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const campaignsWithSteps = data?.map(campaign => ({
        ...campaign,
        steps: campaign.nurturing_campaign_steps || []
      })) || [];

      setCampaigns(campaignsWithSteps);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast({
        title: "Error",
        description: "Failed to fetch nurturing campaigns",
        variant: "destructive",
      });
    }
  };

  const fetchNurturingStats = async () => {
    try {
      // Get campaign stats
      const { data: campaignData, error: campaignError } = await supabase
        .from('nurturing_campaigns')
        .select('is_active, total_enrolled, total_completed, conversion_rate');

      if (campaignError) throw campaignError;

      // Get pending actions count
      const { count: pendingCount, error: pendingError } = await supabase
        .from('nurturing_step_executions')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'scheduled']);

      if (pendingError) throw pendingError;

      const totalCampaigns = campaignData?.length || 0;
      const activeCampaigns = campaignData?.filter(c => c.is_active).length || 0;
      const totalEnrolled = campaignData?.reduce((sum, c) => sum + (c.total_enrolled || 0), 0) || 0;
      const totalCompleted = campaignData?.reduce((sum, c) => sum + (c.total_completed || 0), 0) || 0;
      const avgConversionRate = totalCampaigns > 0 
        ? campaignData.reduce((sum, c) => sum + (c.conversion_rate || 0), 0) / totalCampaigns 
        : 0;

      setNurturingStats({
        total_campaigns: totalCampaigns,
        active_campaigns: activeCampaigns,
        total_enrolled: totalEnrolled,
        total_completed: totalCompleted,
        avg_conversion_rate: Math.round(avgConversionRate * 100) / 100,
        pending_actions: pendingCount || 0
      });
    } catch (error) {
      console.error('Error fetching nurturing stats:', error);
    }
  };

  const handleToggleCampaign = async (campaignId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('nurturing_campaigns')
        .update({ is_active: !isActive })
        .eq('id', campaignId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Campaign ${!isActive ? 'activated' : 'paused'} successfully`,
      });

      fetchCampaigns();
    } catch (error) {
      console.error('Error toggling campaign:', error);
      toast({
        title: "Error",
        description: "Failed to update campaign status",
        variant: "destructive",
      });
    }
  };

  const getTriggerTypeBadgeVariant = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      lead_score: "default",
      status_change: "secondary",
      time_based: "outline",
      behavior: "destructive"
    };
    return variants[type] || "outline";
  };

  const getStepTypeIcon = (stepType: string) => {
    switch (stepType) {
      case 'email': return <Mail className="h-4 w-4" />;
      case 'sms': return <MessageCircle className="h-4 w-4" />;
      case 'call_reminder': return <Phone className="h-4 w-4" />;
      case 'task': return <CheckCircle className="h-4 w-4" />;
      case 'wait': return <Clock className="h-4 w-4" />;
      default: return <Target className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Lead Nurturing
          </h1>
          <p className="text-muted-foreground">
            Automate follow-up campaigns and nurture leads through personalized sequences
          </p>
        </div>
        <Dialog open={isCampaignBuilderOpen} onOpenChange={setIsCampaignBuilderOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Nurturing Campaign</DialogTitle>
              <DialogDescription>
                Set up automated sequences to nurture leads based on their behavior and characteristics
              </DialogDescription>
            </DialogHeader>
            <CampaignBuilder 
              onSave={() => {
                setIsCampaignBuilderOpen(false);
                fetchCampaigns();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Target className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Campaigns</p>
                    <p className="text-2xl font-bold">{nurturingStats.total_campaigns}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Play className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active</p>
                    <p className="text-2xl font-bold">{nurturingStats.active_campaigns}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Enrolled</p>
                    <p className="text-2xl font-bold">{nurturingStats.total_enrolled}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Completed</p>
                    <p className="text-2xl font-bold">{nurturingStats.total_completed}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Conversion</p>
                    <p className="text-2xl font-bold">{nurturingStats.avg_conversion_rate}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold">{nurturingStats.pending_actions}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Active Campaigns Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Active Campaigns</CardTitle>
              <CardDescription>Currently running nurturing sequences</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {campaigns.filter(c => c.is_active).map((campaign) => (
                  <div key={campaign.id} className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="space-y-1">
                      <h4 className="font-medium">{campaign.name}</h4>
                      <div className="flex items-center space-x-2">
                        <Badge variant={getTriggerTypeBadgeVariant(campaign.trigger_type)}>
                          {campaign.trigger_type.replace('_', ' ')}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {campaign.steps?.length || 0} steps
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <p className="text-sm font-medium">{campaign.total_enrolled} enrolled</p>
                        <p className="text-sm text-muted-foreground">
                          {campaign.conversion_rate}% conversion
                        </p>
                      </div>
                      <Progress 
                        value={campaign.total_enrolled > 0 ? (campaign.total_completed / campaign.total_enrolled) * 100 : 0} 
                        className="w-20"
                      />
                    </div>
                  </div>
                ))}
                
                {campaigns.filter(c => c.is_active).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No active campaigns. Create your first campaign to start nurturing leads.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>All Campaigns</CardTitle>
              <CardDescription>Manage your lead nurturing campaigns</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign Name</TableHead>
                    <TableHead>Trigger Type</TableHead>
                    <TableHead>Steps</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Conversion</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{campaign.name}</div>
                          {campaign.description && (
                            <div className="text-sm text-muted-foreground">{campaign.description}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getTriggerTypeBadgeVariant(campaign.trigger_type)}>
                          {campaign.trigger_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>{campaign.steps?.length || 0}</TableCell>
                      <TableCell>{campaign.total_enrolled}</TableCell>
                      <TableCell>
                        <span className="font-medium">{campaign.conversion_rate}%</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={campaign.is_active ? "default" : "secondary"}>
                          {campaign.is_active ? "Active" : "Paused"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleToggleCampaign(campaign.id, campaign.is_active)}
                        >
                          {campaign.is_active ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {campaigns.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No campaigns created yet. Create your first campaign to start nurturing leads.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-6">
          <MessageTemplates />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Campaign Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {campaigns.slice(0, 5).map((campaign) => (
                    <div key={campaign.id} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{campaign.name}</span>
                        <span>{campaign.conversion_rate}%</span>
                      </div>
                      <Progress value={campaign.conversion_rate} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Engagement Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Messages Sent</span>
                    <span className="font-medium">
                      {campaigns.reduce((sum, c) => sum + ((c.steps?.reduce((stepSum, s) => stepSum + s.success_count, 0) || 0)), 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Average Open Rate</span>
                    <span className="font-medium">24.5%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Average Click Rate</span>
                    <span className="font-medium">3.2%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Conversion Rate</span>
                    <span className="font-medium text-green-600">{nurturingStats.avg_conversion_rate}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};