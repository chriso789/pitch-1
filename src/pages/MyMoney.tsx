import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawTally } from '@/components/commission/DrawTally';
import { RepDrawLedger } from '@/components/commission/RepDrawLedger';
import { useSettledStages } from '@/hooks/useSettledStages';
import { formatCurrency } from '@/lib/commission-calculator';
import { Wallet, TrendingUp, DollarSign, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function MyMoneyContent() {
  const navigate = useNavigate();
  const { settledKeys, payoutStageName } = useSettledStages();
  const [jobView, setJobView] = useState<'open' | 'paid' | 'all'>('open');

  // Get current user
  const { data: currentUser } = useQuery({
    queryKey: ['current-user-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id, first_name, last_name, commission_rate, commission_structure')
        .eq('id', user.id)
        .single();
      if (!profile) return null;
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      return { ...profile, user_roles: roles || [] };
    },
  });

  const isManager = currentUser?.user_roles?.some(
    (r: { role: string }) =>
      ['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'].includes(r.role)
  );

  // Qualifying stages: everything at or after the tenant's conversion point, so
  // converted (not yet completed) jobs show their upcoming commission from day one.
  const { data: qualifyingStageKeys = [] } = useQuery({
    queryKey: ['my-money-stages', currentUser?.tenant_id],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return [];
      const { data: conversionStage } = await supabase
        .from('pipeline_stages')
        .select('stage_order')
        .eq('tenant_id', currentUser.tenant_id)
        .eq('is_conversion_point', true)
        .order('stage_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      const minOrder = conversionStage?.stage_order ?? 4;
      const { data } = await supabase
        .from('pipeline_stages')
        .select('key, stage_order')
        .eq('tenant_id', currentUser.tenant_id)
        .gte('stage_order', minOrder);
      if (!data) return [];
      return data.filter(s => !['lost', 'canceled'].includes(s.key)).map(s => s.key);
    },
    enabled: !!currentUser?.tenant_id,
  });


  // Get my commissions (current user only)
  const { data: myCommissions = [] } = useQuery({
    queryKey: ['my-money-commissions', currentUser?.id, currentUser?.tenant_id, qualifyingStageKeys],
    queryFn: async () => {
      if (!currentUser?.tenant_id || !currentUser?.id || qualifyingStageKeys.length === 0) return [];

      const { data: entries } = await supabase
        .from('pipeline_entries')
        .select(`
          id, lead_name, status, estimated_value, created_at, contact_number,
          contacts!pipeline_entries_contact_id_fkey(first_name, last_name)
        `)
        .eq('tenant_id', currentUser.tenant_id)
        .eq('is_deleted', false)
        .eq('assigned_to', currentUser.id)
        .in('status', qualifyingStageKeys);

      if (!entries || entries.length === 0) return [];

      // Get estimates
      const entryIds = entries.map(e => e.id);
      const { data: estimates } = await supabase
        .from('estimates')
        .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost, overhead_amount')
        .in('pipeline_entry_id', entryIds)
        .order('created_at', { ascending: false });

      const estimateMap = new Map<string, any>();
      (estimates || []).forEach(est => {
        if (!estimateMap.has(est.pipeline_entry_id)) {
          estimateMap.set(est.pipeline_entry_id, est);
        }
      });

      const commRate = Number(currentUser.commission_rate || 0);
      const commType = currentUser.commission_structure || 'profit_split';

      return entries.map(entry => {
        const est = estimateMap.get(entry.id);
        const contractValue = Number(est?.selling_price || entry.estimated_value || 0);
        const materialCost = Number(est?.material_cost || 0);
        const laborCost = Number(est?.labor_cost || 0);
        const overheadAmount = Number(est?.overhead_amount || 0);
        const grossProfit = contractValue - materialCost - laborCost;

        let commissionAmount = 0;
        if (commType === 'percentage_contract_price' || commType === 'percentage_selling_price') {
          commissionAmount = contractValue * (commRate / 100);
        } else {
          const netProfit = grossProfit - overheadAmount;
          commissionAmount = Math.max(0, netProfit * (commRate / 100));
        }

        const contact = entry.contacts as any;
        const name = (entry as any).lead_name || 
          (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : `Lead #${entry.contact_number || ''}`);

        return {
          id: entry.id,
          name,
          status: entry.status,
          contractValue,
          commissionAmount: Math.round(commissionAmount * 100) / 100,
          createdAt: entry.created_at,
        };
      });
    },
    enabled: !!currentUser?.id && qualifyingStageKeys.length > 0,
  });

  // Tag each job as settled (capped out / paid) so upcoming commission totals
  // only count what is still owed, while paid jobs stay viewable via the filter.
  const taggedCommissions = useMemo(() => {
    const settledSet = new Set(settledKeys);
    return myCommissions.map(c => ({ ...c, settled: settledSet.has(c.status) }));
  }, [myCommissions, settledKeys]);

  const openCommissions = taggedCommissions.filter(c => !c.settled);
  const paidCommissions = taggedCommissions.filter(c => c.settled);

  const visibleCommissions =
    jobView === 'paid' ? paidCommissions : jobView === 'all' ? taggedCommissions : openCommissions;

  const totalEarned = openCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const totalPaidOut = paidCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const totalContract = openCommissions.reduce((sum, c) => sum + c.contractValue, 0);

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="h-6 w-6 text-amber-500" />
              My Money
            </h1>
            <p className="text-muted-foreground">
              Track your commissions, draws, and earnings
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/commission-report')}>
            Full Report <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Upcoming Commission</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(totalEarned)}</p>
                </div>
                <DollarSign className="h-8 w-8 text-green-500/30" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Paid / Capped Out{payoutStageName ? ` (${payoutStageName})` : ''}
                  </p>
                  <p className="text-2xl font-bold">{formatCurrency(totalPaidOut)}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-emerald-600/30" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Jobs</p>
                  <p className="text-2xl font-bold">{openCommissions.length}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-500/30" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Open Contract Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalContract)}</p>
                </div>
                <Wallet className="h-8 w-8 text-amber-500/30" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Draw Tally */}
        {currentUser?.tenant_id && (
          <DrawTally
            tenantId={currentUser.tenant_id}
            totalEarnedCommissions={totalEarned}
            selectedRepId={currentUser.id}
            isManager={!!isManager}
          />
        )}

        {/* Rolling draw balance */}
        {currentUser?.tenant_id && currentUser?.id && (
          <RepDrawLedger
            tenantId={currentUser.tenant_id}
            repId={currentUser.id}
            commissions={taggedCommissions}
          />
        )}

        {/* My Jobs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">
              My Commission Jobs ({visibleCommissions.length})
            </CardTitle>
            <Select value={jobView} onValueChange={(v) => setJobView(v as 'open' | 'paid' | 'all')}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open Jobs</SelectItem>
                <SelectItem value="paid">Paid / Capped Out</SelectItem>
                <SelectItem value="all">All Jobs</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {visibleCommissions.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground">No commission-eligible jobs here</p>
            ) : (
              <div className="space-y-2">
                {visibleCommissions.map(job => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => navigate(`/lead/${job.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{job.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Contract: {formatCurrency(job.contractValue)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${job.settled ? 'text-muted-foreground' : 'text-green-600'}`}>
                        {formatCurrency(job.commissionAmount)}
                      </p>
                      <Badge variant={job.settled ? 'outline' : 'secondary'} className="text-[10px]">
                        {job.settled ? 'Paid' : job.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}

export default function MyMoney() {
  return (
    <GlobalLayout>
      <div className="p-4 md:p-6">
        <MyMoneyContent />
      </div>
    </GlobalLayout>
  );
}