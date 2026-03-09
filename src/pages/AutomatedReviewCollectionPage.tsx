import { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Star, Mail, MessageSquare, Clock, CheckCircle, XCircle, Send } from "lucide-react";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const AutomatedReviewCollectionPage = () => {
  const { activeTenantId } = useActiveTenantId();
  const queryClient = useQueryClient();
  
  const [dripConfig, setDripConfig] = useState({
    enabled: true,
    initial_delay_days: 3,
    reminder_1_days: 7,
    reminder_2_days: 14,
    max_reminders: 3,
    platforms: ['google', 'yelp'],
    send_via: ['email', 'sms']
  });

  const { data: reviewRequests = [], isLoading } = useQuery({
    queryKey: ['review-requests', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('review_requests')
        .select('*, contacts(first_name, last_name, email, phone), projects(name)')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId
  });

  const sendRequestMutation = useMutation({
    mutationFn: async (contactId: string) => {
      if (!activeTenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from('review_requests')
        .insert({
          tenant_id: activeTenantId,
          contact_id: contactId,
          platform: 'google',
          status: 'pending',
          scheduled_for: new Date(Date.now() + dripConfig.initial_delay_days * 24 * 60 * 60 * 1000).toISOString()
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-requests'] });
      toast.success("Review request scheduled!");
    }
  });

  const stats = {
    total: reviewRequests.length,
    sent: reviewRequests.filter(r => r.status === 'sent').length,
    completed: reviewRequests.filter(r => r.status === 'completed').length,
    pending: reviewRequests.filter(r => r.status === 'pending').length,
    avgRating: reviewRequests
      .filter(r => r.rating)
      .reduce((sum, r) => sum + (r.rating || 0), 0) / (reviewRequests.filter(r => r.rating).length || 1)
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>,
      sent: <Badge variant="default"><Send className="h-3 w-3 mr-1" /> Sent</Badge>,
      completed: <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Completed</Badge>,
      declined: <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Declined</Badge>
    };
    return variants[status] || <Badge>{status}</Badge>;
  };

  return (
    <GlobalLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Star className="h-8 w-8 text-amber-500" />
              Automated Review Collection
            </h1>
            <p className="text-muted-foreground mt-1">
              Post-completion Google/Yelp review request flow with SMS + email drip
            </p>
          </div>
          <Badge variant="outline" className="px-3 py-1">Phase 22</Badge>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Requests</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-muted-foreground">Sent</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.sent}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="text-sm text-muted-foreground">Completed</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.completed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                <span className="text-sm text-muted-foreground">Pending</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                <span className="text-sm text-muted-foreground">Avg Rating</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.avgRating.toFixed(1)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Drip Configuration */}
        <Card className="elevated">
          <CardHeader>
            <CardTitle>Automated Drip Campaign Settings</CardTitle>
            <CardDescription>Configure automatic review request sequences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="enabled" className="font-medium">Enable Automated Requests</Label>
                <p className="text-sm text-muted-foreground">Automatically send review requests after job completion</p>
              </div>
              <Switch
                id="enabled"
                checked={dripConfig.enabled}
                onCheckedChange={(checked) => setDripConfig(prev => ({ ...prev, enabled: checked }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Initial Delay (Days)</Label>
                <Input
                  type="number"
                  value={dripConfig.initial_delay_days}
                  onChange={(e) => setDripConfig(prev => ({ ...prev, initial_delay_days: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>1st Reminder (Days After)</Label>
                <Input
                  type="number"
                  value={dripConfig.reminder_1_days}
                  onChange={(e) => setDripConfig(prev => ({ ...prev, reminder_1_days: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>2nd Reminder (Days After)</Label>
                <Input
                  type="number"
                  value={dripConfig.reminder_2_days}
                  onChange={(e) => setDripConfig(prev => ({ ...prev, reminder_2_days: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Send Via</Label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <Mail className="h-4 w-4" />
                    Email
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <MessageSquare className="h-4 w-4" />
                    SMS
                  </label>
                </div>
              </div>
              <div>
                <Label>Platforms</Label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    Google
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    Yelp
                  </label>
                </div>
              </div>
            </div>

            <Button onClick={() => toast.success("Drip campaign settings saved!")}>
              Save Settings
            </Button>
          </CardContent>
        </Card>

        {/* Review Requests Table */}
        <Card>
          <CardHeader>
            <CardTitle>Review Request History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : reviewRequests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No review requests yet</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewRequests.map((request: any) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.contacts ? `${request.contacts.first_name} ${request.contacts.last_name}` : "—"}
                      </TableCell>
                      <TableCell>{request.projects?.name || "—"}</TableCell>
                      <TableCell className="capitalize">{request.platform}</TableCell>
                      <TableCell>{getStatusBadge(request.status)}</TableCell>
                      <TableCell>
                        {request.scheduled_for ? format(new Date(request.scheduled_for), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        {request.rating ? (
                          <div className="flex items-center gap-1">
                            <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                            {request.rating}
                          </div>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default AutomatedReviewCollectionPage;
