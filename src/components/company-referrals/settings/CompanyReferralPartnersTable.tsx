import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCompanyReferralPartners } from "@/hooks/companyReferrals/useCompanyReferralPartners";
import { exportCompanyReferralPartners } from "@/lib/companyReferrals/companyReferralExports";

export function CompanyReferralPartnersTable({ tenantId }: { tenantId: string }) {
  const { data: partners = [], isLoading } = useCompanyReferralPartners(tenantId);
  const base = typeof window !== "undefined" ? window.location.origin : "https://pitch-crm.ai";

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading partners…</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => exportCompanyReferralPartners(partners)}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead><TableHead>Type</TableHead><TableHead>Code</TableHead>
            <TableHead>Signup URL</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partners.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No partners yet.</TableCell></TableRow>
          )}
          {partners.map((p: any) => {
            const url = `${base}/signup-ref/${p.partner_code}`;
            return (
              <TableRow key={p.id}>
                <TableCell>{p.partner_name}<div className="text-xs text-muted-foreground">{p.partner_email}</div></TableCell>
                <TableCell>{p.partner_type}</TableCell>
                <TableCell><code className="text-xs">{p.partner_code}</code></TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost"
                    onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}>
                    Copy URL
                  </Button>
                </TableCell>
                <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
export default CompanyReferralPartnersTable;
