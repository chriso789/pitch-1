import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCompanyReferralFlags } from "@/hooks/companyReferrals/useCompanyReferralPartners";

export function CompanyReferralFlagsTable({ tenantId }: { tenantId: string }) {
  const { data: flags = [], isLoading } = useCompanyReferralFlags(tenantId);
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading flags…</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Description</TableHead>
          <TableHead>Resolved</TableHead><TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flags.length === 0 && (
          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No flags. Clean.</TableCell></TableRow>
        )}
        {flags.map((f: any) => (
          <TableRow key={f.id}>
            <TableCell>{f.flag_type}</TableCell>
            <TableCell><Badge variant={f.severity === "high" || f.severity === "critical" ? "destructive" : "secondary"}>{f.severity}</Badge></TableCell>
            <TableCell className="text-sm text-muted-foreground">{f.description}</TableCell>
            <TableCell>{f.resolved ? "✓" : "—"}</TableCell>
            <TableCell className="text-xs">{new Date(f.created_at).toLocaleDateString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export default CompanyReferralFlagsTable;
