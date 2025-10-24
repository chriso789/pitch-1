import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CLJBadge } from '@/components/CLJBadge';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  DollarSign, 
  User,
  AlertCircle,
  TrendingUp
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';

interface ApprovalRequest {
  id: string;
  pipeline_id: string;
  contact_id: string;
  estimated_value: number;
  business_justification: string;
  priority: 'standard' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  requested_by: string;
  reviewed_by?: string;
  reviewed_at?: string;
  manager_notes?: string;
  clj_number?: string;
  requester_name?: string;
  contact_name?: string;
  reviewer_name?: string;
}

export const ManagerApprovalQueue: React.FC = () => {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [managerNotes, setManagerNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('manager_approval_queue')
        .select(`
          *,
          requester:profiles!requested_by(full_name),
          reviewer:profiles!reviewed_by(full_name),
          contact:contacts(first_name, last_name, company_name)
        `)
        .order('priority', { ascending: false })
        .order('requested_at', { ascending: true });

      if (error) throw error;

      const formatted = data?.map((req: any) => ({
        ...req,
        requester_name: req.requester?.full_name || 'Unknown',
        reviewer_name: req.reviewer?.full_name,
        contact_name: req.contact 
          ? `${req.contact.first_name || ''} ${req.contact.last_name || ''}`.trim() || req.contact.company_name || 'Unknown'
          : 'Unknown'
      })) || [];

      setRequests(formatted);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('manager_approval_changes')
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

  const handleRespond = async (approved: boolean) => {
    if (!selectedRequest) return;

    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('api_respond_to_approval_request' as any, {
        p_approval_id: selectedRequest.id,
        p_approved: approved,
        p_manager_notes: managerNotes || null
      });

      if (error) throw error;

      toast({
        title: approved ? 'Approved' : 'Rejected',
        description: `Request ${approved ? 'approved' : 'rejected'} successfully`
      });

      setSelectedRequest(null);
      setManagerNotes('');
      fetchRequests();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const variants = {
      standard: { icon: Clock, color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
      high: { icon: TrendingUp, color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
      critical: { icon: AlertCircle, color: 'bg-red-500/10 text-red-500 border-red-500/20' }
    };
    
    const config = variants[priority as keyof typeof variants] || variants.standard;
    const Icon = config.icon;
    
    return (
      <Badge variant="outline" className={config.color}>
        <Icon className="h-3 w-3 mr-1" />
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const config = {
      pending: { icon: Clock, variant: 'outline' as const },
      approved: { icon: CheckCircle2, variant: 'default' as const },
      rejected: { icon: XCircle, variant: 'destructive' as const }
    };
    
    const { icon: Icon, variant } = config[status as keyof typeof config];
    
    return (
      <Badge variant={variant}>
        <Icon className="h-3 w-3 mr-1" />
        {status.toUpperCase()}
      </Badge>
    );
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  if (loading) {
    return <div className="p-6">Loading approval queue...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Pending Requests */}
      <div>
        <h2 className="text-2xl font-bold mb-4">
          Pending Approvals ({pendingRequests.length})
        </h2>
        
        {pendingRequests.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No pending approval requests
          </Card>
        ) : (
          <div className="grid gap-4">
            {pendingRequests.map((request) => (
              <Card key={request.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {request.clj_number && (
                        <CLJBadge cljNumber={request.clj_number} />
                      )}
                      {getPriorityBadge(request.priority)}
                      {getStatusBadge(request.status)}
                    </div>
                    <h3 className="text-lg font-semibold">{request.contact_name}</h3>
                  </div>
                  
                  <div className="text-right">
                    <div className="flex items-center gap-2 text-2xl font-bold text-primary">
                      <DollarSign className="h-6 w-6" />
                      {request.estimated_value.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Estimated Value
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  <div>
                    <p className="text-sm font-semibold mb-1">Business Justification:</p>
                    <p className="text-sm text-muted-foreground">
                      {request.business_justification}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    <span>Requested by {request.requester_name}</span>
                    <span>•</span>
                    <span>{formatDistanceToNow(new Date(request.requested_at), { addSuffix: true })}</span>
                  </div>
                </div>

                <Button 
                  onClick={() => setSelectedRequest(request)}
                  className="w-full"
                >
                  Review Request
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Processed Requests */}
      {processedRequests.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">
            Recent Decisions ({processedRequests.length})
          </h2>
          
          <div className="grid gap-4">
            {processedRequests.map((request) => (
              <Card key={request.id} className="p-4 opacity-75">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {request.clj_number && (
                        <CLJBadge cljNumber={request.clj_number} size="sm" />
                      )}
                      {getStatusBadge(request.status)}
                    </div>
                    <p className="font-semibold">{request.contact_name}</p>
                    <p className="text-sm text-muted-foreground">
                      ${request.estimated_value.toLocaleString()} • 
                      {request.reviewer_name && ` Reviewed by ${request.reviewer_name}`}
                    </p>
                  </div>
                  
                  <div className="text-right text-sm text-muted-foreground">
                    {request.reviewed_at && formatDistanceToNow(new Date(request.reviewed_at), { addSuffix: true })}
                  </div>
                </div>
                
                {request.manager_notes && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm">
                      <span className="font-semibold">Manager Notes:</span> {request.manager_notes}
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && setSelectedRequest(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Approval Request</DialogTitle>
            <DialogDescription>
              Approve or reject this lead-to-project conversion request
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {selectedRequest.clj_number && (
                  <CLJBadge cljNumber={selectedRequest.clj_number} />
                )}
                {getPriorityBadge(selectedRequest.priority)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-semibold">Contact</p>
                  <p className="text-sm text-muted-foreground">{selectedRequest.contact_name}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold">Estimated Value</p>
                  <p className="text-2xl font-bold text-primary">
                    ${selectedRequest.estimated_value.toLocaleString()}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Business Justification</p>
                <p className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  {selectedRequest.business_justification}
                </p>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Manager Notes (Optional)</p>
                <Textarea
                  value={managerNotes}
                  onChange={(e) => setManagerNotes(e.target.value)}
                  placeholder="Add notes about your decision..."
                  rows={3}
                />
              </div>

              <div className="text-sm text-muted-foreground">
                Requested by {selectedRequest.requester_name} • 
                {formatDistanceToNow(new Date(selectedRequest.requested_at), { addSuffix: true })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedRequest(null)}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleRespond(false)}
              disabled={processing}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Reject
            </Button>
            <Button
              onClick={() => handleRespond(true)}
              disabled={processing}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
