import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, CheckCircle, XCircle, Clock, DollarSign, FileText, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PendingApproval {
  id: string;
  po_id: string;
  status: string;
  approval_level: number;
  requested_at: string;
  purchase_orders: {
    po_number: string;
    total_amount: number;
    order_date: string;
    vendors: {
      name: string;
    };
  };
  purchase_order_approval_rules: {
    rule_name: string;
  } | null;
}

export default function PendingApprovals() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [comments, setComments] = useState('');

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const fetchPendingApprovals = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('purchase_order_approvals')
        .select(`
          *,
          purchase_orders (
            po_number,
            total_amount,
            order_date,
            vendors (name)
          ),
          purchase_order_approval_rules (
            rule_name
          )
        `)
        .eq('required_approver_id', user.id)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setApprovals(data || []);
    } catch (error: any) {
      console.error('Error fetching pending approvals:', error);
      toast.error('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApprovalAction = async () => {
    if (!selectedApproval || !actionType) return;

    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('approve-order', {
        body: {
          approval_id: selectedApproval.id,
          action: actionType,
          comments,
          approver_id: user.id,
        },
      });

      if (error) throw error;

      toast.success(
        actionType === 'approve' 
          ? `Order approved successfully` 
          : `Order rejected`
      );

      setSelectedApproval(null);
      setActionType(null);
      setComments('');
      await fetchPendingApprovals();
    } catch (error: any) {
      console.error('Error processing approval:', error);
      toast.error(error.message || 'Failed to process approval');
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Clock className="h-8 w-8" />
              Pending Approvals
            </h1>
            <p className="text-muted-foreground">
              Review and approve purchase orders awaiting your authorization
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-2">
          {approvals.length} pending
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders Awaiting Approval</CardTitle>
          <CardDescription>
            These purchase orders require your approval before they can proceed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
              <p className="text-muted-foreground">
                You have no pending approvals at this time
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((approval) => (
                  <TableRow key={approval.id}>
                    <TableCell className="font-mono font-semibold">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {approval.purchase_orders.po_number}
                      </div>
                    </TableCell>
                    <TableCell>
                      {approval.purchase_orders.vendors?.name || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {format(new Date(approval.purchase_orders.order_date), 'MMM dd, yyyy')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-semibold">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        {formatCurrency(approval.purchase_orders.total_amount)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {approval.purchase_order_approval_rules?.rule_name || 'N/A'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(approval.requested_at), 'MMM dd, h:mm a')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/material-orders/${approval.po_id}`)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => {
                            setSelectedApproval(approval);
                            setActionType('approve');
                          }}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedApproval(approval);
                            setActionType('reject');
                          }}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!selectedApproval} onOpenChange={() => {
        setSelectedApproval(null);
        setActionType(null);
        setComments('');
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === 'approve' ? 'Approve Order?' : 'Reject Order?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === 'approve' 
                ? 'This will approve the purchase order. You can add optional comments below.'
                : 'This will reject the purchase order. Please provide a reason for rejection.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={actionType === 'approve' ? 'Comments (optional)' : 'Reason for rejection (required)'}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={4}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprovalAction}
              disabled={actionLoading || (actionType === 'reject' && !comments.trim())}
              className={actionType === 'reject' ? 'bg-destructive text-destructive-foreground' : ''}
            >
              {actionLoading ? 'Processing...' : actionType === 'approve' ? 'Approve Order' : 'Reject Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
