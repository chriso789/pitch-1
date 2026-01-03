import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  FileText, 
  Shield, 
  DollarSign, 
  Plus, 
  Calendar,
  User,
  Phone,
  Mail,
  Building,
  AlertCircle,
  CheckCircle,
  Clock,
  FileCheck,
  Upload
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface InsuranceClaim {
  id: string;
  claim_number: string;
  insurance_company: string;
  adjuster_name: string;
  adjuster_phone: string;
  adjuster_email: string;
  policy_number: string;
  date_of_loss: string;
  claim_status: string;
  deductible_amount: number;
  approved_amount: number;
  acv_amount: number;
  rcv_amount: number;
  depreciation_amount: number;
  recoverable_depreciation: number;
  notes: string;
  created_at: string;
  job?: {
    job_number: string;
    projects?: {
      project_name: string;
      contacts?: {
        first_name: string;
        last_name: string;
      };
    };
  };
}

interface InsuranceClaimManagerProps {
  jobId?: string;
  tenantId?: string;
  onClaimCreated?: (claim: InsuranceClaim) => void;
}

export const InsuranceClaimManager: React.FC<InsuranceClaimManagerProps> = ({
  jobId,
  tenantId,
  onClaimCreated,
}) => {
  const { profile } = useUserProfile();
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<InsuranceClaim | null>(null);
  const [showNewClaimDialog, setShowNewClaimDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [creating, setCreating] = useState(false);

  const effectiveTenantId = tenantId || profile?.tenant_id;

  const [newClaim, setNewClaim] = useState({
    claim_number: '',
    insurance_company: '',
    adjuster_name: '',
    adjuster_phone: '',
    adjuster_email: '',
    policy_number: '',
    date_of_loss: '',
    deductible_amount: 0,
    notes: '',
  });

  useEffect(() => {
    fetchClaims();
  }, [effectiveTenantId, jobId]);

  const fetchClaims = async () => {
    if (!effectiveTenantId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('insurance_claims')
        .select(`
          *,
          job:jobs(job_number)
        `)
        .eq('tenant_id', effectiveTenantId)
        .order('created_at', { ascending: false });

      if (jobId) {
        const filtered = (data || []).filter((c: any) => c.job_id === jobId);
        setClaims(filtered as any);
      } else {
        setClaims((data || []) as any);
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const createClaim = async () => {
    if (!effectiveTenantId) return;

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('insurance_claims')
        .insert({
          tenant_id: effectiveTenantId,
          job_id: jobId,
          ...newClaim,
          claim_status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Insurance claim created successfully');
      setShowNewClaimDialog(false);
      setNewClaim({
        claim_number: '',
        insurance_company: '',
        adjuster_name: '',
        adjuster_phone: '',
        adjuster_email: '',
        policy_number: '',
        date_of_loss: '',
        deductible_amount: 0,
        notes: '',
      });
      fetchClaims();
      onClaimCreated?.(data);
    } catch (error: any) {
      console.error('Error creating claim:', error);
      toast.error(error.message || 'Failed to create claim');
    } finally {
      setCreating(false);
    }
  };

  const updateClaimStatus = async (claimId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('insurance_claims')
        .update({ claim_status: newStatus })
        .eq('id', claimId);

      if (error) throw error;
      toast.success('Claim status updated');
      fetchClaims();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-500';
      case 'denied': return 'bg-red-500';
      case 'pending': return 'bg-yellow-500';
      case 'filed': return 'bg-blue-500';
      case 'supplemented': return 'bg-purple-500';
      case 'closed': return 'bg-muted-foreground';
      default: return 'bg-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="h-4 w-4" />;
      case 'denied': return <AlertCircle className="h-4 w-4" />;
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'filed': return <FileCheck className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const filteredClaims = claims.filter(claim => {
    if (activeTab === 'all') return true;
    return claim.claim_status === activeTab;
  });

  const formatCurrency = (amount: number | null) => {
    if (amount == null) return '--';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Insurance Claims
          </h2>
          <p className="text-muted-foreground">Manage insurance claims and generate scope documents</p>
        </div>
        <Dialog open={showNewClaimDialog} onOpenChange={setShowNewClaimDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Claim
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Insurance Claim</DialogTitle>
              <DialogDescription>
                Enter the insurance claim details for this job
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="claim_number">Claim Number</Label>
                  <Input
                    id="claim_number"
                    value={newClaim.claim_number}
                    onChange={(e) => setNewClaim({ ...newClaim, claim_number: e.target.value })}
                    placeholder="e.g., CLM-2025-001234"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="policy_number">Policy Number</Label>
                  <Input
                    id="policy_number"
                    value={newClaim.policy_number}
                    onChange={(e) => setNewClaim({ ...newClaim, policy_number: e.target.value })}
                    placeholder="e.g., HO-123456789"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="insurance_company">Insurance Company</Label>
                  <Input
                    id="insurance_company"
                    value={newClaim.insurance_company}
                    onChange={(e) => setNewClaim({ ...newClaim, insurance_company: e.target.value })}
                    placeholder="e.g., State Farm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date_of_loss">Date of Loss</Label>
                  <Input
                    id="date_of_loss"
                    type="date"
                    value={newClaim.date_of_loss}
                    onChange={(e) => setNewClaim({ ...newClaim, date_of_loss: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adjuster_name">Adjuster Name</Label>
                  <Input
                    id="adjuster_name"
                    value={newClaim.adjuster_name}
                    onChange={(e) => setNewClaim({ ...newClaim, adjuster_name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adjuster_phone">Adjuster Phone</Label>
                  <Input
                    id="adjuster_phone"
                    value={newClaim.adjuster_phone}
                    onChange={(e) => setNewClaim({ ...newClaim, adjuster_phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adjuster_email">Adjuster Email</Label>
                  <Input
                    id="adjuster_email"
                    type="email"
                    value={newClaim.adjuster_email}
                    onChange={(e) => setNewClaim({ ...newClaim, adjuster_email: e.target.value })}
                    placeholder="adjuster@insurance.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deductible">Deductible Amount</Label>
                <Input
                  id="deductible"
                  type="number"
                  value={newClaim.deductible_amount || ''}
                  onChange={(e) => setNewClaim({ ...newClaim, deductible_amount: parseFloat(e.target.value) || 0 })}
                  placeholder="1000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={newClaim.notes}
                  onChange={(e) => setNewClaim({ ...newClaim, notes: e.target.value })}
                  placeholder="Additional notes about the claim..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNewClaimDialog(false)}>
                Cancel
              </Button>
              <Button onClick={createClaim} disabled={creating}>
                {creating ? 'Creating...' : 'Create Claim'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All Claims</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="filed">Filed</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="supplemented">Supplemented</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredClaims.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No insurance claims found</p>
                <Button variant="outline" className="mt-4" onClick={() => setShowNewClaimDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Claim
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredClaims.map((claim) => (
                <Card key={claim.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <Badge className={cn('gap-1', getStatusColor(claim.claim_status))}>
                            {getStatusIcon(claim.claim_status)}
                            {claim.claim_status}
                          </Badge>
                          <span className="font-semibold">{claim.claim_number || 'No Claim #'}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">{claim.insurance_company}</span>
                        </div>
                        
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          {claim.adjuster_name && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {claim.adjuster_name}
                            </span>
                          )}
                          {claim.adjuster_phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {claim.adjuster_phone}
                            </span>
                          )}
                          {claim.date_of_loss && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Loss: {format(new Date(claim.date_of_loss), 'MMM d, yyyy')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-6 pt-2">
                          <div>
                            <div className="text-xs text-muted-foreground">Deductible</div>
                            <div className="font-medium">{formatCurrency(claim.deductible_amount)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">ACV</div>
                            <div className="font-medium">{formatCurrency(claim.acv_amount)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">RCV</div>
                            <div className="font-medium">{formatCurrency(claim.rcv_amount)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Approved</div>
                            <div className="font-medium text-green-600">{formatCurrency(claim.approved_amount)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Select
                          value={claim.claim_status}
                          onValueChange={(value) => updateClaimStatus(claim.id, value)}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="filed">Filed</SelectItem>
                            <SelectItem value="in_review">In Review</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="denied">Denied</SelectItem>
                            <SelectItem value="supplemented">Supplemented</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={() => setSelectedClaim(claim)}>
                          View Details
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InsuranceClaimManager;
