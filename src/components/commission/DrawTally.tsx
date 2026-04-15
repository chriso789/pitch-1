import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/commission-calculator';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface DrawTallyProps {
  tenantId: string;
  totalEarnedCommissions: number;
  selectedRepId?: string;
  isManager: boolean;
}

export function DrawTally({ tenantId, totalEarnedCommissions, selectedRepId, isManager }: DrawTallyProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [drawDate, setDrawDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: draws = [] } = useQuery({
    queryKey: ['commission-draws', tenantId, selectedRepId],
    queryFn: async () => {
      let query = supabase
        .from('commission_draws')
        .select('*, profiles!commission_draws_user_id_fkey(first_name, last_name)')
        .eq('tenant_id', tenantId)
        .order('draw_date', { ascending: false });

      if (selectedRepId && selectedRepId !== 'all') {
        query = query.eq('user_id', selectedRepId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const addDraw = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const targetUserId = selectedRepId && selectedRepId !== 'all' ? selectedRepId : user.id;

      const { error } = await supabase.from('commission_draws').insert({
        tenant_id: tenantId,
        user_id: targetUserId,
        amount: parseFloat(amount),
        draw_date: drawDate,
        notes: notes || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-draws'] });
      setOpen(false);
      setAmount('');
      setNotes('');
      toast({ title: 'Draw recorded', description: `$${amount} draw added successfully.` });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteDraw = useMutation({
    mutationFn: async (drawId: string) => {
      const { error } = await supabase.from('commission_draws').delete().eq('id', drawId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-draws'] });
      toast({ title: 'Draw removed' });
    },
  });

  const totalDraws = draws.reduce((sum, d) => sum + Number(d.amount), 0);
  const netOwed = totalEarnedCommissions - totalDraws;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          Draw Tally
        </CardTitle>
        {isManager && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Add Draw
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Draw / Advance</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="500.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={drawDate}
                    onChange={e => setDrawDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    placeholder="Weekly draw, advance for materials, etc."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => addDraw.mutate()}
                  disabled={!amount || parseFloat(amount) <= 0 || addDraw.isPending}
                >
                  Record Draw
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4 mb-4 p-3 rounded-lg bg-muted/50">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Total Earned</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(totalEarnedCommissions)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Total Draws</div>
            <div className="text-lg font-bold text-red-600">-{formatCurrency(totalDraws)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Net Owed</div>
            <div className={`text-lg font-bold ${netOwed >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(netOwed)}
            </div>
          </div>
        </div>

        {draws.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            No draws recorded
          </div>
        ) : (
          <div className="rounded-md border max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  {isManager && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {draws.map(draw => (
                  <TableRow key={draw.id}>
                    <TableCell className="text-sm">
                      {format(new Date(draw.draw_date), 'MM/dd/yyyy')}
                    </TableCell>
                    <TableCell className="text-sm">
                      {(draw as any).profiles
                        ? `${(draw as any).profiles.first_name} ${(draw as any).profiles.last_name}`
                        : 'Unknown'}
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      -{formatCurrency(Number(draw.amount))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                      {draw.notes || '-'}
                    </TableCell>
                    {isManager && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteDraw.mutate(draw.id)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
