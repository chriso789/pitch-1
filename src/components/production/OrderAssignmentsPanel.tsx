import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Package, Users, Wrench, Calendar, Truck, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderAssignmentsPanelProps {
  projectId: string;
}

const ORDER_TYPE_CONFIG = {
  material: { label: 'Material', icon: Package, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  labor: { label: 'Labor', icon: Users, color: 'text-orange-600 bg-orange-50 border-orange-200' },
  turnkey: { label: 'Turnkey', icon: Wrench, color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-muted text-muted-foreground' },
  assigned: { label: 'Assigned', color: 'bg-blue-100 text-blue-700' },
  scheduled: { label: 'Scheduled', color: 'bg-yellow-100 text-yellow-700' },
  in_progress: { label: 'In Progress', color: 'bg-orange-100 text-orange-700' },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-700' },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive' },
};

export const OrderAssignmentsPanel: React.FC<OrderAssignmentsPanelProps> = ({ projectId }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    order_type: 'material' as 'material' | 'labor' | 'turnkey',
    title: '',
    description: '',
    assigned_to_vendor_id: '',
    assigned_to_crew: '',
    scheduled_date: '',
    arrival_date: '',
    notes: '',
    notify_rep: true,
  });

  // Fetch order assignments for this project
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['order-assignments', projectId, effectiveTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_order_assignments')
        .select('*')
        .eq('project_id', projectId)
        .eq('tenant_id', effectiveTenantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && !!effectiveTenantId,
  });

  // Fetch vendors/suppliers
  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', effectiveTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('tenant_id', effectiveTenantId!)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveTenantId,
  });

  // Create assignment
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveTenantId) throw new Error('No tenant');
      const { data: { user } } = await supabase.auth.getUser();

      const status = (formData.scheduled_date ? 'scheduled' : 
        (formData.assigned_to_vendor_id || formData.assigned_to_crew) ? 'assigned' : 'pending');

      await supabase.from('production_order_assignments').insert({
        tenant_id: effectiveTenantId,
        project_id: projectId,
        order_type: formData.order_type,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        assigned_to_vendor_id: formData.assigned_to_vendor_id || null,
        assigned_to_crew: formData.assigned_to_crew.trim() || null,
        assigned_by: user?.id,
        status,
        scheduled_date: formData.scheduled_date || null,
        arrival_date: formData.arrival_date || null,
        notes: formData.notes.trim() || null,
        notify_rep: formData.notify_rep,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-assignments'] });
      setAddDialogOpen(false);
      setFormData({
        order_type: 'material',
        title: '',
        description: '',
        assigned_to_vendor_id: '',
        assigned_to_crew: '',
        scheduled_date: '',
        arrival_date: '',
        notes: '',
        notify_rep: true,
      });
      toast({ title: 'Order assignment created' });
    },
  });

  // Update status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await supabase
        .from('production_order_assignments')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-assignments'] });
      toast({ title: 'Status updated' });
    },
  });

  const materialAssignments = assignments.filter(a => a.order_type === 'material');
  const laborAssignments = assignments.filter(a => a.order_type === 'labor');
  const turnkeyAssignments = assignments.filter(a => a.order_type === 'turnkey');

  const renderAssignmentCard = (assignment: any) => {
    const typeConfig = ORDER_TYPE_CONFIG[assignment.order_type as keyof typeof ORDER_TYPE_CONFIG];
    const statusConfig = STATUS_CONFIG[assignment.status] || STATUS_CONFIG.pending;
    const Icon = typeConfig.icon;
    const vendor = vendors.find(v => v.id === assignment.assigned_to_vendor_id);

    return (
      <Card key={assignment.id} className="border">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className={cn('p-2 rounded-lg border', typeConfig.color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{assignment.title}</span>
                  <Badge className={cn('text-[10px]', statusConfig.color)}>
                    {statusConfig.label}
                  </Badge>
                </div>
                {assignment.description && (
                  <p className="text-xs text-muted-foreground mt-1">{assignment.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                  {assignment.order_type === 'material' && vendor && (
                    <span className="flex items-center gap-1">
                      <Truck className="h-3 w-3" /> {vendor.name}
                    </span>
                  )}
                  {(assignment.order_type === 'labor' || assignment.order_type === 'turnkey') && assignment.assigned_to_crew && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {assignment.assigned_to_crew}
                    </span>
                  )}
                  {assignment.scheduled_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Scheduled: {new Date(assignment.scheduled_date).toLocaleDateString()}
                    </span>
                  )}
                  {assignment.arrival_date && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Arrival: {new Date(assignment.arrival_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {assignment.notes && (
                  <p className="text-xs text-muted-foreground mt-1 italic">{assignment.notes}</p>
                )}
              </div>
            </div>
            <Select
              value={assignment.status}
              onValueChange={(val) => updateStatusMutation.mutate({ id: assignment.id, status: val })}
            >
              <SelectTrigger className="w-[120px] h-7 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key} className="text-xs">{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSection = (title: string, icon: React.ElementType, items: any[], type: string) => {
    const Icon = icon;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
            <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
          </h3>
        </div>
        {items.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-4 text-center text-muted-foreground text-sm">
              No {title.toLowerCase()} orders assigned yet
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map(renderAssignmentCard)}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading orders...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Assign materials to suppliers, labor and turnkey work to crews. Set scheduled dates to auto-alert reps.
        </p>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Order Assignment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Order Type</label>
                <Select
                  value={formData.order_type}
                  onValueChange={(val: any) => setFormData(prev => ({ ...prev, order_type: val }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="material">Material Order</SelectItem>
                    <SelectItem value="labor">Labor Order</SelectItem>
                    <SelectItem value="turnkey">Turnkey Order</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Shingle delivery, Crew installation"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Details about the order..."
                  rows={2}
                />
              </div>

              {formData.order_type === 'material' ? (
                <div>
                  <label className="text-sm font-medium">Assign to Supplier</label>
                  <Select
                    value={formData.assigned_to_vendor_id}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, assigned_to_vendor_id: val }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                      {vendors.length === 0 && (
                        <SelectItem value="" disabled>No suppliers configured</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">Assign to Crew</label>
                  <Input
                    value={formData.assigned_to_crew}
                    onChange={(e) => setFormData(prev => ({ ...prev, assigned_to_crew: e.target.value }))}
                    placeholder="e.g., Team Alpha, Juan's Crew"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Scheduled Date</label>
                  <Input
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Arrival Date</label>
                  <Input
                    type="date"
                    value={formData.arrival_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, arrival_date: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Special instructions..."
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.notify_rep}
                  onChange={(e) => setFormData(prev => ({ ...prev, notify_rep: e.target.checked }))}
                  className="rounded"
                />
                <label className="text-sm">Notify sales rep of arrival dates</label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!formData.title.trim()}>
                <Plus className="h-4 w-4 mr-1" /> Create Assignment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {renderSection('Material Orders', Package, materialAssignments, 'material')}
      {renderSection('Labor Orders', Users, laborAssignments, 'labor')}
      {renderSection('Turnkey Orders', Wrench, turnkeyAssignments, 'turnkey')}
    </div>
  );
};
