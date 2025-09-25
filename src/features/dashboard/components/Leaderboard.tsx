import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Trophy, 
  TrendingUp, 
  DollarSign, 
  Award,
  Calendar,
  User,
  Star,
  Crown,
  Medal,
  Target
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface LeaderboardData {
  rep_name: string;
  converted_projects: number;
  converted_projects_value: number;
  leads: number;
  leads_value: number;
  contingencies: number;
  contingencies_value: number;
  legal_jobs: number;
  legal_jobs_value: number;
  signed_contingencies: number;
  total_value: number;
}

const Leaderboard = () => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState('week');
  const { toast } = useToast();

  useEffect(() => {
    fetchLeaderboardData();
  }, [timeframe]);

  const fetchLeaderboardData = async () => {
    try {
      setLoading(true);
      
      // Calculate date range based on timeframe
      const now = new Date();
      let startDate: Date;
      
      switch (timeframe) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'quarter':
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStartMonth, 1);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      // Fetch pipeline entries with related data
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
          estimates (*),
          profiles!pipeline_entries_assigned_to_fkey (
            first_name,
            last_name
          )
        `)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (pipelineError) throw pipelineError;

      // Process data to create leaderboard
      const repStats: { [key: string]: LeaderboardData } = {};

      pipelineData?.forEach(entry => {
        const repName = entry.profiles 
          ? `${entry.profiles.first_name} ${entry.profiles.last_name}`
          : 'Unassigned';
        
        if (!repStats[repName]) {
          repStats[repName] = {
            rep_name: repName,
            converted_projects: 0,
            converted_projects_value: 0,
            leads: 0,
            leads_value: 0,
            contingencies: 0,
            contingencies_value: 0,
            legal_jobs: 0,
            legal_jobs_value: 0,
            signed_contingencies: 0,
            total_value: 0
          };
        }

        const estimate = entry.estimates?.[0];
        const estimateValue = estimate?.selling_price || entry.estimated_value || 0;

        // Categorize by status
        switch (entry.status) {
          case 'project':
          case 'completed':
            repStats[repName].converted_projects++;
            repStats[repName].converted_projects_value += estimateValue;
            break;
          case 'lead':
            repStats[repName].leads++;
            repStats[repName].leads_value += estimateValue;
            break;
          case 'contingency_signed':
            repStats[repName].contingencies++;
            repStats[repName].contingencies_value += estimateValue;
            repStats[repName].signed_contingencies++;
            break;
          case 'legal_review':
            repStats[repName].legal_jobs++;
            repStats[repName].legal_jobs_value += estimateValue;
            break;
        }

        repStats[repName].total_value += estimateValue;
      });

      // Convert to array and sort by total value
      const sortedData = Object.values(repStats)
        .filter(rep => rep.rep_name !== 'Unassigned')
        .sort((a, b) => b.total_value - a.total_value);

      setLeaderboardData(sortedData);

    } catch (error) {
      console.error('Error fetching leaderboard data:', error);
      toast({
        title: "Error",
        description: "Failed to load leaderboard data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return <Crown className="h-5 w-5 text-yellow-500" />;
      case 1:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 2:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <Target className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getRankBadge = (index: number) => {
    switch (index) {
      case 0:
        return <Badge className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-white">🥇 1st</Badge>;
      case 1:
        return <Badge className="bg-gradient-to-r from-gray-300 to-gray-500 text-white">🥈 2nd</Badge>;
      case 2:
        return <Badge className="bg-gradient-to-r from-amber-400 to-amber-600 text-white">🥉 3rd</Badge>;
      default:
        return <Badge variant="outline">#{index + 1}</Badge>;
    }
  };

  if (loading) {
    return (
      <Card className="shadow-soft border-0">
        <CardContent className="p-6 text-center">
          <div className="animate-pulse">Loading leaderboard...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-soft border-0">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Sales Leaderboard
          </CardTitle>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {leaderboardData.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No data available for the selected timeframe
          </div>
        ) : (
          <>
            {/* Top 3 Spotlight */}
            {leaderboardData.slice(0, 3).length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {leaderboardData.slice(0, 3).map((rep, index) => (
                  <Card key={rep.rep_name} className={`shadow-soft border-0 ${index === 0 ? 'ring-2 ring-yellow-200' : ''}`}>
                    <CardContent className="p-4 text-center">
                      <div className="flex justify-center mb-2">
                        {getRankIcon(index)}
                      </div>
                      {getRankBadge(index)}
                      <div className="mt-2">
                        <h3 className="font-semibold">{rep.rep_name}</h3>
                        <p className="text-2xl font-bold text-success">{formatCurrency(rep.total_value)}</p>
                        <p className="text-xs text-muted-foreground">Total Pipeline Value</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Detailed Leaderboard */}
            <div className="space-y-3">
              {leaderboardData.map((rep, index) => (
                <Card key={rep.rep_name} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getRankIcon(index)}
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{rep.rep_name}</h3>
                            {getRankBadge(index)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Total: {formatCurrency(rep.total_value)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-lg font-bold text-success">{rep.converted_projects}</div>
                          <div className="text-xs text-muted-foreground">Projects</div>
                          <div className="text-xs text-success">{formatCurrency(rep.converted_projects_value)}</div>
                        </div>
                        
                        <div>
                          <div className="text-lg font-bold text-primary">{rep.leads}</div>
                          <div className="text-xs text-muted-foreground">Leads</div>
                          <div className="text-xs text-primary">{formatCurrency(rep.leads_value)}</div>
                        </div>
                        
                        <div>
                          <div className="text-lg font-bold text-warning">{rep.contingencies}</div>
                          <div className="text-xs text-muted-foreground">Contingencies</div>
                          <div className="text-xs text-warning">{formatCurrency(rep.contingencies_value)}</div>
                        </div>
                        
                        <div>
                          <div className="text-lg font-bold text-destructive">{rep.legal_jobs}</div>
                          <div className="text-xs text-muted-foreground">Legal</div>
                          <div className="text-xs text-destructive">{formatCurrency(rep.legal_jobs_value)}</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Additional metrics row */}
                    <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">
                          Signed Contingencies: <span className="font-medium text-success">{rep.signed_contingencies}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-yellow-500" />
                        <span className="font-medium">
                          {((rep.converted_projects / Math.max(rep.leads, 1)) * 100).toFixed(1)}% conversion
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default Leaderboard;