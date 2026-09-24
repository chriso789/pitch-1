import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Building2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { CommercialImportDialog } from "@/components/commercial/CommercialImportDialog";

const db = supabase as any;
const STATUSES = ["bidding", "submitted", "won", "lost"];

export default function CommercialProjects() {
  const tenantId = useEffectiveTenantId();
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", project_number: "", gc_name: "", client_name: "", address: "", bid_due_date: "" });

  const load = async () => {
    if (!tenantId) return;
    const { data } = await db.from("commercial_projects").select("*").eq("tenant_id", tenantId).order("bid_due_date", { ascending: true, nullsFirst: false });
    setRows(data || []);
  };
  useEffect(() => { load(); }, [tenantId]);

  const create = async () => {
    if (!form.name.trim()) return toast.error("Project name is required");
    const { error } = await db.from("commercial_projects").insert({ ...form, bid_due_date: form.bid_due_date || null, tenant_id: tenantId });
    if (error) return toast.error(error.message);
    setOpen(false); setForm({ name: "" }); load();
  };

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <GlobalLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2"><Building2 className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">Commercial</h1></div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New project</Button>
          </div>
        </div>
        <div className="flex gap-2">
          {["all", ...STATUSES].map((s) => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)} className="capitalize">
              {s} {s !== "all" && `(${rows.filter((r) => r.status === s).length})`}
            </Button>
          ))}
        </div>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr>
                <th className="p-3">Project</th><th className="p-3">GC / Client</th><th className="p-3">Bid due</th><th className="p-3">Roof SF</th><th className="p-3">Status</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-3"><Link to={`/commercial/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link><div className="text-xs text-muted-foreground">{r.project_number} {r.address}</div></td>
                    <td className="p-3">{r.gc_name || r.client_name || "—"}</td>
                    <td className="p-3">{r.bid_due_date || "—"}</td>
                    <td className="p-3">{r.roof_area_sf ? Number(r.roof_area_sf).toLocaleString() : "—"}</td>
                    <td className="p-3"><Badge variant="outline" className="capitalize">{r.status}</Badge></td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No commercial projects yet.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New commercial project</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[["name", "Project name"], ["project_number", "Project #"], ["gc_name", "General contractor"], ["client_name", "Client / owner"], ["architect_name", "Architect"], ["address", "Address"]].map(([k, l]) => (
              <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}><Label>{l}</Label><Input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
            ))}
            <div><Label>Bid due</Label><Input type="date" value={form.bid_due_date || ""} onChange={(e) => setForm({ ...form, bid_due_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <CommercialImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={load} />
    </GlobalLayout>
  );
}
