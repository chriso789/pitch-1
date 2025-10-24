import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle2 } from "lucide-react";

interface NPSSurveyProps {
  contactId: string;
  projectId?: string;
  surveyType?: string;
  onComplete?: () => void;
}

export default function NPSSurvey({ contactId, projectId, surveyType = 'post_completion', onComplete }: NPSSurveyProps) {
  const { toast } = useToast();
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (selectedScore === null) {
        throw new Error('Please select a score');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { error } = await supabase
        .from('satisfaction_surveys')
        .insert({
          tenant_id: profile.tenant_id,
          contact_id: contactId,
          project_id: projectId,
          survey_type: surveyType,
          nps_score: selectedScore,
          completed_at: new Date().toISOString(),
          feedback: feedback ? { comment: feedback } : null,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      setIsSubmitted(true);
      toast({ 
        title: "Thank you for your feedback!", 
        description: "Your response has been recorded." 
      });
      if (onComplete) onComplete();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to submit survey", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const getScoreLabel = (score: number) => {
    if (score <= 6) return 'Not Likely';
    if (score <= 8) return 'Neutral';
    return 'Very Likely';
  };

  const getScoreColor = (score: number) => {
    if (score <= 6) return 'bg-red-500 hover:bg-red-600';
    if (score <= 8) return 'bg-yellow-500 hover:bg-yellow-600';
    return 'bg-green-500 hover:bg-green-600';
  };

  if (isSubmitted) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h3 className="text-xl font-semibold">Thank You!</h3>
            <p className="text-muted-foreground">
              Your feedback helps us improve our service.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>How likely are you to recommend us?</CardTitle>
        <CardDescription>
          On a scale of 0 to 10, where 10 is extremely likely
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* NPS Score Buttons */}
        <div className="space-y-3">
          <div className="grid grid-cols-11 gap-2">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
              <Button
                key={score}
                variant={selectedScore === score ? 'default' : 'outline'}
                className={`
                  h-12 w-full p-0 text-lg font-semibold
                  ${selectedScore === score ? getScoreColor(score) : ''}
                `}
                onClick={() => setSelectedScore(score)}
              >
                {score}
              </Button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Not at all likely</span>
            <span>Extremely likely</span>
          </div>
        </div>

        {/* Feedback based on selected score */}
        {selectedScore !== null && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="text-center">
              <p className="text-lg font-semibold">
                {getScoreLabel(selectedScore)}
              </p>
              {selectedScore >= 9 && (
                <p className="text-sm text-green-600">
                  We're thrilled you had a great experience!
                </p>
              )}
              {selectedScore >= 7 && selectedScore <= 8 && (
                <p className="text-sm text-yellow-600">
                  Thanks for your feedback. How can we improve?
                </p>
              )}
              {selectedScore <= 6 && (
                <p className="text-sm text-red-600">
                  We're sorry to hear that. Please let us know what went wrong.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {selectedScore >= 9 
                  ? "What did you love most about our service?"
                  : "How can we improve your experience?"}
              </label>
              <Textarea
                placeholder="Share your thoughts..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
