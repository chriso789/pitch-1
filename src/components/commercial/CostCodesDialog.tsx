import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const db = supabase as any;

export function CostCodesDialog({ open, onOpenChange, tenantId, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string | null; onChange?: () => void }) {
  const [codes, setCodes] = useState<any[]>([]);
  const [n, setN] = useState({ code: "", name: "", parent_id: "" });
  const load = async () => {
    if (!tenantId) return;
    const { data } = await db.from("commercial_cost_codes").select("*").eq("tenant_id", tenantId).order("code");
    setCodes(data || []);
  };
  useEffect(() => { if (open) load(); }, [open, tenantId]);

  const seed = async () => { const { error } = await db.rpc("commercial_seed_cost_codes"); if (error) return toast.error(error.message); load(); onChange?.(); };
  const add = async () => {
    if (!n.code.trim() || !n.name.trim()) return toast.error("Code and name are required");
    const parent = codes.find((c) => c.id === n.parent_id);
    const { error } = await db.from("commercial_cost_codes").insert({ tenant_id: tenantId, code: n.code.trim(), name: n.name.trim(), parent_id: n.parent_id || null, division: parent?.division || n.code.trim().slice(0, 2) });
    if (error) return toast.error(error.message);
    setN({ code: "", name: "", parent_id: "" }); load(); onChange?.();
  };
  const toggle = async (c: any) => { await db.from("commercial_cost_codes").update({ active: !c.active }).eq("id", c.id); load(); onChange?.(); };
  const rename = async (c: any, name: string) => { if (name && name !== c.name) { await db.from("commercial_cost_codes").update({ name }).eq("id", c.id); onChange?.(); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Cost codes</DialogTitle></DialogHeader>
        {!codes.length && <Button variant="secondary" onClick={seed}>Add starter CSI roofing codes</Button>}
        <div className="flex gap-2">
          <Input placeholder="07 54 23" className="w-32" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} />
          <Input placeholder="Name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
          <Select value={n.parent_id || "none"} onValueChange={(v) => setN({ ...n, parent_id: v === "none" ? "" : v })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Parent" /></SelectTrigger>
            <SelectContent><SelectItem value="none">No parent</SelectItem>{codes.filter((c) => !c.parent_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} {c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={add}>Add</Button>
        </div>
        <div className="max-h-[50vh] overflow-auto border rounded">
          <table className="w-full text-sm"><tbody>
            {codes.map((c) => (
              <tr key={c.id} className={`border-t ${c.active ? "" : "opacity-50"}`}>
                <td className={`p-2 font-mono w-28 ${c.parent_id ? "pl-6" : "font-semibold"}`}>{c.code}</td>
                <td className="p-2"><Input className="h-8" defaultValue={c.name} onBlur={(e) => rename(c, e.target.value)} /></td>
                <td className="p-2 w-28 text-right"><Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? "Turn off" : "Turn on"}</Button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <p className="text-xs text-muted-foreground">Codes are turned off instead of deleted so past estimates and budgets keep their history.</p>
      </DialogContent>
    </Dialog>
  );
}
