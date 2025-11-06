import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Plus, Shield, DollarSign, Users, Edit, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ApprovalRule {
  id: string;
  rule_name: string;
  min_amount: number;
  max_amount: number | null;
  required_approvers: string[];
  approval_type: string;
  is_active: boolean;
  created_at: string;
}

export default function ApprovalRules() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const { data, error } = await supabase
        .from('purchase_order_approval_rules')
        .select('*')
        .order('min_amount');

      if (error) throw error;
      setRules((data || []).map(rule => ({
        ...rule,
        required_approvers: rule.required_approvers as string[]
      })));
    } catch (error: any) {
      console.error('Error fetching approval rules:', error);
      toast.error('Failed to load approval rules');
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

  const formatApprovers = (approvers: string[]) => {
    return approvers.map((approver) => {
      // Check if it's a role name (not a UUID)
      if (!approver.includes('-')) {
        return approver.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      }
      return approver;
    }).join(', ');
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
              <Shield className="h-8 w-8" />
              Approval Rules
            </h1>
            <p className="text-muted-foreground">
              Configure multi-level approval workflows for purchase orders
            </p>
          </div>
        </div>
        <Button onClick={() => toast.info('Add rule dialog coming soon')}>
          <Plus className="h-4 w-4 mr-2" />
          Add Rule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approval Thresholds</CardTitle>
          <CardDescription>
            Define approval requirements based on order amounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No approval rules configured</h3>
              <p className="text-muted-foreground mb-4">
                Add your first approval rule to enable workflow management
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create First Rule
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule Name</TableHead>
                  <TableHead>Amount Range</TableHead>
                  <TableHead>Required Approvers</TableHead>
                  <TableHead>Approval Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-semibold">
                      {rule.rule_name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {formatCurrency(rule.min_amount)}
                          {rule.max_amount ? ` - ${formatCurrency(rule.max_amount)}` : '+'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {formatApprovers(rule.required_approvers)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {rule.approval_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={rule.is_active ? 'bg-green-500' : 'bg-gray-500'}>
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toast.info('Edit coming soon')}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toast.info('Delete coming soon')}
                        >
                          <Trash2 className="h-4 w-4" />
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

      <Card>
        <CardHeader>
          <CardTitle>How Approval Rules Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Approval Types</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li><strong>Any:</strong> Only one approver from the list needs to approve</li>
              <li><strong>Sequential:</strong> Approvers must approve in order</li>
              <li><strong>Parallel:</strong> All approvers must approve (any order)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Role-Based Approvers</h4>
            <p className="text-sm text-muted-foreground">
              When a role is specified (e.g., "regional_manager"), any user with that role in your
              organization can approve the order. For "any" approval type, only one needs to approve.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Threshold Matching</h4>
            <p className="text-sm text-muted-foreground">
              The system automatically selects the appropriate approval rule based on the order's total
              amount. If no rule matches, the order is auto-approved.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
