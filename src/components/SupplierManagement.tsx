import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Plus, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type SupplierAccount = Database['public']['Tables']['supplier_accounts']['Row'];

interface SyncLog {
  id: string;
  sync_type: string;
  status: string;
  products_processed: number;
  products_updated: number;
  started_at: string;
  completed_at?: string;
  error_details?: any;
}

const SupplierManagement: React.FC = () => {
  const [suppliers, setSuppliers] = useState<SupplierAccount[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    billtrust_email: '',
    billtrust_password: ''
  });
  const [connectingSupplier, setConnectingSupplier] = useState<string | null>(null);
  const [syncingSupplier, setSyncingSupplier] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadSuppliers();
    loadSyncLogs();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('supplier_accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSuppliers((data as SupplierAccount[]) || []);
    } catch (error) {
      console.error('Error loading suppliers:', error);
      toast({
        title: "Error",
        description: "Failed to load suppliers",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSyncLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('supplier_price_sync_logs')
        .select(`
          *,
          supplier_accounts(supplier_name)
        `)
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setSyncLogs(data || []);
    } catch (error) {
      console.error('Error loading sync logs:', error);
    }
  };

  const handleAddSupplier = async () => {
    if (!newSupplier.supplier_name || !newSupplier.billtrust_email || !newSupplier.billtrust_password) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }

    setConnectingSupplier('new');
    try {
      // Get current user's tenant_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('User profile not found');

      // First create the supplier account
      const { data: supplierData, error: supplierError } = await supabase
        .from('supplier_accounts')
        .insert({
          tenant_id: profile.tenant_id,
          supplier_name: newSupplier.supplier_name,
          billtrust_email: newSupplier.billtrust_email,
          connection_status: 'pending' as const,
          created_by: user.id
        })
        .select()
        .single();

      if (supplierError) throw supplierError;

      // Then authenticate with Billtrust
      const { data: authData, error: authError } = await supabase.functions.invoke(
        'billtrust-auth',
        {
          body: {
            email: newSupplier.billtrust_email,
            password: newSupplier.billtrust_password,
            supplierAccountId: supplierData.id
          }
        }
      );

      if (authError || !authData.success) {
        throw new Error(authData?.error || 'Authentication failed');
      }

      toast({
        title: "Success",
        description: `Connected to ${newSupplier.supplier_name} successfully`
      });

      setIsAddDialogOpen(false);
      setNewSupplier({ supplier_name: '', billtrust_email: '', billtrust_password: '' });
      loadSuppliers();
      
    } catch (error) {
      console.error('Error adding supplier:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to connect supplier",
        variant: "destructive"
      });
    } finally {
      setConnectingSupplier(null);
    }
  };

  const handleSyncPricing = async (supplierId: string) => {
    setSyncingSupplier(supplierId);
    try {
      const { data, error } = await supabase.functions.invoke('billtrust-pricing', {
        body: {
          supplierAccountId: supplierId
        }
      });

      if (error || !data.success) {
        throw new Error(data?.error || 'Sync failed');
      }

      toast({
        title: "Sync Started",
        description: `Processing ${data.processed} products`
      });

      loadSuppliers();
      loadSyncLogs();
      
    } catch (error) {
      console.error('Error syncing pricing:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to sync pricing",
        variant: "destructive"
      });
    } finally {
      setSyncingSupplier(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Connected</Badge>;
      case 'disconnected':
        return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Disconnected</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
      case 'pending':
        return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading suppliers...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Supplier Management</h2>
          <p className="text-muted-foreground">Manage supplier accounts and pricing integration</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Supplier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Supplier</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="supplier_name">Supplier Name</Label>
                <Input
                  id="supplier_name"
                  placeholder="ABC Supply Co."
                  value={newSupplier.supplier_name}
                  onChange={(e) => setNewSupplier({ ...newSupplier, supplier_name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="billtrust_email">Billtrust Email</Label>
                <Input
                  id="billtrust_email"
                  type="email"
                  placeholder="your-account@supplier.com"
                  value={newSupplier.billtrust_email}
                  onChange={(e) => setNewSupplier({ ...newSupplier, billtrust_email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="billtrust_password">Billtrust Password</Label>
                <Input
                  id="billtrust_password"
                  type="password"
                  placeholder="••••••••"
                  value={newSupplier.billtrust_password}
                  onChange={(e) => setNewSupplier({ ...newSupplier, billtrust_password: e.target.value })}
                />
              </div>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Credentials are securely encrypted and used only for API access.
                </AlertDescription>
              </Alert>
              <Button 
                onClick={handleAddSupplier} 
                className="w-full"
                disabled={connectingSupplier === 'new'}
              >
                {connectingSupplier === 'new' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Connect Supplier
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="suppliers" className="w-full">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="sync-history">Sync History</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-4">
          {suppliers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-8 text-center">
                <h3 className="text-lg font-semibold mb-2">No Suppliers Connected</h3>
                <p className="text-muted-foreground mb-4">
                  Connect your first supplier to start syncing pricing data from Billtrust.
                </p>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Your First Supplier
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((supplier) => (
                <Card key={supplier.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{supplier.supplier_name}</CardTitle>
                      {getStatusBadge(supplier.connection_status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Email: {supplier.billtrust_email}
                      </p>
                      {supplier.billtrust_tenant_id && (
                        <p className="text-sm text-muted-foreground">
                          Tenant: {supplier.billtrust_tenant_id}
                        </p>
                      )}
                      {supplier.last_sync_at && (
                        <p className="text-sm text-muted-foreground">
                          Last sync: {new Date(supplier.last_sync_at).toLocaleDateString()}
                        </p>
                      )}
                      {supplier.last_error && (
                        <Alert className="mt-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            {supplier.last_error}
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="flex gap-2 mt-4">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => handleSyncPricing(supplier.id)}
                          disabled={syncingSupplier === supplier.id || supplier.connection_status !== 'connected'}
                        >
                          {syncingSupplier === supplier.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Sync Pricing
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sync-history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Sync Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {syncLogs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  No sync activity yet
                </p>
              ) : (
                <div className="space-y-4">
                  {syncLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{(log as any).supplier_accounts?.supplier_name}</span>
                          {getStatusBadge(log.status)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {log.products_processed} products processed, {log.products_updated} updated
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(log.started_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium capitalize">{log.sync_type}</div>
                        {log.error_details && (
                          <div className="text-xs text-destructive">
                            {Array.isArray(log.error_details?.errors) 
                              ? `${log.error_details.errors.length} errors`
                              : 'Error occurred'
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SupplierManagement;