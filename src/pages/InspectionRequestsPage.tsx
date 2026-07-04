import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

const SERVICE_LABEL: Record<string, string> = {
  four_point: "4-Point",
  wind_mitigation: "Wind Mit",
  combo: "4-Point + Wind Mit",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-blue-100 text-blue-800",
  completed: "bg-slate-200 text-slate-800",
  canceled: "bg-red-100 text-red-800",
  refunded: "bg-red-100 text-red-800",
};

type InspectionRequest = {
  id: string;
  service_type: string;
  status: string;
  payment_status: string;
  price_cents: number;
  amount_paid_cents: number | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  year_built: string | null;
  insurance_company: string | null;
  notes: string | null;
  payment_link: string | null;
  paid_at: string | null;
  scheduled_at: string | null;
  created_at: string;
};

export default function InspectionRequestsPage() {
  const tenantId = useEffectiveTenantId();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<InspectionRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data = [], isLoading } = useQuery({
    queryKey: ["inspection_requests", tenantId, statusFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("inspection_requests")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InspectionRequest[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (args: { id: string; status: string }) => {
      const { error } = await supabase
        .from("inspection_requests")
        .update({ status: args.status })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["inspection_requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const intakeUrl = tenantId
    ? `${window.location.origin}/request-inspection?c=${tenantId}`
    : "";

  const copyIntakeLink = () => {
    navigator.clipboard.writeText(intakeUrl);
    toast.success("Website intake link copied");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Inspection Requests</h1>
          <p className="text-muted-foreground">4-Point &amp; Wind Mitigation leads from your website</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending payment</SelectItem>
            <SelectItem value="paid">Paid — needs scheduling</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public intake link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted rounded px-3 py-2 truncate">{intakeUrl}</code>
            <Button variant="outline" size="sm" onClick={copyIntakeLink}><Copy className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" asChild>
              <a href={intakeUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Embed or link this URL on your website. For direct webhook integrations,
            POST to <code className="bg-muted px-1 rounded">/functions/v1/inspection-intake</code> with{" "}
            <code className="bg-muted px-1 rounded">{`{ tenant_id, service_type, first_name, ... }`}</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : data.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No inspection requests yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.first_name} {r.last_name}</div>
                      <div className="text-xs text-muted-foreground">{r.email} · {r.phone}</div>
                    </TableCell>
                    <TableCell>{SERVICE_LABEL[r.service_type] ?? r.service_type}</TableCell>
                    <TableCell className="text-sm">{r.address_line1}, {r.city} {r.state}</TableCell>
                    <TableCell>${(r.price_cents / 100).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] ?? ""} variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.first_name} {selected.last_name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="text-muted-foreground">Service</div><div className="font-medium">{SERVICE_LABEL[selected.service_type]}</div></div>
                  <div><div className="text-muted-foreground">Price</div><div className="font-medium">${(selected.price_cents / 100).toFixed(2)}</div></div>
                  <div><div className="text-muted-foreground">Payment</div><div className="font-medium">{selected.payment_status}{selected.paid_at ? ` · ${new Date(selected.paid_at).toLocaleString()}` : ""}</div></div>
                  <div><div className="text-muted-foreground">Status</div><div className="font-medium">{selected.status}</div></div>
                </div>
                <div><div className="text-muted-foreground">Contact</div><div>{selected.email}</div><div>{selected.phone}</div></div>
                <div><div className="text-muted-foreground">Property</div><div>{selected.address_line1}</div><div>{selected.city}, {selected.state} {selected.zip}</div></div>
                {selected.year_built && <div><span className="text-muted-foreground">Year built:</span> {selected.year_built}</div>}
                {selected.insurance_company && <div><span className="text-muted-foreground">Insurance:</span> {selected.insurance_company}</div>}
                {selected.notes && <div><div className="text-muted-foreground">Notes</div><div className="whitespace-pre-wrap">{selected.notes}</div></div>}
                {selected.payment_link && (
                  <a className="text-primary underline text-xs" href={selected.payment_link} target="_blank" rel="noreferrer">Open payment link</a>
                )}

                <div className="pt-3 border-t space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Update status</div>
                  <div className="flex flex-wrap gap-2">
                    {["paid", "scheduled", "completed", "canceled"].map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={selected.status === s ? "default" : "outline"}
                        onClick={() => updateStatus.mutate({ id: selected.id, status: s })}
                      >
                        Mark {s}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
