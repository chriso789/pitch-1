import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Users, Gift, DollarSign, Link, Copy, CheckCircle, Clock, TrendingUp, Share2 } from 'lucide-react';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Referral {
  id: string;
  referrer_id: string;
  referred_contact_id?: string;
  referral_code: string;
  status: 'pending' | 'converted' | 'rewarded' | 'expired';
  reward_amount?: number;
  reward_type?: string;
  created_at: string;
  converted_at?: string;
  referrer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  referred?: {
    first_name?: string;
    last_name?: string;
  };
}

interface ReferralStats {
  total_referrals: number;
  converted: number;
  pending: number;
  total_rewards_paid: number;
  conversion_rate: number;
}

export const ReferralProgramManager: React.FC = () => {
  const { activeCompany } = useCompanySwitcher();
  const [selectedTab, setSelectedTab] = useState('overview');

  const { data: referrals, isLoading } = useQuery({
    queryKey: ['referrals', activeCompany?.tenant_id],
    queryFn: async () => {
      if (!activeCompany?.tenant_id) return [];

      const { data, error } = await supabase
        .from('customer_referrals')
        .select('*')
        .eq('tenant_id', activeCompany.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as any[];
    },
    enabled: !!activeCompany?.tenant_id
  });

  const stats: ReferralStats = {
    total_referrals: referrals?.length || 0,
    converted: referrals?.filter(r => r.status === 'converted' || r.status === 'rewarded').length || 0,
    pending: referrals?.filter(r => r.status === 'pending').length || 0,
    total_rewards_paid: referrals?.filter(r => r.status === 'rewarded').reduce((sum, r) => sum + (r.reward_amount || 0), 0) || 0,
    conversion_rate: referrals?.length ? ((referrals.filter(r => r.status === 'converted' || r.status === 'rewarded').length / referrals.length) * 100) : 0
  };

  const generateReferralLink = (code: string) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/refer/${code}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
      case 'converted':
        return <Badge className="bg-blue-100 text-blue-800"><CheckCircle className="h-3 w-3 mr-1" /> Converted</Badge>;
      case 'rewarded':
        return <Badge className="bg-green-100 text-green-800"><Gift className="h-3 w-3 mr-1" /> Rewarded</Badge>;
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Referral Program
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="referrals">Referrals</TabsTrigger>
            <TabsTrigger value="rewards">Rewards</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <p className="text-2xl font-bold">{stats.total_referrals}</p>
                  <p className="text-sm text-muted-foreground">Total Referrals</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p className="text-2xl font-bold">{stats.converted}</p>
                  <p className="text-sm text-muted-foreground">Converted</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <TrendingUp className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                  <p className="text-2xl font-bold">{stats.conversion_rate.toFixed(1)}%</p>
                  <p className="text-sm text-muted-foreground">Conversion Rate</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <DollarSign className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                  <p className="text-2xl font-bold">${stats.total_rewards_paid.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">Rewards Paid</p>
                </CardContent>
              </Card>
            </div>

            {/* Conversion Funnel */}
            <Card>
              <CardContent className="p-4">
                <h4 className="font-medium mb-4">Referral Funnel</h4>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Referred</span>
                      <span className="text-sm font-medium">{stats.total_referrals}</span>
                    </div>
                    <Progress value={100} className="h-3" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Converted to Lead</span>
                      <span className="text-sm font-medium">{stats.converted + stats.pending}</span>
                    </div>
                    <Progress 
                      value={stats.total_referrals ? ((stats.converted + stats.pending) / stats.total_referrals) * 100 : 0} 
                      className="h-3" 
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Closed & Rewarded</span>
                      <span className="text-sm font-medium">{referrals?.filter(r => r.status === 'rewarded').length || 0}</span>
                    </div>
                    <Progress 
                      value={stats.total_referrals ? ((referrals?.filter(r => r.status === 'rewarded').length || 0) / stats.total_referrals) * 100 : 0} 
                      className="h-3" 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="referrals">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading referrals...</div>
            ) : referrals && referrals.length > 0 ? (
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Referrer</TableHead>
                    <TableHead>Referred</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referrals.map((referral) => (
                    <TableRow key={referral.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {referral.referrer?.first_name} {referral.referrer?.last_name}
                          </p>
                          <p className="text-sm text-muted-foreground">{referral.referrer?.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {referral.referred ? (
                          `${referral.referred.first_name} ${referral.referred.last_name}`
                        ) : (
                          <span className="text-muted-foreground">Pending</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {referral.referral_code}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(generateReferralLink(referral.referral_code))}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(referral.status)}</TableCell>
                      <TableCell>
                        {referral.reward_amount ? (
                          <span className="font-medium text-green-600">
                            ${referral.reward_amount}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(referral.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Share2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No referrals yet</p>
                <p className="text-sm">Share referral links with customers to get started</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="rewards">
            <Card className="mt-4">
              <CardContent className="p-6">
                <h4 className="font-medium mb-4">Reward Structure</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Gift className="h-8 w-8 text-primary" />
                      <div>
                        <p className="font-medium">Customer Referral</p>
                        <p className="text-sm text-muted-foreground">When a referred customer completes a project</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-600">$250</p>
                      <p className="text-sm text-muted-foreground">per closed deal</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Users className="h-8 w-8 text-blue-500" />
                      <div>
                        <p className="font-medium">5+ Referral Bonus</p>
                        <p className="text-sm text-muted-foreground">Extra reward for 5+ successful referrals</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-600">+$100</p>
                      <p className="text-sm text-muted-foreground">bonus</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
