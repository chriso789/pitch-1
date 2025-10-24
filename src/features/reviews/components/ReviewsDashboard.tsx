import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Star, MessageSquare, TrendingUp, Send } from "lucide-react";
import { format } from "date-fns";

export default function ReviewsDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState<{ [key: string]: string }>({});

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['customer-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_reviews')
        .select(`
          *,
          contacts(first_name, last_name),
          projects(title)
        `)
        .order('reviewed_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['review-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_reviews')
        .select('rating');
      if (error) throw error;

      const total = data.length;
      const avgRating = total > 0 
        ? data.reduce((sum, r) => sum + (r.rating || 0), 0) / total 
        : 0;
      
      const distribution = [5, 4, 3, 2, 1].map(rating => ({
        rating,
        count: data.filter(r => r.rating === rating).length,
        percentage: total > 0 ? (data.filter(r => r.rating === rating).length / total) * 100 : 0,
      }));

      return { total, avgRating, distribution };
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ reviewId, responseText }: { reviewId: string; responseText: string }) => {
      const { error } = await supabase
        .from('customer_reviews')
        .update({ 
          response_text: responseText,
          responded_at: new Date().toISOString(),
        })
        .eq('id', reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-reviews'] });
      toast({ title: "Response posted", description: "Your reply has been saved." });
      setReplyText({});
    },
    onError: (error: Error) => {
      toast({ title: "Failed to post response", description: error.message, variant: "destructive" });
    },
  });

  const generateAIResponse = async (review: any) => {
    const rating = review.rating || 0;
    const reviewText = review.review_text || '';
    
    // Simple AI-suggested responses based on rating
    let suggestion = '';
    if (rating >= 4) {
      suggestion = `Thank you so much for your wonderful ${rating}-star review, ${review.contacts?.first_name}! We're thrilled that you had a great experience with our team. Your feedback means the world to us and motivates us to continue delivering excellent service. We hope to work with you again in the future!`;
    } else if (rating === 3) {
      suggestion = `Hi ${review.contacts?.first_name}, thank you for taking the time to share your feedback. We appreciate your 3-star review and would love to learn more about how we can improve. Please feel free to reach out to us directly so we can address any concerns. We're committed to your satisfaction!`;
    } else {
      suggestion = `Dear ${review.contacts?.first_name}, we sincerely apologize that we didn't meet your expectations. Your feedback is incredibly important to us. We'd like to make this right - please contact us at your earliest convenience so we can discuss how to resolve this issue. Thank you for giving us the opportunity to improve.`;
    }
    
    setReplyText({ ...replyText, [review.id]: suggestion });
    toast({ title: "AI Response Generated", description: "Review and edit the suggested response." });
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading reviews...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold">Customer Reviews</h2>
        <p className="text-muted-foreground">Manage and respond to customer feedback</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold">
                {stats?.avgRating.toFixed(1) || '0.0'}
              </span>
              {renderStars(Math.round(stats?.avgRating || 0))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Response Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {reviews.length > 0
                ? Math.round((reviews.filter(r => r.response_text).length / reviews.length) * 100)
                : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rating Distribution */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.distribution.map(({ rating, count, percentage }) => (
                <div key={rating} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 w-20">
                    <span className="text-sm font-medium">{rating}</span>
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-400"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground w-16 text-right">
                    {count} ({percentage.toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reviews List */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Recent Reviews</h3>
        {reviews.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No reviews yet. Send review requests to your customers to get started.</p>
          </Card>
        ) : (
          reviews.map((review) => (
            <Card key={review.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {review.contacts?.first_name} {review.contacts?.last_name}
                    </CardTitle>
                    <CardDescription>
                      {review.projects?.title && `Project: ${review.projects.title}`}
                      {review.clj_number && ` • ${review.clj_number}`}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    {renderStars(review.rating || 0)}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(review.reviewed_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {review.review_text && (
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-sm">{review.review_text}</p>
                  </div>
                )}

                {review.response_text ? (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-semibold">Your Response</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(review.responded_at), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm">{review.response_text}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Post a response</label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => generateAIResponse(review)}
                      >
                        <TrendingUp className="h-3 w-3 mr-1" />
                        AI Suggest
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Write a response to this review..."
                      value={replyText[review.id] || ''}
                      onChange={(e) => setReplyText({ ...replyText, [review.id]: e.target.value })}
                      rows={3}
                    />
                    <Button
                      size="sm"
                      onClick={() => replyMutation.mutate({
                        reviewId: review.id,
                        responseText: replyText[review.id] || '',
                      })}
                      disabled={!replyText[review.id] || replyMutation.isPending}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      {replyMutation.isPending ? 'Posting...' : 'Post Response'}
                    </Button>
                  </div>
                )}

                <Badge variant={review.is_public ? 'default' : 'secondary'}>
                  {review.is_public ? 'Public' : 'Private'}
                </Badge>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
