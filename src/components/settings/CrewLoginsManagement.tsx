import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HardHat, Plus, Copy, Ban, CheckCircle, Mail, Send } from 'lucide-react';

type CrewRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  user_id: string | null;
  created_at: string;
};

export const CrewLoginsManagement = () => {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  const portalUrl = `${window.location.origin}/crew`;

  const { data: crews = [], isLoading } = useQuery({
    queryKey: ['crew-logins', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crews')
        .select('id, name, email, phone, is_active, user_id, created_at')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CrewRow[];
    },
    enabled: !!tenantId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('No tenant');
      if (!form.name.trim()) throw new Error('Name is required');
      if (!form.email.trim()) throw new Error('Email is required');

      const { error } = await supabase.from('crews').insert({
        tenant_id: tenantId,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crew-logins'] });
      qc.invalidateQueries({ queryKey: ['crews-for-orders'] });
      setOpen(false);
      setForm({ name: '', email: '', phone: '' });
      toast({
        title: 'Crew added',
        description: `Send them the Crew Portal link to sign in: ${portalUrl}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('crews').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crew-logins'] }),
  });

  const sendLinkMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: portalUrl, shouldCreateUser: true },
      });
      if (error) throw error;
    },
    onSuccess: (_data, email) =>
      toast({ title: 'Activation link sent', description: `Magic sign-in link emailed to ${email}.` }),
    onError: (e: Error) =>
      toast({ title: 'Failed to send link', description: e.message, variant: 'destructive' }),
  });

  const copyPortalLink = () => {
    navigator.clipboard.writeText(portalUrl);
    toast({ title: 'Portal link copied', description: portalUrl });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-primary" />
            Crew Logins
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyPortalLink}>
              <Copy className="h-4 w-4 mr-1" /> Copy Portal Link
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Add Crew
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Crew Login</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Crew Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Juan's Crew, Team Alpha"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="crew@example.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      The crew signs in to the Crew Portal with this email using a magic link.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone (optional)</Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    After saving, share this URL with the crew:
                    <div className="mt-1 font-mono break-all text-foreground">{portalUrl}</div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Saving…' : 'Save Crew'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : crews.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <HardHat className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No crew logins yet. Add a crew so they can access the Crew Portal.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crew</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Login Status</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crews.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        {c.email || <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{c.phone || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {c.user_id ? (
                        <Badge variant="default" className="bg-green-500/10 text-green-700 border-green-500/20">
                          Signed in
                        </Badge>
                      ) : (
                        <Badge variant="outline">Pending first sign-in</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? 'default' : 'secondary'}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {c.email && !c.user_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sendLinkMutation.isPending}
                            onClick={() => sendLinkMutation.mutate(c.email!)}
                          >
                            <Send className="h-4 w-4 mr-1" />
                            {sendLinkMutation.isPending ? 'Sending…' : 'Send Link'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleMutation.mutate({ id: c.id, is_active: !c.is_active })}
                        >
                          {c.is_active ? (
                            <><Ban className="h-4 w-4 mr-1" /> Deactivate</>
                          ) : (
                            <><CheckCircle className="h-4 w-4 mr-1" /> Activate</>
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CrewLoginsManagement;
