import { useState, useMemo } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Gift, Hash, ArrowRightLeft, DollarSign, Plus, Check, ToggleLeft, ToggleRight } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

const ReferralDashboard = () => {
  const { activeTenantId } = useActiveTenantId();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState({ code: "", reward_type: "cash", reward_value: 50, max_uses: 10 });

  // Fetch referral codes
  const { data: codes = [] } = useQuery({
    queryKey: ["referral-codes", activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from("referral_codes")
        .select("*, contacts:customer_id(first_name, last_name)")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Fetch conversions
  const { data: conversions = [] } = useQuery({
    queryKey: ["referral-conversions", activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from("referral_conversions")
        .select("*, referral_codes(code), referrer:referrer_contact_id(first_name, last_name), referred:referred_contact_id(first_name, last_name)")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Fetch rewards
  const { data: rewards = [] } = useQuery({
    queryKey: ["referral-rewards", activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from("referral_rewards")
        .select("*, recipient:recipient_contact_id(first_name, last_name)")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Create code mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeTenantId) throw new Error("No tenant");
      const { error } = await supabase.from("referral_codes").insert({
        code: newCode.code.toUpperCase(),
        reward_type: newCode.reward_type,
        reward_value: newCode.reward_value,
        max_uses: newCode.max_uses,
        tenant_id: activeTenantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      setCreateOpen(false);
      setNewCode({ code: "", reward_type: "cash", reward_value: 50, max_uses: 10 });
      toast.success("Referral code created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Toggle active mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("referral_codes").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["referral-codes"] }),
  });

  // Mark reward paid
  const payMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("referral_rewards").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-rewards"] });
      toast.success("Reward marked as paid");
    },
  });

  // Stats
  const stats = useMemo(() => {
    const totalRewardsPaid = rewards.filter((r: any) => r.status === "paid").reduce((s: number, r: any) => s + (r.reward_value || 0), 0);
    const conversionRate = codes.length > 0
      ? Math.round((conversions.length / codes.reduce((s: number, c: any) => s + (c.current_uses || 0) + 1, 0)) * 100)
      : 0;
    return { codes: codes.length, conversions: conversions.length, totalRewardsPaid, conversionRate };
  }, [codes, conversions, rewards]);

  const contactName = (c: any) => c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "—" : "—";

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Referral Management</h1>
            <p className="text-muted-foreground">Codes, conversions & reward payouts</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Code
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2"><Hash className="h-5 w-5 text-primary" /><span className="text-sm text-muted-foreground">Codes</span></div><p className="text-3xl font-bold mt-1">{stats.codes}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-primary" /><span className="text-sm text-muted-foreground">Conversions</span></div><p className="text-3xl font-bold mt-1">{stats.conversions}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-green-500" /><span className="text-sm text-muted-foreground">Rewards Paid</span></div><p className="text-3xl font-bold mt-1">{formatCurrency(stats.totalRewardsPaid)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" /><span className="text-sm text-muted-foreground">Conv. Rate</span></div><p className="text-3xl font-bold mt-1">{stats.conversionRate}%</p></CardContent></Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="codes">
          <TabsList>
            <TabsTrigger value="codes">Referral Codes</TabsTrigger>
            <TabsTrigger value="conversions">Conversions</TabsTrigger>
            <TabsTrigger value="rewards">Rewards</TabsTrigger>
          </TabsList>

          <TabsContent value="codes">
            <Card>
              <CardContent className="pt-6">
                {codes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No referral codes yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Reward</TableHead>
                          <TableHead>Uses</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {codes.map((code: any) => (
                          <TableRow key={code.id}>
                            <TableCell className="font-mono font-bold">{code.code}</TableCell>
                            <TableCell>{contactName(code.contacts)}</TableCell>
                            <TableCell className="capitalize">{code.reward_type} — {formatCurrency(code.reward_value)}</TableCell>
                            <TableCell>{code.current_uses || 0} / {code.max_uses || "∞"}</TableCell>
                            <TableCell>
                              <Badge variant={code.is_active ? "default" : "secondary"}>{code.is_active ? "Active" : "Inactive"}</Badge>
                            </TableCell>
                            <TableCell>{code.expires_at ? format(new Date(code.expires_at), "MMM d, yyyy") : "—"}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => toggleMutation.mutate({ id: code.id, is_active: !code.is_active })}>
                                {code.is_active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="conversions">
            <Card>
              <CardContent className="pt-6">
                {conversions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No conversions recorded yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Referrer</TableHead>
                          <TableHead>Referred</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {conversions.map((c: any) => (
                          <TableRow key={c.id}>
                            <TableCell>{contactName(c.referrer)}</TableCell>
                            <TableCell>{contactName(c.referred)}</TableCell>
                            <TableCell className="font-mono">{c.referral_codes?.code || "—"}</TableCell>
                            <TableCell>{c.conversion_value ? formatCurrency(c.conversion_value) : "—"}</TableCell>
                            <TableCell className="capitalize">{c.conversion_type || "—"}</TableCell>
                            <TableCell>{c.converted_at ? format(new Date(c.converted_at), "MMM d, yyyy") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rewards">
            <Card>
              <CardContent className="pt-6">
                {rewards.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No rewards yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rewards.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell>{contactName(r.recipient)}</TableCell>
                            <TableCell className="capitalize">{r.reward_type}</TableCell>
                            <TableCell>{formatCurrency(r.reward_value)}</TableCell>
                            <TableCell>
                              <Badge variant={r.status === "paid" ? "default" : r.status === "pending" ? "secondary" : "destructive"}>
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="capitalize">{r.payout_method || "—"}</TableCell>
                            <TableCell>{r.paid_at ? format(new Date(r.paid_at), "MMM d, yyyy") : "—"}</TableCell>
                            <TableCell>
                              {r.status === "pending" && (
                                <Button size="sm" variant="outline" onClick={() => payMutation.mutate(r.id)}>
                                  <Check className="h-3 w-3 mr-1" /> Pay
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Code Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Referral Code</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Code</Label>
                <Input value={newCode.code} onChange={(e) => setNewCode({ ...newCode, code: e.target.value })} placeholder="e.g. SUMMER25" />
              </div>
              <div>
                <Label>Reward Type</Label>
                <Select value={newCode.reward_type} onValueChange={(v) => setNewCode({ ...newCode, reward_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="discount">Discount</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reward Value ($)</Label>
                <Input type="number" value={newCode.reward_value} onChange={(e) => setNewCode({ ...newCode, reward_value: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Max Uses</Label>
                <Input type="number" value={newCode.max_uses} onChange={(e) => setNewCode({ ...newCode, max_uses: Number(e.target.value) })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate()} disabled={!newCode.code || createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Code"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </GlobalLayout>
  );
};

export default ReferralDashboard;
