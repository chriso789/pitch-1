import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, Users, Award } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

export const LeadScoringActions = () => {
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const handleRecalculateAllScores = async () => {
    setIsRecalculating(true);
    setProgress(0);

    try {
      // Call the score-lead edge function to recalculate all scores
      const { data, error } = await supabase.functions.invoke('score-lead', {
        body: {
          recalculateAll: true
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Success",
          description: `Recalculated scores for ${data.results?.length || 0} contacts`,
        });
        setProgress(100);
      } else {
        throw new Error(data?.error || 'Failed to recalculate scores');
      }
    } catch (error) {
      console.error('Error recalculating scores:', error);
      toast({
        title: "Error",
        description: "Failed to recalculate lead scores",
        variant: "destructive",
      });
    } finally {
      setTimeout(() => {
        setIsRecalculating(false);
        setProgress(0);
      }, 2000);
    }
  };

  const handleScoreIndividualLead = async (contactId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('score-lead', {
        body: {
          contactId: contactId
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Success",
          description: `Updated lead score: ${data.oldScore} → ${data.newScore}`,
        });
      } else {
        throw new Error(data?.error || 'Failed to score lead');
      }
    } catch (error) {
      console.error('Error scoring lead:', error);
      toast({
        title: "Error",
        description: "Failed to score lead",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Lead Scoring Actions
        </CardTitle>
        <CardDescription>
          Manage and update lead scores across your database
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">Bulk Actions</h4>
            <Button
              onClick={handleRecalculateAllScores}
              disabled={isRecalculating}
              className="w-full"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRecalculating ? 'animate-spin' : ''}`} />
              {isRecalculating ? 'Recalculating...' : 'Recalculate All Lead Scores'}
            </Button>
            
            {isRecalculating && (
              <div className="mt-2">
                <Progress value={progress} className="w-full" />
                <p className="text-sm text-muted-foreground mt-1">
                  Processing lead scores...
                </p>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">About Lead Scoring</h4>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Lead scoring automatically evaluates contacts based on your configured rules:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Hot (80-100):</strong> High-priority leads ready for immediate contact</li>
                <li><strong>Warm (60-79):</strong> Qualified leads worth pursuing</li>
                <li><strong>Cool (40-59):</strong> Potential leads requiring nurturing</li>
                <li><strong>Cold (0-39):</strong> Low-priority or unqualified leads</li>
              </ul>
              <p className="mt-2">
                Scores are calculated automatically when contacts are created or updated. 
                Use the recalculate function when you update scoring rules.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Export a function that can be called from other components
export const scoreIndividualLead = async (contactId: string) => {
  try {
    const { data, error } = await supabase.functions.invoke('score-lead', {
      body: {
        contactId: contactId
      }
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error scoring individual lead:', error);
    throw error;
  }
};