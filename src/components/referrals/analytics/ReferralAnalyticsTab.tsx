import { useEffect, useState } from "react";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { getRoleLevel } from "@/lib/roleUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Download, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  getReferralAnalyticsOverview, getReferralFunnel, getReferralTimeSeries,
  getTopReferrers, getReferralSourceBreakdown, getReferralGeoBreakdown,
  getReferralServiceBreakdown, getReferralPayoutReport,
  getReferralStoredCreditReport, getReferralPayoutAccounting,
} from "@/lib/referrals/analyticsApi";
import {
  exportReferralPayoutsCsv, exportReferralCreditsCsv,
  exportReferralAnalyticsSummaryCsv, downloadCsv,
} from "@/lib/referrals/exportReferralsCsv";
import { useReferralAnalyticsFilters, rangeForPreset, type DatePreset } from "@/hooks/referrals/useReferralAnalyticsFilters";
import { ReferralRevenueCards, money, pct } from "./ReferralRevenueCards";
import { ReferralFunnelChart } from "./ReferralFunnelChart";
import { ReferralTimeSeriesChart } from "./ReferralTimeSeriesChart";

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Last 7 days", value: "last_7" },
  { label: "Last 30 days", value: "last_30" },
  { label: "Last 90 days", value: "last_90" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "This year", value: "this_year" },
  { label: "All time", value: "all_time" },
];

