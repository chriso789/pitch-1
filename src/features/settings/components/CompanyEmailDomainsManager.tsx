import React, { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Globe, Plus, Trash2, ShieldCheck } from "lucide-react";

interface DomainRow {
  id: string;
  tenant_id: string;
  domain: string;
  default_access_level: string;
  notes: string | null;
  created_at: string;
}

interface Props {
  tenantId: string;
}

const ACCESS_LEVELS = [
  { value: "viewer", label: "Viewer" },
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

export const CompanyEmailDomainsManager: React.FC<Props> = ({ tenantId }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [newLevel, setNewLevel] = useState("member");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("company_email_domains")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (!error && data) setRows(data as DomainRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId]);

  const addDomain = async () => {
    const cleaned = newDomain.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "");
    if (!cleaned || !cleaned.includes(".")) {
      toast({ title: "Invalid domain", description: "Enter a domain like coxroof.com", variant: "destructive" });
      return;
    }
    setAdding(true);
    const { error } = await (supabase as any).from("company_email_domains").insert([{
      tenant_id: tenantId,
      domain: cleaned,
      default_access_level: newLevel,
    }]);
    setAdding(false);
    if (error) {
      toast({ title: "Could not add domain", description: error.message, variant: "destructive" });
      return;
    }
    setNewDomain("");
    toast({ title: "Domain added", description: `Future Google sign-ups from @${cleaned} will join this company automatically.` });
    load();
  };

  const removeDomain = async (id: string) => {
    const { error } = await (supabase as any).from("company_email_domains").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Domain removed" });
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Allowed Email Domains
        </CardTitle>
        <CardDescription>
          Anyone signing up with Google using an email at one of these domains will be auto-added to this company.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <Label htmlFor="new-domain">Domain</Label>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-muted-foreground text-sm">@</span>
              <Input
                id="new-domain"
                placeholder="coxroof.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDomain()}
              />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <Label>Default role</Label>
            <Select value={newLevel} onValueChange={setNewLevel}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addDomain} disabled={adding || !newDomain.trim()}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>

        <div className="border rounded-md divide-y">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              No domains yet. Add your company's email domain to enable automatic Google sign-up.
            </p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-sm truncate">@{r.domain}</span>
                  <Badge variant="outline" className="text-xs capitalize">{r.default_access_level}</Badge>
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeDomain(r.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};
