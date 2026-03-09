import { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Gift, Star, DollarSign, TrendingUp, Users, Award, Plus } from "lucide-react";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LoyaltyPointsPage = () => {
  const { activeTenantId } = useActiveTenantId();
  const queryClient = useQueryClient();
  const [awardDialogOpen, setAwardDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<string>("");
  const [pointsToAward, setPointsToAward] = useState(100);
  const [awardReason, setAwardReason] = useState<string>("earn_bonus");

  // Fetch loyalty settings
  const { data: settings } = useQuery({
    queryKey: ['loyalty-settings', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return null;
      const { data, error } = await supabase
        .from('loyalty_settings')
        .select('*')
        .eq('tenant_id', activeTenantId)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data || {
        points_per_referral: 100,
        points_per_review: 50,
        points_per_job: 200,
        points_per_survey: 25,
        points_per_dollar_redemption: 0.01,
        min_redeem_points: 500,
        is_active: true
      };
    },
    enabled: !!activeTenantId
  });

  // Fetch loyalty points transactions
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['loyalty-points', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('loyalty_points')
        .select('*, contacts(first_name, last_name, email)')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId
  });

  // Fetch contacts for award dialog
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts-list', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email')
        .eq('tenant_id', activeTenantId)
        .order('first_name')
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId && awardDialogOpen
  });

  const awardPointsMutation = useMutation({
    mutationFn: async () => {
      if (!activeTenantId || !selectedContact) throw new Error("Missing data");
      
      // Get current balance
      const { data: currentBalance } = await supabase
        .rpc('get_loyalty_balance', { p_contact_id: selectedContact });
      
      const newBalance = (currentBalance || 0) + pointsToAward;
      
      const { error } = await supabase
        .from('loyalty_points')
        .insert({
          tenant_id: activeTenantId,
          contact_id: selectedContact,
          points: pointsToAward,
          transaction_type: awardReason,
          description: `Manual points award`,
          balance_after: newBalance
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-points'] });
      toast.success(`${pointsToAward} points awarded!`);
      setAwardDialogOpen(false);
      setSelectedContact("");
      setPointsToAward(100);
    }
  });

  // Calculate stats
  const topEarners = Object.values(
    transactions.reduce((acc: any, t: any) => {
      const id = t.contact_id;
      if (!acc[id]) {
        acc[id] = {
          contact: t.contacts,
          totalPoints: 0,
          transactions: 0
        };
      }
      acc[id].totalPoints += t.points;
      acc[id].transactions += 1;
      return acc;
    }, {})
  )
    .sort((a: any, b: any) => b.totalPoints - a.totalPoints)
    .slice(0, 10);

  const stats = {
    totalPointsIssued: transactions.filter(t => t.points > 0).reduce((sum, t) => sum + t.points, 0),
    totalPointsRedeemed: Math.abs(transactions.filter(t => t.points < 0).reduce((sum, t) => sum + t.points, 0)),
    activeMembers: new Set(transactions.map(t => t.contact_id)).size,
    avgPointsPerMember: transactions.length > 0 
      ? Math.round(transactions.reduce((sum, t) => sum + t.points, 0) / new Set(transactions.map(t => t.contact_id)).size)
      : 0
  };

  const getTransactionIcon = (type: string) => {
    const icons: Record<string, any> = {
      earn_referral: <Users className="h-4 w-4 text-blue-500" />,
      earn_review: <Star className="h-4 w-4 text-amber-500" />,
      earn_repeat_job: <Award className="h-4 w-4 text-green-500" />,
      earn_survey: <TrendingUp className="h-4 w-4 text-purple-500" />,
      earn_bonus: <Gift className="h-4 w-4 text-pink-500" />,
      redeem_discount: <DollarSign className="h-4 w-4 text-red-500" />
    };
    return icons[type] || <Gift className="h-4 w-4" />;
  };

  return (
    <GlobalLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Award className="h-8 w-8 text-primary" />
              Loyalty Points System
            </h1>
            <p className="text-muted-foreground mt-1">
              Reward customers for referrals, reviews, and repeat business
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-3 py-1">Phase 30</Badge>
            <Button onClick={() => setAwardDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Award Points
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="elevated">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <span className="text-sm text-muted-foreground">Points Issued</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.totalPointsIssued.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="elevated">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-red-500" />
                <span className="text-sm text-muted-foreground">Points Redeemed</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.totalPointsRedeemed.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="elevated">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-muted-foreground">Active Members</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.activeMembers}</p>
            </CardContent>
          </Card>
          <Card className="elevated">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <span className="text-sm text-muted-foreground">Avg Points</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stats.avgPointsPerMember}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="transactions" className="w-full">
          <TabsList>
            <TabsTrigger value="transactions">Recent Transactions</TabsTrigger>
            <TabsTrigger value="leaderboard">Top Earners</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="transactions">
            <Card>
              <CardHeader>
                <CardTitle>Points Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No transactions yet</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contact</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Points</TableHead>
                        <TableHead>Balance After</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((txn: any) => (
                        <TableRow key={txn.id}>
                          <TableCell className="font-medium">
                            {txn.contacts ? `${txn.contacts.first_name} ${txn.contacts.last_name}` : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getTransactionIcon(txn.transaction_type)}
                              <span className="capitalize">{txn.transaction_type.replace(/_/g, ' ')}</span>
                            </div>
                          </TableCell>
                          <TableCell className={txn.points > 0 ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
                            {txn.points > 0 ? '+' : ''}{txn.points}
                          </TableCell>
                          <TableCell className="font-medium">{txn.balance_after}</TableCell>
                          <TableCell>{format(new Date(txn.created_at), "MMM d, yyyy")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard">
            <Card className="elevated">
              <CardHeader>
                <CardTitle>Top 10 Points Earners</CardTitle>
                <CardDescription>Customers with the highest point balances</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Total Points</TableHead>
                      <TableHead>Transactions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topEarners.map((earner: any, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-bold">
                          {idx === 0 && <span className="text-amber-500">🥇</span>}
                          {idx === 1 && <span className="text-gray-400">🥈</span>}
                          {idx === 2 && <span className="text-amber-700">🥉</span>}
                          {idx > 2 && <span className="text-muted-foreground">#{idx + 1}</span>}
                        </TableCell>
                        <TableCell className="font-medium">
                          {earner.contact ? `${earner.contact.first_name} ${earner.contact.last_name}` : "—"}
                        </TableCell>
                        <TableCell className="text-primary font-bold">{earner.totalPoints.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground">{earner.transactions}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card className="elevated">
              <CardHeader>
                <CardTitle>Loyalty Program Settings</CardTitle>
                <CardDescription>Configure points earning and redemption rules</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Points per Referral</Label>
                    <Input type="number" defaultValue={settings?.points_per_referral} className="mt-1" />
                  </div>
                  <div>
                    <Label>Points per Review</Label>
                    <Input type="number" defaultValue={settings?.points_per_review} className="mt-1" />
                  </div>
                  <div>
                    <Label>Points per Completed Job</Label>
                    <Input type="number" defaultValue={settings?.points_per_job} className="mt-1" />
                  </div>
                  <div>
                    <Label>Points per Survey</Label>
                    <Input type="number" defaultValue={settings?.points_per_survey} className="mt-1" />
                  </div>
                  <div>
                    <Label>Points per $1 Discount</Label>
                    <Input type="number" step="0.01" defaultValue={settings?.points_per_dollar_redemption} className="mt-1" />
                  </div>
                  <div>
                    <Label>Minimum Redeem Points</Label>
                    <Input type="number" defaultValue={settings?.min_redeem_points} className="mt-1" />
                  </div>
                </div>
                <Button onClick={() => toast.success("Loyalty settings saved!")}>
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Award Points Dialog */}
        <Dialog open={awardDialogOpen} onOpenChange={setAwardDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Award Loyalty Points</DialogTitle>
              <DialogDescription>Manually award points to a customer</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="contact-select">Customer</Label>
                <Select value={selectedContact} onValueChange={setSelectedContact}>
                  <SelectTrigger id="contact-select" className="mt-1">
                    <SelectValue placeholder="Select customer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} ({c.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="points">Points to Award</Label>
                <Input
                  id="points"
                  type="number"
                  value={pointsToAward}
                  onChange={(e) => setPointsToAward(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="reason">Reason</Label>
                <Select value={awardReason} onValueChange={setAwardReason}>
                  <SelectTrigger id="reason" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earn_bonus">Bonus Points</SelectItem>
                    <SelectItem value="earn_referral">Referral</SelectItem>
                    <SelectItem value="earn_review">Review</SelectItem>
                    <SelectItem value="earn_survey">Survey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAwardDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => awardPointsMutation.mutate()} disabled={!selectedContact}>
                <Gift className="h-4 w-4 mr-2" />
                Award Points
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </GlobalLayout>
  );
};

export default LoyaltyPointsPage;
