import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { CommissionSummaryCards } from '@/components/commission/CommissionSummaryCards';
import { DrawTally } from '@/components/commission/DrawTally';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, Filter, RefreshCw, ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { exportCapOutForJob } from '@/components/commission/CapOutPdfExport';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { formatCurrency, formatPercent } from '@/lib/commission-calculator';
import { useNavigate } from 'react-router-dom';
import { useLocation as useLocationContext } from '@/contexts/LocationContext';

interface ComputedCommission {
  id: string;
  leadName: string;
  customerName: string;
  address: string;
  status: string;
  stageName: string;
  repName: string;
  repId: string | null;
  contractValue: number;
  materialCost: number;
  laborCost: number;
  overheadAmount: number;
  grossProfit: number;
  commissionRate: number;
  commissionType: string;
  commissionAmount: number;
  createdAt: string;
  contactNumber: string | number | null;
}

export default function CommissionReport() {
  const navigate = useNavigate();
  const { currentLocationId } = useLocationContext();
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(subMonths(new Date(), 3)), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const EXCLUDED_STATUSES = ['lost', 'canceled'];
  // Minimum stage_order for "project" level
  const MIN_STAGE_ORDER = 6;

  // Get current user and tenant
  const { data: currentUser } = useQuery({
    queryKey: ['current-user-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
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

  // Get qualifying pipeline stage keys for this tenant
  const { data: qualifyingStageKeys = [] } = useQuery({
    queryKey: ['qualifying-stages', currentUser?.tenant_id],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return [];
      const { data } = await supabase
        .from('pipeline_stages')
        .select('key, stage_order')
        .eq('tenant_id', currentUser.tenant_id)
        .gte('stage_order', MIN_STAGE_ORDER);
      if (!data) return [];
      return data
        .filter(s => !EXCLUDED_STATUSES.includes(s.key))
        .map(s => s.key);
    },
    enabled: !!currentUser?.tenant_id,
  });

  // Get reps for filter — only from selected location
  const { data: reps = [] } = useQuery({
    queryKey: ['commission-reps', currentUser?.tenant_id, currentLocationId],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return [];

      if (currentLocationId) {
        // Get user IDs assigned to this location
        const { data: assignments } = await supabase
          .from('user_location_assignments')
          .select('user_id')
          .eq('location_id', currentLocationId)
          .eq('is_active', true);
        const userIds = (assignments || []).map(a => a.user_id);
        if (userIds.length === 0) return [];
        const { data } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .eq('tenant_id', currentUser.tenant_id)
          .in('id', userIds)
          .order('first_name');
        return data || [];
      }

      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('tenant_id', currentUser.tenant_id)
        .order('first_name');
      return data || [];
    },
    enabled: !!currentUser?.tenant_id,
  });

  // Main data query: pipeline entries at project+ stages
  const { data: commissions = [], isLoading, refetch } = useQuery({
    queryKey: ['commission-live', currentUser?.tenant_id, dateRange, selectedRep, qualifyingStageKeys, currentLocationId],
    queryFn: async (): Promise<ComputedCommission[]> => {
      if (!currentUser?.tenant_id || qualifyingStageKeys.length === 0) return [];

      let query = supabase
        .from('pipeline_entries')
        .select(`
          id, lead_name, status, assigned_to, estimated_value, created_at, contact_number,
          contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state)
        `)
        .eq('tenant_id', currentUser.tenant_id)
        .eq('is_deleted', false)
        .in('status', qualifyingStageKeys)
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end + 'T23:59:59')
        .order('created_at', { ascending: false });

      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }

      if (selectedRep !== 'all') {
        query = query.eq('assigned_to', selectedRep);
      }

      const { data: entries, error } = await query;
      if (error) throw error;
      if (!entries || entries.length === 0) return [];

      // Get rep profiles with commission settings
      const repIds = [...new Set(entries.map(e => e.assigned_to).filter(Boolean))] as string[];
      const { data: repProfiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, commission_rate, commission_structure')
        .in('id', repIds.length > 0 ? repIds : ['none']);
      const repMap = new Map((repProfiles || []).map(p => [p.id, p]));

      // Get latest estimate for each pipeline entry
      const entryIds = entries.map(e => e.id);
      const { data: estimates } = await supabase
        .from('estimates')
        .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost, overhead_amount')
        .in('pipeline_entry_id', entryIds)
        .order('created_at', { ascending: false });

      // Map to latest estimate per entry
      const estimateMap = new Map<string, any>();
      (estimates || []).forEach(est => {
        if (!estimateMap.has(est.pipeline_entry_id)) {
          estimateMap.set(est.pipeline_entry_id, est);
        }
      });

      // Get stage names
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('key, name')
        .eq('tenant_id', currentUser.tenant_id);
      const stageMap = new Map((stages || []).map(s => [s.key, s.name]));

      // Build computed commissions
      return entries.map(entry => {
        const rep = entry.assigned_to ? repMap.get(entry.assigned_to) : null;
        const est = estimateMap.get(entry.id);
        const contact = entry.contacts as any;

        const contractValue = est?.selling_price || entry.estimated_value || 0;
        const materialCost = est?.material_cost || 0;
        const laborCost = est?.labor_cost || 0;
        const overheadAmount = est?.overhead_amount || 0;
        const grossProfit = contractValue - materialCost - laborCost;

        const commissionRate = rep?.commission_rate || 0;
        const commissionType = rep?.commission_structure || 'profit_split';

        let commissionAmount = 0;
        if (commissionType === 'percentage_contract_price' || commissionType === 'percentage_selling_price') {
          commissionAmount = contractValue * (commissionRate / 100);
        } else {
          // profit_split
          const netProfit = grossProfit - overheadAmount;
          commissionAmount = Math.max(0, netProfit * (commissionRate / 100));
        }

        const customerName = contact
          ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
          : '';
        const address = contact
          ? [contact.address_street, contact.address_city, contact.address_state].filter(Boolean).join(', ')
          : '';

        return {
          id: entry.id,
          leadName: entry.lead_name || customerName || `Lead #${entry.contact_number || ''}`,
          customerName,
          address,
          status: entry.status,
          stageName: stageMap.get(entry.status) || entry.status,
          repName: rep ? `${rep.first_name || ''} ${rep.last_name || ''}`.trim() : 'Unassigned',
          repId: entry.assigned_to,
          contractValue: Number(contractValue),
          materialCost: Number(materialCost),
          laborCost: Number(laborCost),
          overheadAmount: Number(overheadAmount),
          grossProfit: Number(grossProfit),
          commissionRate: Number(commissionRate),
          commissionType,
          commissionAmount: Math.round(commissionAmount * 100) / 100,
          createdAt: entry.created_at,
          contactNumber: entry.contact_number,
        };
      });
    },
    enabled: !!currentUser?.tenant_id && qualifyingStageKeys.length > 0,
  });

  // Summary stats
  const totalJobs = commissions.length;
  const totalRevenue = commissions.reduce((sum, c) => sum + c.contractValue, 0);
  const totalCommissions = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const pendingCommissions = totalCommissions; // All are pending until paid via commission_earnings
  const paidCommissions = 0;

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getStageBadge = (stageName: string, status: string) => {
    if (['completed', 'complete', 'capped_out'].includes(status)) {
      return <Badge className="bg-green-600 text-white">{stageName}</Badge>;
    }
    if (['in_production', 'contracted'].includes(status)) {
      return <Badge className="bg-blue-600 text-white">{stageName}</Badge>;
    }
    return <Badge className="bg-amber-500 text-white">{stageName}</Badge>;
  };

  const handleExportCSV = () => {
    const headers = ['Lead', 'Customer', 'Address', 'Stage', 'Rep', 'Contract Value', 'Materials', 'Labor', 'Overhead', 'Gross Profit', 'Commission Type', 'Commission Rate', 'Commission Amount', 'Date'];
    const rows = commissions.map(c => [
      c.leadName, c.customerName, c.address, c.stageName, c.repName,
      c.contractValue, c.materialCost, c.laborCost, c.overheadAmount, c.grossProfit,
      c.commissionType, c.commissionRate, c.commissionAmount, c.createdAt,
    ]);
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `commission-report-${dateRange.start}-to-${dateRange.end}.csv`;
    link.click();
  };

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Commission Report</h1>
            <p className="text-muted-foreground">
              All jobs at Project status or beyond — with rep commission calculations
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            <Button onClick={handleExportCSV} disabled={commissions.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                />
              </div>
              {isManager && (
                <div className="space-y-2">
                  <Label>Sales Rep</Label>
                  <Select value={selectedRep} onValueChange={setSelectedRep}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Reps" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Reps</SelectItem>
                      {reps.map(rep => (
                        <SelectItem key={rep.id} value={rep.id}>
                          {rep.first_name} {rep.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <CommissionSummaryCards
          totalJobs={totalJobs}
          totalRevenue={totalRevenue}
          totalCommissions={totalCommissions}
          pendingCommissions={pendingCommissions}
          paidCommissions={paidCommissions}
        />

        {/* Draw Tally */}
        {currentUser?.tenant_id && (
          <DrawTally
            tenantId={currentUser.tenant_id}
            totalEarnedCommissions={totalCommissions}
            selectedRepId={selectedRep}
            isManager={!!isManager}
          />
        )}

        {/* Commission Table */}
        <Card>
          <CardHeader>
            <CardTitle>Commission Details ({commissions.length} jobs)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading commission data...</div>
            ) : commissions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No jobs at project status or beyond found for the selected period
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Project</TableHead>
                      {isManager && <TableHead>Rep</TableHead>}
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Contract</TableHead>
                      <TableHead className="text-right">Gross Profit</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissions.map(c => {
                      const isExpanded = expandedRows.has(c.id);
                      return (
                        <Collapsible key={c.id} asChild open={isExpanded}>
                          <>
                            <TableRow className="cursor-pointer hover:bg-muted/50">
                              <TableCell>
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleRow(c.id)}>
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                </CollapsibleTrigger>
                              </TableCell>
                              <TableCell>
                                <div
                                  className="font-medium text-primary hover:underline cursor-pointer"
                                  onClick={() => navigate(`/lead/${c.id}`)}
                                >
                                  {c.leadName}
                                </div>
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {c.address || c.customerName}
                                </div>
                              </TableCell>
                              {isManager && (
                                <TableCell className="text-sm">{c.repName}</TableCell>
                              )}
                              <TableCell>{getStageBadge(c.stageName, c.status)}</TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(c.contractValue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(c.grossProfit)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {c.commissionType === 'profit_split' ? 'Profit Split' : 'Selling Price'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-bold text-green-600">
                                {formatCurrency(c.commissionAmount)}
                              </TableCell>
                            </TableRow>

                            <CollapsibleContent asChild>
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={isManager ? 8 : 7} className="p-4">
                                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">Materials:</span>
                                      <div className="font-medium">{formatCurrency(c.materialCost)}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Labor:</span>
                                      <div className="font-medium">{formatCurrency(c.laborCost)}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Overhead:</span>
                                      <div className="font-medium">{formatCurrency(c.overheadAmount)}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Commission Rate:</span>
                                      <div className="font-medium">{formatPercent(c.commissionRate)}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Date Created:</span>
                                      <div className="font-medium">
                                        {format(new Date(c.createdAt), 'MM/dd/yyyy')}
                                      </div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Address:</span>
                                      <div className="font-medium truncate">{c.address || 'N/A'}</div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleContent>
                          </>
                        </Collapsible>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
