import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useLocation } from '@/contexts/LocationContext';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3, Plus, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { MARKETING_CHANNELS, CHANNEL_LABELS, classifySource, parseCostCents, totalCost, type MarketingChannel } from '@/lib/marketingAudit';

const dateString = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);

export default function MarketingAuditPage() {
  const tenantId = useEffectiveTenantId();
  const { currentLocationId } = useLocation();
  const qc = useQueryClient();
  const [start, setStart] = useState(dateString(new Date(Date.now() - 29 * 86400000)));
  const [end, setEnd] = useState(dateString(new Date()));
  const [currency, setCurrency] = useState('USD');
  const [channel, setChannel] = useState('all');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ channel: 'facebook' as MarketingChannel, campaign: '', placement: '', date: dateString(new Date()), amount: '', reference: '', notes: '', entry_type: 'expense' });
  const validRange = Boolean(start && end && start <= end);

  const costs = useQuery({
    queryKey: ['marketing-audit-costs', tenantId, start, end, currency],
    enabled: Boolean(tenantId && validRange),
    queryFn: async () => {
      if (!tenantId) throw new Error('Select a company.');
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('marketing_cost_entries').select('*').eq('tenant_id', tenantId).eq('currency', currency).gte('expense_date', start).lte('expense_date', end).order('expense_date', { ascending: false }).order('id').range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      return rows;
    },
  });
  const leads = useQuery({
    queryKey: ['marketing-audit-leads', tenantId, currentLocationId, start, end],
    enabled: Boolean(tenantId && currentLocationId && validRange),
    queryFn: async () => {
      if (!tenantId || !currentLocationId) throw new Error('Select a company and location.');
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('contacts').select('id,first_name,last_name,lead_source,lead_source_details,created_at').eq('tenant_id', tenantId).eq('location_id', currentLocationId).eq('is_deleted', false).gte('created_at', `${start}T00:00:00Z`).lt('created_at', `${dateString(new Date(new Date(`${end}T00:00:00Z`).getTime() + 86400000))}T00:00:00Z`).order('created_at', { ascending: false }).order('id').range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      return rows.map(row => {
        const details = row.lead_source_details;
        const object = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
        const source = typeof object.utm_source === 'string' ? object.utm_source : row.lead_source;
        return { ...row, source, channel: classifySource(source), campaign: typeof object.utm_campaign === 'string' ? object.utm_campaign : '', placement: typeof object.utm_content === 'string' ? object.utm_content : '' };
      });
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Select a company.');
      if (!draft.date || draft.campaign.length > 200 || draft.placement.length > 200 || draft.notes.length > 2000) throw new Error('Check the expense date and field lengths.');
      const { error } = await supabase.from('marketing_cost_entries').insert({ tenant_id: tenantId, channel: draft.channel, campaign: draft.campaign.trim(), placement: draft.placement.trim(), expense_date: draft.date, currency, amount_cents: parseCostCents(draft.amount), entry_type: draft.entry_type, reference: draft.reference.trim(), notes: draft.notes.trim() });
      if (error) throw error;
      return tenantId;
    },
    onSuccess: savedTenant => {
      qc.invalidateQueries({ queryKey: ['marketing-audit-costs', savedTenant] });
      setOpen(false); setDraft(d => ({ ...d, amount: '', reference: '', notes: '' })); toast.success('Marketing cost recorded');
    },
    onError: error => toast.error(error.message),
  });
  const visibleCosts = (costs.data ?? []).filter(row => channel === 'all' || row.channel === channel);
  const visibleLeads = (leads.data ?? []).filter(row => channel === 'all' || row.channel === channel);
  const spend = totalCost(visibleCosts);
  const error = costs.error || leads.error;

  return <GlobalLayout><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 className="h-6 w-6 text-primary" />Marketing Audit</h1>
      <div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Refresh marketing audit" onClick={() => { costs.refetch(); if (currentLocationId) leads.refetch(); }}><RefreshCw className="h-4 w-4" /></Button><Button disabled={!tenantId} onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Record cost</Button></div>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <div><Label htmlFor="marketing-start">From (UTC)</Label><Input id="marketing-start" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
      <div><Label htmlFor="marketing-end">Through (UTC)</Label><Input id="marketing-end" type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
      <Select value={currency} onValueChange={setCurrency}><SelectTrigger className="w-28" aria-label="Currency"><SelectValue /></SelectTrigger><SelectContent>{['USD', 'CAD', 'EUR', 'GBP', 'SEK'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
      <Select value={channel} onValueChange={setChannel}><SelectTrigger className="w-44" aria-label="Channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{MARKETING_CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>)}<SelectItem value="unknown">Unattributed</SelectItem></SelectContent></Select>
    </div>
    {!validRange && <Alert variant="destructive"><AlertDescription>Choose a valid date range.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
    {!currentLocationId && <Alert><AlertDescription>Select a location to view its inbound contacts. Costs cover the selected company.</AlertDescription></Alert>}
    <div className="grid gap-6 border-y border-border py-5 sm:grid-cols-3">
      <div><p className="text-sm text-muted-foreground">Recorded company spend · {currency}</p><p className="mt-1 text-3xl font-semibold">{costs.isLoading || costs.isError ? '—' : money(spend / 100, currency)}</p></div>
      <div><p className="text-sm text-muted-foreground">New contacts · selected location</p><p className="mt-1 text-3xl font-semibold">{!currentLocationId || leads.isLoading || leads.isError ? '—' : visibleLeads.length}</p></div>
      <div><p className="text-sm text-muted-foreground">Unattributed contacts · selected location</p><p className="mt-1 text-3xl font-semibold">{!currentLocationId || leads.isLoading || leads.isError ? '—' : (leads.data ?? []).filter(l => l.channel === 'unknown').length}</p></div>
    </div>
    <Tabs defaultValue="channels"><TabsList><TabsTrigger value="channels">Channels</TabsTrigger><TabsTrigger value="costs">Cost ledger</TabsTrigger><TabsTrigger value="inbound">Inbound contacts</TabsTrigger></TabsList>
      <TabsContent value="channels"><Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Company spend</TableHead><TableHead>Location contacts</TableHead><TableHead>Matched company cost / contact</TableHead></TableRow></TableHeader><TableBody>{[...MARKETING_CHANNELS, 'unknown' as const].filter(c => channel === 'all' || channel === c).map(c => {
        const amount = totalCost((costs.data ?? []).filter(row => row.channel === c));
        const count = (leads.data ?? []).filter(row => row.channel === c).length;
        // Company costs and location-only leads have different scope: never present them as CPL.
        return <TableRow key={c}><TableCell className="font-medium">{c === 'unknown' ? 'Unattributed' : CHANNEL_LABELS[c]}</TableCell><TableCell>{costs.isError || costs.isLoading ? '—' : money(amount / 100, currency)}</TableCell><TableCell>{currentLocationId && !leads.isError && !leads.isLoading ? count : '—'}</TableCell><TableCell className="text-muted-foreground">Not available · scope differs</TableCell></TableRow>;
      })}</TableBody></Table></TabsContent>
      <TabsContent value="costs"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Channel</TableHead><TableHead>Campaign / placement</TableHead><TableHead>Reference</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader><TableBody>{visibleCosts.map(row => <TableRow key={row.id}><TableCell>{row.expense_date}</TableCell><TableCell>{CHANNEL_LABELS[row.channel as MarketingChannel]}</TableCell><TableCell>{row.campaign || '—'}<div className="text-xs text-muted-foreground">{row.placement}</div></TableCell><TableCell>{row.reference || '—'}</TableCell><TableCell>{money((row.entry_type === 'credit' ? -1 : 1) * row.amount_cents / 100, currency)}</TableCell></TableRow>)}</TableBody></Table>{!costs.isLoading && !costs.isError && !visibleCosts.length && <p className="py-8 text-center text-muted-foreground">No recorded costs in this period.</p>}</TabsContent>
      <TabsContent value="inbound"><Table><TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead><TableHead>Campaign / placement</TableHead><TableHead>Open</TableHead></TableRow></TableHeader><TableBody>{visibleLeads.map(row => <TableRow key={row.id}><TableCell>{row.created_at.slice(0, 10)}</TableCell><TableCell>{row.first_name} {row.last_name}</TableCell><TableCell>{row.source || 'Unattributed'}</TableCell><TableCell>{row.campaign || '—'}<div className="text-xs text-muted-foreground">{row.placement}</div></TableCell><TableCell><Button asChild size="icon" variant="ghost" aria-label={`Open ${row.first_name} ${row.last_name}`}><Link to={`/contact/${row.id}`}><ExternalLink className="h-4 w-4" /></Link></Button></TableCell></TableRow>)}</TableBody></Table>{!leads.isLoading && !leads.isError && !visibleLeads.length && <p className="py-8 text-center text-muted-foreground">No contacts in this period.</p>}</TabsContent>
    </Tabs>
    <footer className="flex flex-wrap justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground"><span>Recorded costs only · ad-platform sync not connected · revenue attribution unverified</span><Button variant="outline" asChild><Link to="/inspection-requests">Inspection Requests</Link></Button></footer>
    <Dialog open={open} onOpenChange={value => { if (!save.isPending) setOpen(value); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Record marketing cost · {currency}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-2 gap-3"><div><Label>Channel</Label><Select value={draft.channel} onValueChange={value => setDraft(d => ({ ...d, channel: value as MarketingChannel }))}><SelectTrigger aria-label="Cost channel"><SelectValue /></SelectTrigger><SelectContent>{MARKETING_CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>)}</SelectContent></Select></div><div><Label>Entry type</Label><Select value={draft.entry_type} onValueChange={value => setDraft(d => ({ ...d, entry_type: value }))}><SelectTrigger aria-label="Entry type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expense">Expense</SelectItem><SelectItem value="credit">Credit / refund</SelectItem></SelectContent></Select></div></div>
        <div><Label htmlFor="cost-campaign">Campaign</Label><Input id="cost-campaign" value={draft.campaign} maxLength={200} onChange={e => setDraft(d => ({ ...d, campaign: e.target.value }))} /></div>
        <div><Label htmlFor="cost-placement">Placement</Label><Input id="cost-placement" value={draft.placement} maxLength={200} onChange={e => setDraft(d => ({ ...d, placement: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="cost-date">Expense date</Label><Input required id="cost-date" type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></div><div><Label htmlFor="cost-amount">Amount · {currency}</Label><Input required id="cost-amount" inputMode="decimal" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} /></div></div>
        <div><Label htmlFor="cost-reference">Invoice / reference</Label><Input id="cost-reference" maxLength={200} value={draft.reference} onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} /></div>
        <div><Label htmlFor="cost-notes">Notes</Label><Input id="cost-notes" maxLength={2000} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} /></div>
        <Button type="submit" className="w-full" disabled={save.isPending || !tenantId}>{save.isPending ? 'Saving…' : 'Save cost'}</Button>
      </form>
    </DialogContent></Dialog>
  </div></GlobalLayout>;
}