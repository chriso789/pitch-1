import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  contactId: string;
  tenantId: string;
  value: string | null | undefined;
  onChange: (newValue: string) => void;
}

const ADD_NEW = "__add_new__";

export function LeadSourceSelector({ contactId, tenantId, value, onChange }: Props) {
  const { toast } = useToast();
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSources = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_sources")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name");
    setLoading(false);
    if (error) {
      console.error("LeadSourceSelector fetch error", error);
      return;
    }
    setSources(data || []);
  };

  useEffect(() => { fetchSources(); }, [tenantId]);

  // If the contact has a lead_source value that isn't in the list, show it anyway
  const options = [...sources];
  if (value && !options.find(o => o.name === value)) {
    options.unshift({ id: `existing-${value}`, name: value });
  }

  const handleChange = async (v: string) => {
    if (v === ADD_NEW) {
      setAddOpen(true);
      return;
    }
    const { error } = await supabase
      .from("contacts")
      .update({ lead_source: v })
      .eq("id", contactId);
    if (error) {
      toast({ title: "Error", description: "Failed to update lead source", variant: "destructive" });
      return;
    }
    onChange(v);
    toast({ title: "Lead Source Updated", description: `Set to ${v}` });
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    // Insert into lead_sources
    const { data, error } = await supabase
      .from("lead_sources")
      .insert({ tenant_id: tenantId, name, is_active: true })
      .select("id, name")
      .single();
    if (error || !data) {
      setSaving(false);
      toast({ title: "Error", description: error?.message || "Failed to add lead source", variant: "destructive" });
      return;
    }
    // Set on contact
    const { error: upErr } = await supabase
      .from("contacts")
      .update({ lead_source: data.name })
      .eq("id", contactId);
    setSaving(false);
    if (upErr) {
      toast({ title: "Saved source, but failed to assign", description: upErr.message, variant: "destructive" });
    } else {
      onChange(data.name);
      toast({ title: "Lead Source Added", description: `${data.name} set on contact` });
    }
    setSources(prev => [...prev, { id: data.id, name: data.name }].sort((a,b)=>a.name.localeCompare(b.name)));
    setNewName("");
    setAddOpen(false);
  };

  return (
    <>
      <Select value={value || ""} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-auto min-w-[160px] text-sm border-input bg-background cursor-pointer">
          <Sparkles className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
          <SelectValue placeholder={loading ? "Loading…" : "Lead source"} />
        </SelectTrigger>
        <SelectContent className="bg-popover border z-[200]">
          {options.map(s => (
            <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
          ))}
          <SelectItem value={ADD_NEW}>
            <span className="flex items-center gap-2 text-primary">
              <Plus className="h-3.5 w-3.5" /> Add new source…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Lead Source</DialogTitle>
            <DialogDescription>
              Create a new lead source for this tenant. It will be available everywhere lead sources appear.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="e.g. Door Knock, Yard Sign, Storm Canvass"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !newName.trim()}>
              {saving ? "Saving…" : "Add & Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LeadSourceSelector;
