import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Brain, 
  TrendingUp, 
  Target, 
  Zap, 
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Lightbulb
} from 'lucide-react';

interface AILeadScorerProps {
  contactId?: string;
  contact?: any;
  onScoreUpdated?: (score: number, status: string) => void;
}

export const AILeadScorer: React.FC<AILeadScorerProps> = ({
  contactId,
  contact,
  onScoreUpdated
}) => {
  const { toast } = useToast();
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<any>(null);
  const [bulkScoring, setBulkScoring] = useState(false);

  const scoreContact = async () => {
    if (!contactId && !contact) {
      toast({
        title: "Error",
        description: "Contact information is required for scoring",
        variant: "destructive",
      });
      return;
    }

    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-lead-scorer', {
        body: {
          contact_id: contactId,
          contact_data: contact
        }
      });

      if (error) throw error;

      setScoreResult(data);
      onScoreUpdated?.(data.score, data.qualification_status);

      toast({
        title: "Lead Scored Successfully",
        description: `Score: ${data.score}/100 (${data.qualification_status.replace('_', ' ')})`,
      });

    } catch (error: any) {
      console.error('Error scoring lead:', error);
      toast({
        title: "Scoring Error",
        description: error.message || 'Failed to score lead',
        variant: "destructive",
      });
    } finally {
      setScoring(false);
    }
  };

  const bulkScoreLeads = async () => {
    setBulkScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-lead-scorer', {
        body: {
          bulk_score: true
        }
      });

      if (error) throw error;

      toast({
        title: "Bulk Scoring Complete",
        description: `Successfully scored ${data.scored_contacts} contacts`,
      });

    } catch (error: any) {
      console.error('Error bulk scoring:', error);
      toast({
        title: "Bulk Scoring Error",
        description: error.message || 'Failed to bulk score leads',
        variant: "destructive",
      });
    } finally {
      setBulkScoring(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreBadgeVariant = (status: string) => {
    switch (status) {
      case 'hot_lead':
        return 'destructive';
      case 'warm_lead':
        return 'default';
      case 'cold_lead':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'hot_lead':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warm_lead':
        return <Clock className="h-4 w-4" />;
      case 'cold_lead':
        return <Target className="h-4 w-4" />;
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Lead Scorer Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Lead Scorer
            </CardTitle>
            <div className="flex gap-2">
              {contactId && (
                <Button 
                  onClick={scoreContact} 
                  disabled={scoring}
                  size="sm"
                >
                  {scoring ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Scoring...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Score Lead
                    </>
                  )}
                </Button>
              )}
              <Button 
                onClick={bulkScoreLeads} 
                disabled={bulkScoring}
                variant="outline"
                size="sm"
              >
                {bulkScoring ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Bulk Scoring...
                  </>
                ) : (
                  <>
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Bulk Score All
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Score Results */}
      {scoreResult && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Score Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Lead Score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className={`text-4xl font-bold ${getScoreColor(scoreResult.score)}`}>
                  {scoreResult.score}/100
                </div>
                <Badge 
                  variant={getScoreBadgeVariant(scoreResult.qualification_status)}
                  className="mt-2"
                >
                  <div className="flex items-center gap-1">
                    {getStatusIcon(scoreResult.qualification_status)}
                    {scoreResult.qualification_status.replace('_', ' ').toUpperCase()}
                  </div>
                </Badge>
              </div>

              <div className="space-y-2">
                <Progress value={scoreResult.score} className="h-3" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Unqualified</span>
                  <span>Cold</span>
                  <span>Warm</span>
                  <span>Hot</span>
                </div>
              </div>

              {scoreResult.details && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {scoreResult.details.base_score && (
                    <div>
                      <span className="text-muted-foreground">Base Score:</span>
                      <p className="font-medium">{scoreResult.details.base_score}/100</p>
                    </div>
                  )}
                  {scoreResult.details.ai_enhanced_score && (
                    <div>
                      <span className="text-muted-foreground">AI Enhanced:</span>
                      <p className="font-medium">{scoreResult.details.ai_enhanced_score}/100</p>
                    </div>
                  )}
                  {scoreResult.details.ai_confidence && (
                    <div>
                      <span className="text-muted-foreground">Confidence:</span>
                      <p className="font-medium">{(scoreResult.details.ai_confidence * 100).toFixed(0)}%</p>
                    </div>
                  )}
                  {scoreResult.details.applied_rules && (
                    <div>
                      <span className="text-muted-foreground">Rules Applied:</span>
                      <p className="font-medium">{scoreResult.details.applied_rules.length}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Insights */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lightbulb className="h-5 w-5" />
                AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Key Factors */}
              {scoreResult.details?.key_factors && scoreResult.details.key_factors.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 text-green-600">Key Positive Factors</h4>
                  <div className="space-y-1">
                    {scoreResult.details.key_factors.map((factor: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{factor}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Red Flags */}
              {scoreResult.details?.red_flags && scoreResult.details.red_flags.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 text-red-600">Red Flags</h4>
                  <div className="space-y-1">
                    {scoreResult.details.red_flags.map((flag: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {scoreResult.recommendations && scoreResult.recommendations.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 text-blue-600">Recommendations</h4>
                  <div className="space-y-1">
                    {scoreResult.recommendations.map((rec: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <Target className="h-3 w-3 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Applied Rules Details */}
      {scoreResult?.details?.applied_rules && scoreResult.details.applied_rules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Applied Scoring Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {scoreResult.details.applied_rules.map((rule: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{rule.rule_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {rule.field}: {rule.value}
                    </p>
                  </div>
                  <Badge variant="outline">
                    +{rule.points} pts
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Score Results */}
      {!scoreResult && (contactId || contact) && (
        <Card>
          <CardContent className="p-6 text-center">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">AI Lead Scoring</h3>
            <p className="text-muted-foreground mb-4">
              Use AI-powered analysis to score this lead based on multiple factors including demographics, 
              behavior, and market conditions.
            </p>
            <Button onClick={scoreContact} disabled={scoring}>
              {scoring ? 'Analyzing...' : 'Score This Lead'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};