function EmptyState({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-8 text-center">{text}</div>;
}

export function ReferralAnalyticsTab() {
  const tenantId = useEffectiveTenantId();
  const { profile } = useUserProfile();
  const canExportFinancial = getRoleLevel(profile?.role || "") <= 6;

  const { filters, update, setPreset } = useReferralAnalyticsFilters();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [series, setSeries] = useState<any>(null);
  const [tops, setTops] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [geo, setGeo] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [payoutRows, setPayoutRows] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [accounting, setAccounting] = useState<any>(null);

  async function reload() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [o, f, ts, tr, sb, gb, svb, pr, sc, ac] = await Promise.all([
        getReferralAnalyticsOverview(tenantId, filters),
        getReferralFunnel(tenantId, filters),
        getReferralTimeSeries(tenantId, filters),
        getTopReferrers(tenantId, filters),
        getReferralSourceBreakdown(tenantId, filters),
        getReferralGeoBreakdown(tenantId, filters),
        getReferralServiceBreakdown(tenantId, filters),
        getReferralPayoutReport(tenantId, filters),
        getReferralStoredCreditReport(tenantId, filters),
        getReferralPayoutAccounting(tenantId, filters),
      ]);
      setOverview(o); setFunnel(f); setSeries(ts); setTops(tr);
      setSources(sb); setGeo(gb); setServices(svb);
      setPayoutRows(pr); setCredits(sc); setAccounting(ac);
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [
    tenantId, filters.dateFrom, filters.dateTo, filters.referrerContactId,
    filters.serviceNeeded, filters.city, filters.zip, filters.utmSource, filters.utmCampaign,
    filters.campaignId,
  ]);

  if (!tenantId) return <Skeleton className="h-64 w-full" />;

  const noData = overview && overview.totalReferralLinks === 0 && overview.submittedLeads === 0 && overview.totalClicks === 0;

  return (
    <div className="space-y-5">
      {/* Header / filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Preset</Label>
              <Select onValueChange={(v) => setPreset(v as DatePreset)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Last 90 days" /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-40" value={filters.dateFrom}
                onChange={(e) => update({ dateFrom: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={filters.dateTo}
                onChange={(e) => update({ dateTo: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">UTM source</Label>
              <Input className="w-32" placeholder="facebook" value={filters.utmSource ?? ""}
                onChange={(e) => update({ utmSource: e.target.value || undefined })} />
            </div>
            <div>
              <Label className="text-xs">UTM campaign</Label>
              <Input className="w-36" placeholder="spring-roof" value={filters.utmCampaign ?? ""}
                onChange={(e) => update({ utmCampaign: e.target.value || undefined })} />
            </div>
            <div>
              <Label className="text-xs">City</Label>
              <Input className="w-32" value={filters.city ?? ""}
                onChange={(e) => update({ city: e.target.value || undefined })} />
            </div>
            <div>
              <Label className="text-xs">ZIP</Label>
              <Input className="w-24" value={filters.zip ?? ""}
                onChange={(e) => update({ zip: e.target.value || undefined })} />
            </div>
            <div>
              <Label className="text-xs">Service</Label>
              <Input className="w-32" value={filters.serviceNeeded ?? ""}
                onChange={(e) => update({ serviceNeeded: e.target.value || undefined })} />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm"><Download className="h-4 w-4 mr-1" /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => overview && downloadCsv(
                      `referral-analytics-${filters.dateFrom}_${filters.dateTo}.csv`,
                      exportReferralAnalyticsSummaryCsv(overview, filters),
                    )}>
                    Analytics summary
                  </DropdownMenuItem>
                  {canExportFinancial && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => downloadCsv(
                        `referral-payouts-${filters.dateFrom}_${filters.dateTo}.csv`,
                        exportReferralPayoutsCsv(payoutRows, true),
                      )}>Payout report</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadCsv(
                        `referral-stored-credits.csv`,
                        exportReferralCreditsCsv(credits),
                      )}>Stored credits</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && !overview ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : noData ? (
        <Card><CardContent className="py-12">
          <EmptyState text="No referral analytics yet. Send referral links to completed customers to start tracking performance." />
        </CardContent></Card>
      ) : (
        <>
          <ReferralRevenueCards overview={overview} />
          <ReferralFunnelChart funnel={funnel} />
          <ReferralTimeSeriesChart rows={series} />

          {/* Top Referrers */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Top referrers</CardTitle></CardHeader>
            <CardContent className="p-0">
              {tops.length === 0 ? <EmptyState text="No referrer performance yet." /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Customer</TableHead><TableHead className="text-right">Links</TableHead>
                    <TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Rewards</TableHead><TableHead className="text-right">ROI</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {tops.slice(0, 25).map((r) => (
                      <TableRow key={r.referrerContactId} className="cursor-pointer hover:bg-accent/40"
                        onClick={() => update({ referrerContactId: r.referrerContactId })}>
                        <TableCell className="font-medium">{r.referrerName}</TableCell>
                        <TableCell className="text-right">{r.referralLinks}</TableCell>
                        <TableCell className="text-right">{r.clicks}</TableCell>
                        <TableCell className="text-right">{r.submittedLeads}</TableCell>
                        <TableCell className="text-right">{r.soldReferrals}</TableCell>
                        <TableCell className="text-right">{money(r.collectedRevenue)}</TableCell>
                        <TableCell className="text-right">{money(r.paidOrStoredRewards + r.pendingPayouts)}</TableCell>
                        <TableCell className="text-right">{r.roi == null ? "—" : `${(r.roi * 100).toFixed(0)}%`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Source & Geo & Service - three breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Source / UTM breakdown</CardTitle></CardHeader>
              <CardContent className="p-0">
                {sources.length === 0 ? (
                  <EmptyState text="No source data yet. Add UTM parameters to referral campaigns to improve attribution." />
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Source</TableHead><TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Revenue</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {sources.slice(0, 20).map((s, i) => (
                        <TableRow key={i} className="cursor-pointer hover:bg-accent/40"
                          onClick={() => update({ utmSource: s.source, utmCampaign: s.campaign || undefined })}>
                          <TableCell>{s.source}</TableCell>
                          <TableCell className="text-muted-foreground">{s.campaign || "—"}</TableCell>
                          <TableCell className="text-right">{s.clicks}</TableCell>
                          <TableCell className="text-right">{s.submittedLeads}</TableCell>
                          <TableCell className="text-right">{s.soldReferrals}</TableCell>
                          <TableCell className="text-right">{money(s.collectedRevenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Geo (city / ZIP)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {geo.length === 0 ? <EmptyState text="No geographic referral data yet." /> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>City</TableHead><TableHead>ZIP</TableHead>
                      <TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {geo.slice(0, 20).map((g, i) => (
                        <TableRow key={i} className="cursor-pointer hover:bg-accent/40"
                          onClick={() => update({ zip: g.zip || undefined, city: g.city || undefined })}>
                          <TableCell>{g.city || "—"} {g.state && <span className="text-muted-foreground">{g.state}</span>}</TableCell>
                          <TableCell>{g.zip || "—"}</TableCell>
                          <TableCell className="text-right">{g.submittedLeads}</TableCell>
                          <TableCell className="text-right">{g.soldReferrals}</TableCell>
                          <TableCell className="text-right">{money(g.collectedRevenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Service breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              {services.length === 0 ? <EmptyState text="No service data yet." /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Service</TableHead><TableHead>Project type</TableHead>
                    <TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Conv.</TableHead><TableHead className="text-right">Revenue</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {services.slice(0, 20).map((s, i) => (
                      <TableRow key={i}>
                        <TableCell>{s.serviceNeeded}</TableCell>
                        <TableCell className="text-muted-foreground">{s.projectType || "—"}</TableCell>
                        <TableCell className="text-right">{s.submittedLeads}</TableCell>
                        <TableCell className="text-right">{s.soldReferrals}</TableCell>
                        <TableCell className="text-right">{pct(s.conversionRate)}</TableCell>
                        <TableCell className="text-right">{money(s.collectedRevenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Payout accounting */}
          {canExportFinancial && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Payout accounting</CardTitle></CardHeader>
              <CardContent className="p-0">
                {!accounting || accounting.rows.length === 0 ? (
                  <EmptyState text="No referral payouts yet." />
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Pending</TableHead><TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Stored credit</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {accounting.byMonth.map((m: any) => (
                        <TableRow key={m.month}>
                          <TableCell>{m.month}</TableCell>
                          <TableCell className="text-right">{money(m.pending)}</TableCell>
                          <TableCell className="text-right">{money(m.approved)}</TableCell>
                          <TableCell className="text-right">{money(m.paid)}</TableCell>
                          <TableCell className="text-right">{money(m.stored)}</TableCell>
                          <TableCell className="text-right">{money(m.rejected)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stored credit liability */}
          {canExportFinancial && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Stored credit liability</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Stored referral credit represents future discount liability and should be reviewed during accounting close.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {credits.length === 0 ? <EmptyState text="No stored credit liability yet." /> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Referrer</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Used</TableHead>
                      <TableHead className="text-right">Expired</TableHead>
                      <TableHead>Last activity</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {credits.slice(0, 25).map((c) => (
                        <TableRow key={c.referrerContactId}>
                          <TableCell>{c.referrerName}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(c.currentBalance)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.totalEarned)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.totalUsed)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.totalExpired)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
