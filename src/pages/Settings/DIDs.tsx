import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Phone, Plus, Trash2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DIDCampaign {
  id: string;
  did: string;
  campaign_name: string;
  greeting_message: string;
  routing_type: string;
  active: boolean;
}

export default function DIDs() {
  const [dids, setDids] = useState<DIDCampaign[]>([]);
  const [editingDID, setEditingDID] = useState<Partial<DIDCampaign> | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadDIDs();
  }, []);

  const loadDIDs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      const { data, error } = await supabase
        .from('did_campaigns')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setDids(data || []);
    } catch (error) {
      console.error('Error loading DIDs:', error);
      toast({
        title: "Error",
        description: "Failed to load DIDs",
        variant: "destructive",
      });
    }
  };

  const saveDID = async () => {
    if (!editingDID?.did) {
      toast({
        title: "Validation Error",
        description: "Phone number is required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      const didData = {
        tenant_id: profile.tenant_id,
        did: editingDID.did,
        campaign_name: editingDID.campaign_name || '',
        greeting_message: editingDID.greeting_message || 'Thank you for calling',
        routing_type: editingDID.routing_type || 'voicemail',
        active: editingDID.active ?? true,
      };

      if (editingDID.id) {
        // Update existing
        const { error } = await supabase
          .from('did_campaigns')
          .update(didData)
          .eq('id', editingDID.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('did_campaigns')
          .insert(didData);

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "DID configuration saved",
      });

      setEditingDID(null);
      loadDIDs();
    } catch (error) {
      console.error('Error saving DID:', error);
      toast({
        title: "Error",
        description: "Failed to save DID configuration",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteDID = async (id: string) => {
    try {
      const { error } = await supabase
        .from('did_campaigns')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "DID deleted",
      });

      loadDIDs();
    } catch (error) {
      console.error('Error deleting DID:', error);
      toast({
        title: "Error",
        description: "Failed to delete DID",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">DID Management</h1>
        <Button onClick={() => setEditingDID({ active: true })}>
          <Plus className="h-4 w-4 mr-2" />
          Add DID
        </Button>
      </div>

      {editingDID && (
        <Card>
          <CardHeader>
            <CardTitle>{editingDID.id ? 'Edit' : 'Add'} DID Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="did">Phone Number (DID)</Label>
              <Input
                id="did"
                value={editingDID.did || ''}
                onChange={(e) => setEditingDID({ ...editingDID, did: e.target.value })}
                placeholder="+15551234567"
              />
            </div>

            <div>
              <Label htmlFor="campaign_name">Campaign Name</Label>
              <Input
                id="campaign_name"
                value={editingDID.campaign_name || ''}
                onChange={(e) => setEditingDID({ ...editingDID, campaign_name: e.target.value })}
                placeholder="Spring 2025 Campaign"
              />
            </div>

            <div>
              <Label htmlFor="routing_type">Routing Type</Label>
              <Select
                value={editingDID.routing_type || 'voicemail'}
                onValueChange={(value) => setEditingDID({ ...editingDID, routing_type: value })}
              >
                <SelectTrigger id="routing_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assigned_agent">Assigned Agent</SelectItem>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="ivr">IVR Menu</SelectItem>
                  <SelectItem value="voicemail">Voicemail</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="greeting_message">Greeting Message</Label>
              <Textarea
                id="greeting_message"
                value={editingDID.greeting_message || ''}
                onChange={(e) => setEditingDID({ ...editingDID, greeting_message: e.target.value })}
                placeholder="Thank you for calling..."
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={saveDID} disabled={loading}>
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => setEditingDID(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Configured DIDs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {dids.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No DIDs configured. Add your first tracking number above.
              </p>
            ) : (
              dids.map((did) => (
                <div
                  key={did.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-semibold">{did.did}</div>
                    <div className="text-sm text-muted-foreground">
                      {did.campaign_name || 'No campaign'} • {did.routing_type}
                    </div>
                    {did.greeting_message && (
                      <div className="text-xs text-muted-foreground mt-1">
                        "{did.greeting_message.substring(0, 50)}..."
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingDID(did)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteDID(did.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
