import { useState } from 'react';
import { Lightbulb, Loader2, DollarSign, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Recommendation {
  service: string;
  reason: string;
  estimatedValue: number;
  confidence: 'high' | 'medium' | 'low';
}

interface UpsellRecommendationsProps {
  projectId?: string;
  contactId?: string;
  propertyData?: {
    address?: string;
    propertyType?: string;
    roofArea?: number;
    jobType?: string;
  };
}

export const UpsellRecommendations = ({
  projectId,
  contactId,
  propertyData,
}: UpsellRecommendationsProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  const generateRecommendations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('upsell-recommendations', {
        body: { project_id: projectId, contact_id: contactId, property_data: propertyData },
      });

      if (error) throw error;
      setRecommendations(data?.recommendations || []);
    } catch (err) {
      console.error('Upsell error:', err);
      toast({ title: 'Error', description: 'Failed to generate recommendations', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = (c: string) => {
    if (c === 'high') return 'bg-green-500/15 text-green-700 dark:text-green-400';
    if (c === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          Upsell Opportunities
        </CardTitle>
        <Button size="sm" variant="outline" onClick={generateRecommendations} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          <span className="ml-1">{recommendations.length ? 'Refresh' : 'Analyze'}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            Click "Analyze" to get AI-powered add-on suggestions based on property data.
          </p>
        )}
        {recommendations.length > 0 && (
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-muted/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{rec.service}</span>
                    <Badge variant="outline" className={`border-0 text-xs ${confidenceColor(rec.confidence)}`}>
                      {rec.confidence}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{rec.reason}</p>
                </div>
                <div className="flex items-center gap-1 text-sm font-semibold text-green-600 dark:text-green-400">
                  <DollarSign className="h-3.5 w-3.5" />
                  {rec.estimatedValue.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
