import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { 
  Shield, 
  UserX, 
  Power, 
  Trash2, 
  Eye, 
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Plus
} from "lucide-react";

interface PlatformOperator {
  id: string;
  user_id: string;
  created_by_master: string;
  granted_permissions: {
    view_all_companies: boolean;
    manage_features: boolean;
    manage_users: boolean;
    delete_companies: boolean;
  };
  is_active: boolean;
  deactivated_at: string | null;
  notes: string | null;
  created_at: string;
  profile: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    is_suspended: boolean;
    suspended_at: string | null;
    suspension_reason: string | null;
  };
}

export const PlatformOperatorsPanel = () => {
  const [operators, setOperators] = useState<PlatformOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<PlatformOperator | null>(null);
  const [suspensionReason, setSuspensionReason] = useState("");
  const [creating, setCreating] = useState(false);
  const [newOperator, setNewOperator] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    notes: ""
  });
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    loadOperators();
  }, []);

  const loadOperators = async () => {
    try {
      setLoading(true);
      
      // Fetch platform operators with their profiles
      const { data, error } = await supabase
        .from('platform_operators')
        .select(`
          *,
          profile:profiles!platform_operators_user_id_fkey (
            id,
            first_name,
            last_name,
            email,
            role,
            is_suspended,
            suspended_at,
            suspension_reason
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setOperators((data || []) as unknown as PlatformOperator[]);
    } catch (error: any) {
      console.error('Error loading operators:', error);
      toast({
        title: "Error loading operators",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const suspendOperator = async () => {
    if (!selectedOperator) return;
    
    try {
      // Update profile to suspended
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          is_suspended: true,
          suspended_at: new Date().toISOString(),
          suspended_by: user?.id,
          suspension_reason: suspensionReason || 'Suspended by master admin'
        })
        .eq('id', selectedOperator.user_id);

      if (profileError) throw profileError;

      // Deactivate all company access
      const { error: accessError } = await supabase
        .from('user_company_access')
        .update({ is_active: false })
        .eq('user_id', selectedOperator.user_id);

      if (accessError) throw accessError;

      // Update platform operator record
      const { error: operatorError } = await supabase
        .from('platform_operators')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString(),
          deactivated_by: user?.id
        })
        .eq('id', selectedOperator.id);

      if (operatorError) throw operatorError;

      toast({
        title: "Operator Suspended",
        description: `${selectedOperator.profile.first_name} ${selectedOperator.profile.last_name} has been suspended immediately.`
      });

      setSuspendDialogOpen(false);
      setSuspensionReason("");
      setSelectedOperator(null);
      loadOperators();
    } catch (error: any) {
      toast({
        title: "Error suspending operator",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const reactivateOperator = async (operator: PlatformOperator) => {
    try {
      // Remove suspension from profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          is_suspended: false,
          suspended_at: null,
          suspended_by: null,
          suspension_reason: null
        })
        .eq('id', operator.user_id);

      if (profileError) throw profileError;

      // Reactivate platform operator record
      const { error: operatorError } = await supabase
        .from('platform_operators')
        .update({
          is_active: true,
          deactivated_at: null,
          deactivated_by: null
        })
        .eq('id', operator.id);

      if (operatorError) throw operatorError;

      // Reactivate company access
      const { error: accessError } = await supabase
        .from('user_company_access')
        .update({ is_active: true })
        .eq('user_id', operator.user_id);

      if (accessError) throw accessError;

      toast({
        title: "Operator Reactivated",
        description: `${operator.profile.first_name} ${operator.profile.last_name} has been reactivated.`
      });

      loadOperators();
    } catch (error: any) {
      toast({
        title: "Error reactivating operator",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const removeOperator = async () => {
    if (!selectedOperator) return;
    
    try {
      // Delete platform operator record (cascades to profile changes)
      const { error: operatorError } = await supabase
        .from('platform_operators')
        .delete()
        .eq('id', selectedOperator.id);

      if (operatorError) throw operatorError;

      // Remove all company access
      const { error: accessError } = await supabase
        .from('user_company_access')
        .delete()
        .eq('user_id', selectedOperator.user_id);

      if (accessError) throw accessError;

      // Remove platform operator flags from profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          can_manage_all_companies: false,
          created_by_master: null,
          is_suspended: true,
          suspension_reason: 'Platform operator access removed'
        })
        .eq('id', selectedOperator.user_id);

      if (profileError) throw profileError;

      toast({
        title: "Operator Removed",
        description: `${selectedOperator.profile.first_name} ${selectedOperator.profile.last_name} has been completely removed from platform operations.`
      });

      setRemoveDialogOpen(false);
      setSelectedOperator(null);
      loadOperators();
    } catch (error: any) {
      toast({
        title: "Error removing operator",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const createOperator = async () => {
    if (!newOperator.email || !newOperator.password || !newOperator.first_name || !newOperator.last_name) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    try {
      setCreating(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const response = await supabase.functions.invoke('create-platform-operator', {
        body: {
          email: newOperator.email,
          password: newOperator.password,
          first_name: newOperator.first_name,
          last_name: newOperator.last_name,
          notes: newOperator.notes || null,
          permissions: {
            view_all_companies: true,
            manage_features: true,
            manage_users: false,
            delete_companies: false
          }
        }
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to create operator');

      toast({
        title: "Platform Operator Created",
        description: response.data.message
      });

      setCreateDialogOpen(false);
      setNewOperator({ email: "", password: "", first_name: "", last_name: "", notes: "" });
      loadOperators();
    } catch (error: any) {
      toast({
        title: "Error creating operator",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setCreating(false);
    }
  };

  const updatePermissions = async (operator: PlatformOperator, permissions: Partial<PlatformOperator['granted_permissions']>) => {
    try {
      const newPermissions = { ...operator.granted_permissions, ...permissions };
      
      const { error } = await supabase
        .from('platform_operators')
        .update({ granted_permissions: newPermissions })
        .eq('id', operator.id);

      if (error) throw error;

      toast({
        title: "Permissions Updated",
        description: "Operator permissions have been updated."
      });

      loadOperators();
    } catch (error: any) {
      toast({
        title: "Error updating permissions",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading platform operators...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Platform Operators
            </CardTitle>
            <CardDescription>
              Manage users with platform-wide access. You have full control to suspend or remove any operator instantly.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Operator
          </Button>
        </CardHeader>
        <CardContent>
          {operators.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <UserX className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No platform operators configured</p>
              <p className="text-sm">Create a platform operator to grant all-company access to a user</p>
            </div>
          ) : (
            <div className="space-y-4">
              {operators.map((operator) => (
                <Card key={operator.id} className={operator.profile.is_suspended ? "border-destructive/50 bg-destructive/5" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-white ${operator.profile.is_suspended ? 'bg-destructive' : 'bg-primary'}`}>
                          {operator.profile.first_name?.charAt(0)}{operator.profile.last_name?.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">
                              {operator.profile.first_name} {operator.profile.last_name}
                            </h4>
                            {operator.profile.is_suspended ? (
                              <Badge variant="destructive" className="gap-1">
                                <XCircle className="h-3 w-3" />
                                Suspended
                              </Badge>
                            ) : operator.is_active ? (
                              <Badge variant="default" className="gap-1">
                                <CheckCircle className="h-3 w-3" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="gap-1">
                                <Clock className="h-3 w-3" />
                                Inactive
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{operator.profile.email}</p>
                          <p className="text-xs text-muted-foreground capitalize">Role: {operator.profile.role}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {operator.profile.is_suspended ? (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => reactivateOperator(operator)}
                          >
                            <Power className="h-4 w-4 mr-1" />
                            Reactivate
                          </Button>
                        ) : (
                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => {
                              setSelectedOperator(operator);
                              setSuspendDialogOpen(true);
                            }}
                          >
                            <AlertTriangle className="h-4 w-4 mr-1" />
                            Suspend
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setSelectedOperator(operator);
                            setRemoveDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {operator.profile.is_suspended && operator.profile.suspension_reason && (
                      <div className="mt-3 p-2 bg-destructive/10 rounded text-sm text-destructive">
                        <strong>Suspension Reason:</strong> {operator.profile.suspension_reason}
                      </div>
                    )}

                    {/* Permissions */}
                    <div className="mt-4 pt-4 border-t space-y-3">
                      <h5 className="text-sm font-medium flex items-center gap-2">
                        <Settings className="h-4 w-4" />
                        Permissions
                      </h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            View All Companies
                          </Label>
                          <Switch
                            checked={operator.granted_permissions?.view_all_companies ?? true}
                            onCheckedChange={(checked) => updatePermissions(operator, { view_all_companies: checked })}
                            disabled={operator.profile.is_suspended}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            Manage Features
                          </Label>
                          <Switch
                            checked={operator.granted_permissions?.manage_features ?? true}
                            onCheckedChange={(checked) => updatePermissions(operator, { manage_features: checked })}
                            disabled={operator.profile.is_suspended}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Created: {new Date(operator.created_at).toLocaleDateString()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspend Dialog */}
      <Dialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Suspend Platform Operator
            </DialogTitle>
            <DialogDescription>
              This will immediately revoke all access for {selectedOperator?.profile.first_name} {selectedOperator?.profile.last_name}. 
              They will be logged out instantly and cannot access any company data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Suspension Reason (Optional)</Label>
              <Textarea
                value={suspensionReason}
                onChange={(e) => setSuspensionReason(e.target.value)}
                placeholder="Enter reason for suspension..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={suspendOperator}>
              Suspend Immediately
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Remove Platform Operator Completely
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {selectedOperator?.profile.first_name} {selectedOperator?.profile.last_name} from platform operations.
              All company access will be revoked and they will no longer be able to manage any platform features.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={removeOperator}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remove Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Operator Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create Platform Operator
            </DialogTitle>
            <DialogDescription>
              Create a new platform operator with access to all companies.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={newOperator.first_name}
                  onChange={(e) => setNewOperator({ ...newOperator, first_name: e.target.value })}
                  placeholder="Taylor"
                />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input
                  value={newOperator.last_name}
                  onChange={(e) => setNewOperator({ ...newOperator, last_name: e.target.value })}
                  placeholder="Johnston"
                />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={newOperator.email}
                onChange={(e) => setNewOperator({ ...newOperator, email: e.target.value })}
                placeholder="taylor@company.com"
              />
            </div>
            <div>
              <Label>Password *</Label>
              <Input
                type="password"
                value={newOperator.password}
                onChange={(e) => setNewOperator({ ...newOperator, password: e.target.value })}
                placeholder="Secure password"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={newOperator.notes}
                onChange={(e) => setNewOperator({ ...newOperator, notes: e.target.value })}
                placeholder="Optional notes about this operator..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createOperator} disabled={creating}>
              {creating ? "Creating..." : "Create Operator"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
