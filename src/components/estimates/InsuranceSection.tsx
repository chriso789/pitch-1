import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Shield, FileText, ClipboardList, AlertTriangle, Plus,
  Search, Upload, CheckCircle, Clock, XCircle, Loader2,
  ArrowRight, FileSpreadsheet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { XactScopeBuilder } from '@/components/xact-scope/XactScopeBuilder';
import { InsuranceClaimManager } from '@/components/insurance/InsuranceClaimManager';

interface InsuranceSectionProps {
  pipelineEntryId: string;
  jobId?: string;
}

type ClaimStatus = 'open' | 'submitted' | 'approved' | 'denied' | 'supplementing' | 'closed';

interface ClaimInfo {
  claim_number: string;
  carrier_name: string;
  adjuster_name: string;
  adjuster_phone: string;
  adjuster_email: string;
  date_of_loss: string;
  status: ClaimStatus;
  policy_number: string;
  deductible: string;
  notes: string;
}

const statusConfig: Record<ClaimStatus, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Open', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30', icon: Upload },
  approved: { label: 'Approved', color: 'bg-green-500/10 text-green-600 border-green-500/30', icon: CheckCircle },
  denied: { label: 'Denied', color: 'bg-red-500/10 text-red-600 border-red-500/30', icon: XCircle },
  supplementing: { label: 'Supplementing', color: 'bg-purple-500/10 text-purple-600 border-purple-500/30', icon: AlertTriangle },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground border-border', icon: CheckCircle },
};

