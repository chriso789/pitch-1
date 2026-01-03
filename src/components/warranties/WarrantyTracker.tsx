import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Shield, Plus, Calendar, AlertTriangle, CheckCircle, FileText, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, differenceInDays, addYears } from 'date-fns';

interface Warranty {
  id: string;
  warranty_type: 'manufacturer' | 'labor' | 'extended' | 'transferable';
  manufacturer_name?: string;
  product_name?: string;
  warranty_number?: string;
  coverage_description?: string;
  start_date: string;
  end_date: string;
  term_years?: number;
  status: 'active' | 'expired' | 'claimed' | 'transferred' | 'voided';
  project_id?: string;
  contact_id?: string;
}

interface WarrantyTrackerProps {
  projectId?: string;
  contactId?: string;
}

const WARRANTY_TYPES = {
  manufacturer: { label: 'Manufacturer', color: 'bg-blue-100 text-blue-800' },
  labor: { label: 'Labor', color: 'bg-green-100 text-green-800' },
  extended: { label: 'Extended', color: 'bg-purple-100 text-purple-800' },
  transferable: { label: 'Transferable', color: 'bg-orange-100 text-orange-800' },
};

export const WarrantyTracker: React.FC<WarrantyTrackerProps> = ({
  projectId,
  contactId
}) => {
  const { activeCompany } = useCompanySwitcher();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWarranty, setNewWarranty] = useState({
    warranty_type: 'manufacturer' as const,
    manufacturer_name: '',
    product_name: '',
    warranty_number: '',
    coverage_description: '',
    term_years: 25,
    start_date: format(new Date(), 'yyyy-MM-dd')
  });

  const { data: warranties, isLoading } = useQuery({
    queryKey: ['warranties', projectId, contactId, activeCompany?.tenant_id],
    queryFn: async () => {
      if (!activeCompany?.tenant_id) return [];

      let query = supabase
        .from('warranties')
        .select('*')
        .eq('tenant_id', activeCompany.tenant_id);

      if (projectId) query = query.eq('project_id', projectId);
      if (contactId) query = query.eq('contact_id', contactId);

      const { data, error } = await query.order('end_date', { ascending: true });
      if (error) throw error;
      return data as Warranty[];
    },
    enabled: !!activeCompany?.tenant_id
  });

  const createMutation = useMutation({
    mutationFn: async (warranty: typeof newWarranty) => {
      const endDate = addYears(new Date(warranty.start_date), warranty.term_years);
      
      const { error } = await supabase
        .from('warranties')
        .insert({
          tenant_id: activeCompany?.tenant_id,
          project_id: projectId,
          contact_id: contactId,
          warranty_type: warranty.warranty_type,
          manufacturer_name: warranty.manufacturer_name,
          product_name: warranty.product_name,
          warranty_number: warranty.warranty_number,
          coverage_description: warranty.coverage_description,
          term_years: warranty.term_years,
          start_date: warranty.start_date,
          end_date: format(endDate, 'yyyy-MM-dd'),
          status: 'active'
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warranties'] });
      setIsCreateOpen(false);
      toast.success('Warranty registered successfully');
      setNewWarranty({
        warranty_type: 'manufacturer',
        manufacturer_name: '',
        product_name: '',
        warranty_number: '',
        coverage_description: '',
        term_years: 25,
        start_date: format(new Date(), 'yyyy-MM-dd')
      });
    },
    onError: (error) => {
      console.error('Error creating warranty:', error);
      toast.error('Failed to register warranty');
    }
  });

  const getExpiryStatus = (endDate: string) => {
    const daysUntilExpiry = differenceInDays(new Date(endDate), new Date());
    
    if (daysUntilExpiry < 0) {
      return { label: 'Expired', color: 'text-destructive', urgent: true };
    } else if (daysUntilExpiry <= 30) {
      return { label: `${daysUntilExpiry} days left`, color: 'text-orange-500', urgent: true };
    } else if (daysUntilExpiry <= 90) {
      return { label: `${daysUntilExpiry} days left`, color: 'text-yellow-500', urgent: false };
    } else {
      const years = Math.floor(daysUntilExpiry / 365);
      const months = Math.floor((daysUntilExpiry % 365) / 30);
      return { 
        label: years > 0 ? `${years}y ${months}m remaining` : `${months} months remaining`, 
        color: 'text-green-500', 
        urgent: false 
      };
    }
  };

  const expiringWarranties = warranties?.filter(w => {
    const daysUntilExpiry = differenceInDays(new Date(w.end_date), new Date());
    return daysUntilExpiry <= 90 && daysUntilExpiry >= 0 && w.status === 'active';
  }) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Warranty Tracker
          </CardTitle>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Register Warranty
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Register New Warranty</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Warranty Type</Label>
                  <Select 
                    value={newWarranty.warranty_type} 
                    onValueChange={(v: any) => setNewWarranty({ ...newWarranty, warranty_type: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manufacturer">Manufacturer Warranty</SelectItem>
                      <SelectItem value="labor">Labor Warranty</SelectItem>
                      <SelectItem value="extended">Extended Warranty</SelectItem>
                      <SelectItem value="transferable">Transferable Warranty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="manufacturer">Manufacturer</Label>
                    <Input
                      id="manufacturer"
                      value={newWarranty.manufacturer_name}
                      onChange={(e) => setNewWarranty({ ...newWarranty, manufacturer_name: e.target.value })}
                      placeholder="e.g., GAF, Owens Corning"
                    />
                  </div>
                  <div>
                    <Label htmlFor="product">Product</Label>
                    <Input
                      id="product"
                      value={newWarranty.product_name}
                      onChange={(e) => setNewWarranty({ ...newWarranty, product_name: e.target.value })}
                      placeholder="e.g., Timberline HDZ"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="warranty_number">Warranty Number</Label>
                    <Input
                      id="warranty_number"
                      value={newWarranty.warranty_number}
                      onChange={(e) => setNewWarranty({ ...newWarranty, warranty_number: e.target.value })}
                      placeholder="Certificate #"
                    />
                  </div>
                  <div>
                    <Label htmlFor="term">Term (Years)</Label>
                    <Select 
                      value={newWarranty.term_years.toString()} 
                      onValueChange={(v) => setNewWarranty({ ...newWarranty, term_years: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Year</SelectItem>
                        <SelectItem value="2">2 Years</SelectItem>
                        <SelectItem value="5">5 Years</SelectItem>
                        <SelectItem value="10">10 Years</SelectItem>
                        <SelectItem value="15">15 Years</SelectItem>
                        <SelectItem value="20">20 Years</SelectItem>
                        <SelectItem value="25">25 Years</SelectItem>
                        <SelectItem value="30">30 Years</SelectItem>
                        <SelectItem value="50">50 Years (Lifetime)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={newWarranty.start_date}
                    onChange={(e) => setNewWarranty({ ...newWarranty, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="coverage">Coverage Description</Label>
                  <Textarea
                    id="coverage"
                    value={newWarranty.coverage_description}
                    onChange={(e) => setNewWarranty({ ...newWarranty, coverage_description: e.target.value })}
                    placeholder="What does this warranty cover?"
                    rows={2}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => createMutation.mutate(newWarranty)}
                    disabled={createMutation.isPending}
                  >
                    Register
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {/* Expiring Soon Alert */}
        {expiringWarranties.length > 0 && (
          <Card className="mb-4 border-orange-200 bg-orange-50 dark:bg-orange-950">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Bell className="h-5 w-5 text-orange-500 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-800 dark:text-orange-200">
                    {expiringWarranties.length} warranty{expiringWarranties.length > 1 ? 'ies' : 'y'} expiring soon
                  </p>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    Schedule inspections before expiration to ensure coverage
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Warranties Table */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading warranties...</div>
        ) : warranties && warranties.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Manufacturer / Product</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warranties.map((warranty) => {
                const expiryStatus = getExpiryStatus(warranty.end_date);
                return (
                  <TableRow key={warranty.id}>
                    <TableCell>
                      <Badge className={WARRANTY_TYPES[warranty.warranty_type]?.color}>
                        {WARRANTY_TYPES[warranty.warranty_type]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{warranty.manufacturer_name || '-'}</p>
                        <p className="text-sm text-muted-foreground">{warranty.product_name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm truncate">{warranty.coverage_description || 'Standard coverage'}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {expiryStatus.urgent && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                        <div>
                          <p className="text-sm">{format(new Date(warranty.end_date), 'MMM d, yyyy')}</p>
                          <p className={`text-xs ${expiryStatus.color}`}>{expiryStatus.label}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {warranty.status === 'active' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Badge variant="secondary">{warranty.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No warranties registered</p>
            <p className="text-sm">Register warranties to track coverage and expiration</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
