import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserPlus, Eye, MapPin, Calendar, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import LocationTracker from "./LocationTracker";
import { LocationData } from "@/services/locationService";

interface GhostAccount {
  id: string;
  email: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  tenant_id: string;
  current_location?: any;
  location_updated_at?: string;
  created_at: string;
}

interface GhostReport {
  id: string;
  activity_type: string;
  activity_data: any;
  location_data?: any;
  created_at: string;
  ghost_account: {
    display_name?: string;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

const GhostAccountManager: React.FC = () => {
  const [ghostAccounts, setGhostAccounts] = useState<GhostAccount[]>([]);
  const [ghostReports, setGhostReports] = useState<GhostReport[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<GhostAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showReportsDialog, setShowReportsDialog] = useState(false);
  
  const [newAccount, setNewAccount] = useState({
    email: "",
    display_name: "",
    password: "",
    tenant_id: "",
  });

  const { toast } = useToast();

  useEffect(() => {
    loadGhostAccounts();
    loadGhostReports();
  }, []);

  const loadGhostAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_ghost_account", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGhostAccounts(data || []);
    } catch (error) {
      console.error("Error loading ghost accounts:", error);
      toast({
        title: "Error",
        description: "Failed to load ghost accounts.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadGhostReports = async () => {
    try {
      const { data, error } = await supabase
        .from("ghost_account_reports")
        .select(`
          *,
          ghost_account:profiles!ghost_account_id (
            first_name,
            last_name,
            email
          )
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setGhostReports(data || []);
    } catch (error) {
      console.error("Error loading ghost reports:", error);
    }
  };

  const createGhostAccount = async () => {
    if (!newAccount.email || !newAccount.display_name || !newAccount.tenant_id) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: newAccount.email,
        password: newAccount.password || `ghost_${Date.now()}`,
        options: {
          data: {
            display_name: newAccount.display_name,
          },
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        // Update profile to mark as ghost account
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            is_ghost_account: true,
            tenant_id: newAccount.tenant_id,
            display_name: newAccount.display_name,
            created_by_master: (await supabase.auth.getUser()).data.user?.id,
          })
          .eq("id", authData.user.id);

        if (profileError) throw profileError;

        toast({
          title: "Ghost Account Created",
          description: `Ghost account for ${newAccount.display_name} has been created successfully.`,
        });

        setShowCreateDialog(false);
        setNewAccount({ email: "", display_name: "", password: "", tenant_id: "" });
        loadGhostAccounts();
      }
    } catch (error: any) {
      console.error("Error creating ghost account:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create ghost account.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const updateGhostLocation = async (accountId: string, location: LocationData) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          current_location: {
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            address: location.address,
          },
          location_updated_at: new Date().toISOString(),
        })
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: "Location Updated",
        description: "Ghost account location has been updated.",
      });

      loadGhostAccounts();
    } catch (error) {
      console.error("Error updating ghost location:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update ghost account location.",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getActivityTypeColor = (type: string) => {
    switch (type) {
      case "contact_created":
        return "bg-green-100 text-green-800";
      case "location_updated":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Ghost Account Management
            </CardTitle>
            <div className="flex gap-2">
              <Dialog open={showReportsDialog} onOpenChange={setShowReportsDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Activity className="h-4 w-4 mr-2" />
                    View Reports
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
                  <DialogHeader>
                    <DialogTitle>Ghost Account Activity Reports</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {ghostReports.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No activity reports found.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead>Activity</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead>Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ghostReports.map((report) => (
                            <TableRow key={report.id}>
                              <TableCell>
                                <div>
                                  <div className="font-medium">
                                    {report.ghost_account.display_name || 
                                     `${report.ghost_account.first_name || ''} ${report.ghost_account.last_name || ''}`.trim() || 
                                     'Unknown'}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {report.ghost_account.email}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={getActivityTypeColor(report.activity_type)}>
                                  {report.activity_type.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  {report.activity_data.contact_name && (
                                    <div>Contact: {report.activity_data.contact_name}</div>
                                  )}
                                  {report.activity_data.contact_address && (
                                    <div>Address: {report.activity_data.contact_address}</div>
                                  )}
                                  {report.activity_data.lead_source && (
                                    <div>Source: {report.activity_data.lead_source}</div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {report.location_data && (
                                  <div className="text-sm font-mono">
                                    {report.location_data.lat?.toFixed(4)}, {report.location_data.lng?.toFixed(4)}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {formatDate(report.created_at)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              
              <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create Ghost Account
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Ghost Account</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Input
                      placeholder="Email"
                      type="email"
                      value={newAccount.email}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, email: e.target.value }))}
                    />
                    <Input
                      placeholder="Display Name"
                      value={newAccount.display_name}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, display_name: e.target.value }))}
                    />
                    <Input
                      placeholder="Password (optional - auto-generated if empty)"
                      type="password"
                      value={newAccount.password}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, password: e.target.value }))}
                    />
                    <Input
                      placeholder="Tenant ID"
                      value={newAccount.tenant_id}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, tenant_id: e.target.value }))}
                    />
                    <Button
                      onClick={createGhostAccount}
                      disabled={isCreating}
                      className="w-full"
                    >
                      {isCreating ? "Creating..." : "Create Ghost Account"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {ghostAccounts.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No ghost accounts found. Create one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ghostAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {account.display_name || `${account.first_name || ''} ${account.last_name || ''}`.trim() || 'Unknown'}
                        </div>
                        <div className="text-sm text-muted-foreground">{account.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{account.tenant_id}</Badge>
                    </TableCell>
                    <TableCell>
                      {account.current_location ? (
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3" />
                          <span className="font-mono">
                            {account.current_location.lat?.toFixed(4)}, {account.current_location.lng?.toFixed(4)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No location</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="h-3 w-3" />
                        {account.location_updated_at
                          ? formatDate(account.location_updated_at)
                          : "Never"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedAccount(account)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Manage
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                          <DialogTitle>
                            Manage Ghost Account: {account.display_name || `${account.first_name || ''} ${account.last_name || ''}`.trim() || 'Unknown'}
                          </DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-sm font-medium">Email</label>
                                <div className="text-sm text-muted-foreground">{account.email}</div>
                              </div>
                              <div>
                                <label className="text-sm font-medium">Tenant ID</label>
                                <div className="text-sm text-muted-foreground">{account.tenant_id}</div>
                              </div>
                            </div>
                            
                            <LocationTracker
                              onLocationUpdate={(location) => updateGhostLocation(account.id, location)}
                              showAddress={true}
                            />
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GhostAccountManager;