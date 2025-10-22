import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Phone, TrendingUp, Clock, Users } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  is_active: boolean;
  total_attempts: number;
  total_answered: number;
  total_bridged: number;
  avg_talk_time_seconds: number;
  created_at: string;
}

const Campaigns = () => {
  const { data: campaigns, refetch } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const tenantId = user?.user?.user_metadata?.tenant_id;

      const { data, error } = await supabase
        .from('dialer_campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Campaign[];
    },
  });

  const calculateMetrics = (campaign: Campaign) => {
    const connectRate = campaign.total_attempts > 0
      ? ((campaign.total_bridged / campaign.total_attempts) * 100).toFixed(1)
      : '0.0';

    const abandonRate = campaign.total_answered > 0
      ? (((campaign.total_answered - campaign.total_bridged) / campaign.total_answered) * 100).toFixed(1)
      : '0.0';

    const avgTalkTime = campaign.avg_talk_time_seconds > 0
      ? `${Math.floor(campaign.avg_talk_time_seconds / 60)}:${(campaign.avg_talk_time_seconds % 60).toString().padStart(2, '0')}`
      : '0:00';

    return { connectRate, abandonRate, avgTalkTime };
  };

  return (
    <GlobalLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Dialer Campaigns</h1>
            <p className="text-muted-foreground">Monitor campaign performance and metrics</p>
          </div>
          <Button onClick={() => refetch()}>
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{campaigns?.length || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Now</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {campaigns?.filter((c) => c.is_active).length || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Attempts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {campaigns?.reduce((sum, c) => sum + c.total_attempts, 0) || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Bridged</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {campaigns?.reduce((sum, c) => sum + c.total_bridged, 0) || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Campaign List */}
        <div className="space-y-4">
          {campaigns?.map((campaign) => {
            const metrics = calculateMetrics(campaign);
            
            return (
              <Card key={campaign.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>{campaign.name}</CardTitle>
                      <CardDescription>{campaign.description}</CardDescription>
                    </div>
                    <Badge variant={campaign.is_active ? 'default' : 'secondary'}>
                      {campaign.is_active ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Attempts */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Attempts</span>
                      </div>
                      <p className="text-2xl font-bold">{campaign.total_attempts}</p>
                      <Progress value={100} className="h-2" />
                    </div>

                    {/* Answered */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Answered</span>
                      </div>
                      <p className="text-2xl font-bold">{campaign.total_answered}</p>
                      <Progress 
                        value={campaign.total_attempts > 0 ? (campaign.total_answered / campaign.total_attempts) * 100 : 0} 
                        className="h-2" 
                      />
                    </div>

                    {/* Connect Rate */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Connect Rate</span>
                      </div>
                      <p className="text-2xl font-bold">{metrics.connectRate}%</p>
                      <p className="text-xs text-muted-foreground">
                        Abandon: {metrics.abandonRate}%
                      </p>
                    </div>

                    {/* Avg Talk Time */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Avg Talk Time</span>
                      </div>
                      <p className="text-2xl font-bold">{metrics.avgTalkTime}</p>
                      <p className="text-xs text-muted-foreground">
                        Bridged: {campaign.total_bridged}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {campaigns?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No campaigns found. Create your first campaign to get started.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </GlobalLayout>
  );
};

export default Campaigns;
