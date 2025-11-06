import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CLJBadge } from '@/components/CLJBadge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle, XCircle, Clock, DollarSign, User, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ApprovalRequest {
  id: string;
  lead_id: string;
  clj_number: string;
  requested_by: string;
  requested_at: string;
  estimated_value: number;
  business_justification: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  manager_notes?: string;
  pipeline_entries?: {
    contacts?: {
      first_name: string;
      last_name: string;
      email: string;
    };
  };
  requester?: {
    first_name: string;
    last_name: string;
  };
  reviewer?: {
    first_name: string;
    last_name: string;
  };
}

export default function ManagerApprovalQueue() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [managerNotes, setManagerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');

  useEffect(() => {
    fetchRequests();

    // Set up real-time subscription
    const channel = supabase
      .channel('manager-approval-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'manager_approval_queue'
        },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('manager_approval_queue')
        .select(`
          *,
          pipeline_entries (
            contacts (
              first_name,
              last_name,
              email
            )
          ),
          requester:profiles!requested_by (
            first_name,
            last_name
          ),
          reviewer:profiles!reviewed_by (
            first_name,
            last_name
          )
        `)
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setRequests((data as any) || []);
    } catch (error: any) {
      console.error('Error fetching approval requests:', error);
      toast.error('Failed to load approval requests');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewClick = (request: ApprovalRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setReviewAction(action);
    setManagerNotes('');
    setReviewDialogOpen(true);
  };

  const handleSubmitReview = async () => {
    if (!selectedRequest) return;

    setSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('api_respond_to_approval_request' as any, {
        p_approval_id: selectedRequest.id,
        p_action: reviewAction,
        p_manager_notes: managerNotes || null
      });

      if (error) throw error;

      if ((data as any)?.success) {
        toast.success(`Request ${reviewAction}d successfully`);
        setReviewDialogOpen(false);
        fetchRequests();
      } else {
        toast.error((data as any)?.error || 'Failed to process approval');
      }
    } catch (error: any) {
      console.error('Error processing approval:', error);
      toast.error(error.message || 'Failed to process approval');
    } finally {
      setSubmitting(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const config = {
      urgent: { color: 'bg-destructive text-destructive-foreground', icon: AlertCircle },
      high: { color: 'bg-orange-500 text-white', icon: AlertCircle },
      medium: { color: 'bg-yellow-500 text-white', icon: Clock },
      low: { color: 'bg-green-500 text-white', icon: CheckCircle }
    };

    const { color, icon: Icon } = config[priority as keyof typeof config] || config.low;

    return (
      <Badge className={color}>
        <Icon className="h-3 w-3 mr-1" />
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const config = {
      pending: { color: 'bg-yellow-500 text-white', icon: Clock },
      approved: { color: 'bg-green-500 text-white', icon: CheckCircle },
      rejected: { color: 'bg-destructive text-destructive-foreground', icon: XCircle }
    };

    const { color, icon: Icon } = config[status as keyof typeof config];

    return (
      <Badge className={color}>
        <Icon className="h-3 w-3 mr-1" />
        {status.toUpperCase()}
      </Badge>
    );
  };

  const filteredRequests = requests.filter(r => r.status === activeTab);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Manager Approval Queue</h1>
          <p className="text-muted-foreground">Review and approve high-value project conversions</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="pending">
            Pending ({requests.filter(r => r.status === 'pending').length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({requests.filter(r => r.status === 'approved').length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({requests.filter(r => r.status === 'rejected').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {filteredRequests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No {activeTab} requests</h3>
                <p className="text-muted-foreground">
                  {activeTab === 'pending' 
                    ? 'All approval requests have been processed'
                    : `No requests have been ${activeTab}`
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Approval Requests</CardTitle>
                <CardDescription>
                  {activeTab === 'pending' && 'Review and respond to pending approval requests'}
                  {activeTab === 'approved' && 'Previously approved requests'}
                  {activeTab === 'rejected' && 'Previously rejected requests'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>C-L-J</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Requested</TableHead>
                      {activeTab !== 'pending' && <TableHead>Reviewed By</TableHead>}
                      {activeTab !== 'pending' && <TableHead>Reviewed</TableHead>}
                      <TableHead>Status</TableHead>
                      {activeTab === 'pending' && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <CLJBadge cljNumber={request.clj_number} size="sm" />
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {request.pipeline_entries?.contacts?.first_name}{' '}
                              {request.pipeline_entries?.contacts?.last_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {request.pipeline_entries?.contacts?.email}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono">
                              {request.estimated_value.toLocaleString('en-US', { 
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0
                              })}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{getPriorityBadge(request.priority)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {request.requester?.first_name} {request.requester?.last_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {formatDistanceToNow(new Date(request.requested_at), { addSuffix: true })}
                          </div>
                        </TableCell>
                        {activeTab !== 'pending' && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">
                                {request.reviewer?.first_name} {request.reviewer?.last_name}
                              </span>
                            </div>
                          </TableCell>
                        )}
                        {activeTab !== 'pending' && (
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              {request.reviewed_at && formatDistanceToNow(new Date(request.reviewed_at), { addSuffix: true })}
                            </div>
                          </TableCell>
                        )}
                        <TableCell>{getStatusBadge(request.status)}</TableCell>
                        {activeTab === 'pending' && (
                          <TableCell className="text-right space-x-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleReviewClick(request, 'approve')}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReviewClick(request, 'reject')}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'Approve' : 'Reject'} Approval Request
            </DialogTitle>
            <DialogDescription>
              {selectedRequest && (
                <>
                  {reviewAction === 'approve' 
                    ? 'This will allow the lead to be converted to an active project.'
                    : 'This will prevent the lead from being converted at this time.'
                  }
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted/50 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">C-L-J Number:</span>
                  <CLJBadge cljNumber={selectedRequest.clj_number} size="sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Estimated Value:</span>
                  <span className="font-mono">${selectedRequest.estimated_value.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Priority:</span>
                  {getPriorityBadge(selectedRequest.priority)}
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Business Justification:</Label>
                <p className="text-sm text-muted-foreground mt-1 p-3 bg-muted/30 rounded-md">
                  {selectedRequest.business_justification}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="manager-notes">Manager Notes</Label>
                <Textarea
                  id="manager-notes"
                  placeholder="Add any notes or feedback about this decision..."
                  value={managerNotes}
                  onChange={(e) => setManagerNotes(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={reviewAction === 'approve' ? 'default' : 'destructive'}
              onClick={handleSubmitReview}
              disabled={submitting}
            >
              {submitting ? 'Processing...' : reviewAction === 'approve' ? 'Approve Request' : 'Reject Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
