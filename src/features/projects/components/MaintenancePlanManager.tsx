import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, CalendarCheck, Wrench } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { MaintenancePlanCard } from './MaintenancePlanCard';

interface MaintenancePlanManagerProps {
  projectId: string;
  contactId?: string;
  tenantId: string;
}

export const MaintenancePlanManager = ({ projectId, contactId, tenantId }: MaintenancePlanManagerProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    plan_type: 'roof_inspection',
    frequency: 'annual',
    price: '',
    notes: '',
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ['maintenance-plans', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_plans')
        .select('*, maintenance_visits(*)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createPlan = useMutation({
    mutationFn: async () => {
      const nextDate = new Date();
      if (form.frequency === 'annual') nextDate.setFullYear(nextDate.getFullYear() + 1);
      else if (form.frequency === 'semi_annual') nextDate.setMonth(nextDate.getMonth() + 6);
      else nextDate.setMonth(nextDate.getMonth() + 3);

      const { error } = await supabase.from('maintenance_plans').insert({
        tenant_id: tenantId,
        project_id: projectId,
        contact_id: contactId || null,
        plan_type: form.plan_type,
        frequency: form.frequency,
        price: parseFloat(form.price) || 0,
        notes: form.notes || null,
        next_service_date: nextDate.toISOString().split('T')[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-plans', projectId] });
      setOpen(false);
      setForm({ plan_type: 'roof_inspection', frequency: 'annual', price: '', notes: '' });
      toast({ title: 'Plan Created', description: 'Maintenance plan added successfully.' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to create plan', variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Maintenance Plans
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" /> Add Plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Maintenance Plan</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Plan Type</Label>
                <Select value={form.plan_type} onValueChange={v => setForm(p => ({ ...p, plan_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roof_inspection">Roof Inspection</SelectItem>
                    <SelectItem value="gutter_cleaning">Gutter Cleaning</SelectItem>
                    <SelectItem value="full_maintenance">Full Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Price ($)</Label>
                <Input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="299.00" />
              </div>
              <Button onClick={() => createPlan.mutate()} disabled={createPlan.isPending} className="w-full">
                {createPlan.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Plan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!isLoading && (!plans || plans.length === 0) && (
          <p className="text-sm text-muted-foreground">No maintenance plans yet. Add one to offer recurring service.</p>
        )}
        {plans && plans.length > 0 && (
          <div className="space-y-3">
            {plans.map((plan: any) => (
              <MaintenancePlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
