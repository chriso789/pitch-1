import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useReferralFlags } from "@/hooks/referrals/useReferralDashboard";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { format } from "date-fns";

interface Props { canManage: boolean; }

const sevVariant = (s: string) => s === "high" ? "destructive" : s === "medium" ? "default" : "secondary";

export function ReferralFlagsTable({ canManage }: Props) {
  const { data: flags = [], isLoading } = useReferralFlags();
  const { resolveFlag, rejectSubmission, markValid } = useReferralActions();

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : flags.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No referral issues flagged.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Referred</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Resolved</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell><Badge variant={sevVariant(f.severity) as any}>{f.severity}</Badge></TableCell>
                  <TableCell className="text-xs">{f.flag_type}</TableCell>
                  <TableCell>{f.submission ? `${f.submission.referred_first_name ?? ""} ${f.submission.referred_last_name ?? ""}`.trim() : "—"}</TableCell>
                  <TableCell className="text-xs max-w-md">{f.description}</TableCell>
                  <TableCell>{f.resolved ? <Badge variant="outline">Resolved</Badge> : <Badge variant="secondary">Open</Badge>}</TableCell>
                  <TableCell className="text-xs">{format(new Date(f.created_at), "MMM d")}</TableCell>
                  {canManage && (
                    <TableCell className="text-right space-x-1">
                      {!f.resolved && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => resolveFlag.mutate(f.id)}>Resolve</Button>
                          {f.referral_submission_id && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => markValid.mutate({ submissionId: f.referral_submission_id })}>Valid</Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const reason = window.prompt("Rejection reason?") || "flagged";
                                  rejectSubmission.mutate({ submissionId: f.referral_submission_id, reason });
                                }}
                              >Reject</Button>
                            </>
                          )}
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