export const InsuranceSection: React.FC<InsuranceSectionProps> = ({
  pipelineEntryId,
  jobId,
}) => {
  const effectiveTenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('claim');
  const [isEditing, setIsEditing] = useState(false);

  // Fetch claim info from pipeline entry metadata
  const { data: claimData, isLoading } = useQuery({
    queryKey: ['insurance-claim', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      return (data?.metadata as any)?.insurance_claim as ClaimInfo | undefined;
    },
    enabled: !!pipelineEntryId,
  });

  const [claimForm, setClaimForm] = useState<ClaimInfo>({
    claim_number: '',
    carrier_name: '',
    adjuster_name: '',
    adjuster_phone: '',
    adjuster_email: '',
    date_of_loss: '',
    status: 'open',
    policy_number: '',
    deductible: '',
    notes: '',
  });

  React.useEffect(() => {
    if (claimData) {
      setClaimForm(claimData);
    }
  }, [claimData]);

  const saveClaimMutation = useMutation({
    mutationFn: async (claim: ClaimInfo) => {
      // Get current metadata
      const { data: entry, error: fetchErr } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (fetchErr) throw fetchErr;

      const currentMetadata = (entry?.metadata as Record<string, unknown>) || {};
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: { ...currentMetadata, insurance_claim: claim } as any
        })
        .eq('id', pipelineEntryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claim', pipelineEntryId] });
      toast.success('Claim information saved');
      setIsEditing(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const handleSave = () => {
    saveClaimMutation.mutate(claimForm);
  };

  const currentStatus = claimData?.status || 'open';
  const StatusIcon = statusConfig[currentStatus]?.icon || Clock;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Insurance & Xactimate
          </CardTitle>
          {claimData && (
            <Badge variant="outline" className={cn("font-mono", statusConfig[currentStatus]?.color)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig[currentStatus]?.label}
            </Badge>
          )}
        </div>
        {claimData?.claim_number && (
          <p className="text-sm text-muted-foreground">
            Claim #{claimData.claim_number} · {claimData.carrier_name}
          </p>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start mb-4 overflow-x-auto">
            <TabsTrigger value="claim" className="text-xs">
              <FileText className="h-3 w-3 mr-1" />
              Claim Info
            </TabsTrigger>
            <TabsTrigger value="xactimate" className="text-xs">
              <FileSpreadsheet className="h-3 w-3 mr-1" />
              Xactimate Builder
            </TabsTrigger>
            <TabsTrigger value="supplements" className="text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Supplements
            </TabsTrigger>
            <TabsTrigger value="scope" className="text-xs">
              <Search className="h-3 w-3 mr-1" />
              Scope Tracking
            </TabsTrigger>
          </TabsList>

          {/* Claim Info Tab */}
          <TabsContent value="claim" className="space-y-4 mt-0">
            {!claimData && !isEditing ? (
              <div className="text-center py-8">
                <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  No insurance claim linked to this project yet
                </p>
                <Button onClick={() => setIsEditing(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Claim Information
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status Pipeline */}
                <div className="flex items-center gap-1 overflow-x-auto pb-2">
                  {(['open', 'submitted', 'approved', 'supplementing', 'closed'] as ClaimStatus[]).map((status, i) => {
                    const config = statusConfig[status];
                    const isActive = status === (isEditing ? claimForm.status : currentStatus);
                    const StatusIcon = config.icon;
                    return (
                      <React.Fragment key={status}>
                        {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                        <button
                          onClick={() => {
                            if (isEditing) {
                              setClaimForm(prev => ({ ...prev, status }));
                            }
                          }}
                          disabled={!isEditing}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0 transition-colors",
                            isActive
                              ? config.color + " font-semibold border"
                              : "text-muted-foreground hover:bg-accent",
                            isEditing && "cursor-pointer"
                          )}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {config.label}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>

                <Separator />

                {/* Claim Details Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Claim Number</Label>
                    <Input
                      value={isEditing ? claimForm.claim_number : claimData?.claim_number || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, claim_number: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="CLM-2026-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Insurance Carrier</Label>
                    <Input
                      value={isEditing ? claimForm.carrier_name : claimData?.carrier_name || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, carrier_name: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="State Farm, Allstate, etc."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Policy Number</Label>
                    <Input
                      value={isEditing ? claimForm.policy_number : claimData?.policy_number || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, policy_number: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="POL-123456"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Date of Loss</Label>
                    <Input
                      type="date"
                      value={isEditing ? claimForm.date_of_loss : claimData?.date_of_loss || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, date_of_loss: e.target.value }))}
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Deductible</Label>
                    <Input
                      value={isEditing ? claimForm.deductible : claimData?.deductible || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, deductible: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="$1,000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Adjuster Name</Label>
                    <Input
                      value={isEditing ? claimForm.adjuster_name : claimData?.adjuster_name || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, adjuster_name: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Adjuster Phone</Label>
                    <Input
                      value={isEditing ? claimForm.adjuster_phone : claimData?.adjuster_phone || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, adjuster_phone: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Adjuster Email</Label>
                    <Input
                      value={isEditing ? claimForm.adjuster_email : claimData?.adjuster_email || ''}
                      onChange={(e) => setClaimForm(prev => ({ ...prev, adjuster_email: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="adjuster@carrier.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={isEditing ? claimForm.notes : claimData?.notes || ''}
                    onChange={(e) => setClaimForm(prev => ({ ...prev, notes: e.target.value }))}
                    disabled={!isEditing}
                    placeholder="Additional claim notes..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  {isEditing ? (
                    <>
                      <Button variant="outline" onClick={() => {
                        setIsEditing(false);
                        if (claimData) setClaimForm(claimData);
                      }}>
                        Cancel
                      </Button>
                      <Button onClick={handleSave} disabled={saveClaimMutation.isPending}>
                        {saveClaimMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                        ) : (
                          'Save Claim Info'
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => setIsEditing(true)}>
                      Edit Claim Info
                    </Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Xactimate Builder Tab */}
          <TabsContent value="xactimate" className="mt-0">
            <XactScopeBuilder pipelineEntryId={pipelineEntryId} jobId={jobId} />
          </TabsContent>

          {/* Supplements Tab */}
          <TabsContent value="supplements" className="space-y-4 mt-0">
            <SupplementTracker pipelineEntryId={pipelineEntryId} />
          </TabsContent>

          {/* Scope Tracking Tab */}
          <TabsContent value="scope" className="space-y-4 mt-0">
            <ScopeTracker pipelineEntryId={pipelineEntryId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

// ---- Supplement Tracker sub-component ----
interface SupplementEntry {
  id: string;
  title: string;
  amount: number;
  status: 'draft' | 'submitted' | 'approved' | 'denied';
  submitted_at?: string;
  notes: string;
}

const SupplementTracker: React.FC<{ pipelineEntryId: string }> = ({ pipelineEntryId }) => {
  const queryClient = useQueryClient();
  const [supplements, setSupplements] = useState<SupplementEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newSupplement, setNewSupplement] = useState({ title: '', amount: '', notes: '' });

  // Load from pipeline metadata
  const { data } = useQuery({
    queryKey: ['supplements-tracker', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      return ((data?.metadata as any)?.supplements || []) as SupplementEntry[];
    },
    enabled: !!pipelineEntryId,
  });

  React.useEffect(() => {
    if (data) setSupplements(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (updatedSupplements: SupplementEntry[]) => {
      const { data: entry, error: fetchErr } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (fetchErr) throw fetchErr;
      const metadata = (entry?.metadata as Record<string, unknown>) || {};
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ metadata: { ...metadata, supplements: updatedSupplements } })
        .eq('id', pipelineEntryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplements-tracker', pipelineEntryId] });
      toast.success('Supplements updated');
    },
  });

  const addSupplement = () => {
    const entry: SupplementEntry = {
      id: crypto.randomUUID(),
      title: newSupplement.title,
      amount: parseFloat(newSupplement.amount) || 0,
      status: 'draft',
      notes: newSupplement.notes,
    };
    const updated = [...supplements, entry];
    setSupplements(updated);
    saveMutation.mutate(updated);
    setNewSupplement({ title: '', amount: '', notes: '' });
    setShowAdd(false);
  };

  const updateStatus = (id: string, status: SupplementEntry['status']) => {
    const updated = supplements.map(s =>
      s.id === id ? { ...s, status, ...(status === 'submitted' ? { submitted_at: new Date().toISOString() } : {}) } : s
    );
    setSupplements(updated);
    saveMutation.mutate(updated);
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    submitted: 'bg-yellow-500/10 text-yellow-600',
    approved: 'bg-green-500/10 text-green-600',
    denied: 'bg-red-500/10 text-red-600',
  };

  const totalApproved = supplements
    .filter(s => s.status === 'approved')
    .reduce((sum, s) => sum + s.amount, 0);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Supplements</p>
          <p className="text-lg font-bold">{supplements.length}</p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Approved Value</p>
          <p className="text-lg font-bold text-green-600">{formatCurrency(totalApproved)}</p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="text-lg font-bold text-yellow-600">
            {supplements.filter(s => s.status === 'submitted').length}
          </p>
        </div>
      </div>

      {/* List */}
      {supplements.length === 0 && !showAdd ? (
        <div className="text-center py-6">
          <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-3">No supplements filed yet</p>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Supplement
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {supplements.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{s.title}</span>
                    <Badge variant="outline" className={cn("text-xs", statusColors[s.status])}>
                      {s.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.notes}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCurrency(s.amount)}</p>
                  {s.status === 'draft' && (
                    <Button size="sm" variant="outline" className="mt-1 text-xs h-7"
                      onClick={() => updateStatus(s.id, 'submitted')}>
                      Submit
                    </Button>
                  )}
                  {s.status === 'submitted' && (
                    <div className="flex gap-1 mt-1">
                      <Button size="sm" variant="outline" className="text-xs h-7 text-green-600"
                        onClick={() => updateStatus(s.id, 'approved')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 text-red-600"
                        onClick={() => updateStatus(s.id, 'denied')}>
                        Deny
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {showAdd ? (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Supplement Title</Label>
                  <Input
                    value={newSupplement.title}
                    onChange={e => setNewSupplement(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Missing ice & water shield"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    value={newSupplement.amount}
                    onChange={e => setNewSupplement(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="1,500"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={newSupplement.notes}
                  onChange={e => setNewSupplement(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Describe why this supplement is needed..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button size="sm" onClick={addSupplement} disabled={!newSupplement.title}>
                  Add Supplement
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Supplement
            </Button>
          )}
        </>
      )}
    </div>
  );
};

// ---- Scope Tracker sub-component ----
const ScopeTracker: React.FC<{ pipelineEntryId: string }> = ({ pipelineEntryId }) => {
  const { data: scopeData } = useQuery({
    queryKey: ['scope-tracker', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      const meta = data?.metadata as any;
      return {
        carrier_scope: meta?.carrier_scope_uploaded || false,
        contractor_scope: meta?.contractor_scope_uploaded || false,
        scope_comparison_done: meta?.scope_comparison_done || false,
      };
    },
    enabled: !!pipelineEntryId,
  });

  const items = [
    {
      label: 'Carrier Scope',
      description: 'Upload the insurance carrier\'s initial scope document',
      done: scopeData?.carrier_scope || false,
      icon: FileText,
    },
    {
      label: 'Contractor Scope',
      description: 'Build your Xactimate scope using the builder tab',
      done: scopeData?.contractor_scope || false,
      icon: ClipboardList,
    },
    {
      label: 'Scope Comparison',
      description: 'Compare carrier vs contractor scope for supplement opportunities',
      done: scopeData?.scope_comparison_done || false,
      icon: Search,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Track the progress of your insurance scope through each stage.
      </p>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <div key={i} className={cn(
            "flex items-start gap-3 p-3 rounded-lg border",
            item.done ? "bg-green-500/5 border-green-500/20" : "bg-muted/30"
          )}>
            <div className={cn(
              "p-2 rounded-full shrink-0",
              item.done ? "bg-green-500/10" : "bg-muted"
            )}>
              {item.done ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <Icon className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className={cn("font-medium text-sm", item.done && "text-green-600")}>
                {item.label}
              </p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
