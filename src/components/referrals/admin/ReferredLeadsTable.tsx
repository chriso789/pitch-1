import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useReferralSubmissions } from "@/hooks/referrals/useReferralDashboard";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { MoreHorizontal } from "lucide-react";

const STATUSES = ["new", "contacted", "appointment_set", "estimate_sent", "sold", "completed", "rejected", "duplicate", "invalid"];

interface Props { canManage: boolean; }

export function ReferredLeadsTable({ canManage }: Props) {
  const { data: subs = [], isLoading } = useReferralSubmissions();
  const { updateStatus, rejectSubmission, markValid, approvePayout } = useReferralActions();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return subs.filter((s: any) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (search) {
        const t = `${s.referred_first_name} ${s.referred_last_name} ${s.referred_email} ${s.referred_phone}`.toLowerCase();
        if (!t.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [subs, statusFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Search referred lead…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">No referred leads yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sold</TableHead>
                  <TableHead>Eligible</TableHead>
                  <TableHead>Created</TableHead>
                  {canManage && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.referred_first_name} {s.referred_last_name}</TableCell>
                    <TableCell className="text-xs">
                      <div>{s.referred_phone}</div>
                      <div className="text-muted-foreground">{s.referred_email}</div>
                    </TableCell>
                    <TableCell className="text-xs">{s.service_needed || "—"}</TableCell>
                    <TableCell>{s.referrer ? `${s.referrer.first_name ?? ""} ${s.referrer.last_name ?? ""}`.trim() : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                    <TableCell>{s.sold_value ? formatCurrency(s.sold_value) : "—"}</TableCell>
                    <TableCell>{s.payout_eligible ? <Badge>Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                    <TableCell className="text-xs">{format(new Date(s.created_at), "MMM d")}</TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {STATUSES.filter((st) => st !== s.status).map((st) => (
                              <DropdownMenuItem key={st} onClick={() => updateStatus.mutate({ submissionId: s.id, status: st })}>
                                Mark {st.replace(/_/g, " ")}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => markValid.mutate({ submissionId: s.id })}>
                              Override: payout eligible
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => approvePayout.mutate({ referral_submission_id: s.id })}>
                              Approve payout
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                const reason = window.prompt("Rejection reason?") || "";
                                if (reason) rejectSubmission.mutate({ submissionId: s.id, reason });
                              }}
                            >
                              Reject referral
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
