import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { Key, Plus, Copy, Trash2, RefreshCw, Eye, EyeOff, Clock, Shield, User } from 'lucide-react';
import { format } from 'date-fns';

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_active: boolean;
  rate_limit_per_hour: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  default_assignee_id: string | null;
}

interface TeamMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

// Generate a secure random API key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const prefix = 'pk_live_';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + key;
}

// Hash API key (same as server-side)
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function ApiKeyManager() {
  const { toast } = useToast();
  const { activeCompanyId } = useCompanySwitcher();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [newKeyAssignee, setNewKeyAssignee] = useState<string>('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (activeCompanyId) {
      loadApiKeys();
      loadTeamMembers();
    }
  }, [activeCompanyId]);

  const loadTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .eq('tenant_id', activeCompanyId)
        .order('first_name');

      if (error) throw error;
      setTeamMembers(data || []);
    } catch (error) {
      console.error('Error loading team members:', error);
    }
  };

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('company_api_keys')
        .select('id, key_prefix, name, description, permissions, is_active, rate_limit_per_hour, usage_count, last_used_at, created_at, default_assignee_id')
        .eq('tenant_id', activeCompanyId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApiKeys(data || []);
    } catch (error) {
      console.error('Error loading API keys:', error);
      toast({
        title: 'Error',
        description: 'Failed to load API keys',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a name for the API key',
        variant: 'destructive'
      });
      return;
    }

    setCreating(true);
    try {
      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);
      const keyPrefix = apiKey.substring(0, 8);

      const { data: user } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('company_api_keys')
        .insert({
          tenant_id: activeCompanyId,
          api_key_hash: keyHash,
          key_prefix: keyPrefix,
          name: newKeyName.trim(),
          description: newKeyDescription.trim() || null,
          permissions: ['lead_submission'],
          created_by: user?.user?.id,
          default_assignee_id: (newKeyAssignee && newKeyAssignee !== 'none') ? newKeyAssignee : null
        });

      if (error) throw error;

      setGeneratedKey(apiKey);
      setShowKey(true);
      toast({
        title: 'API Key Created',
        description: 'Your new API key has been created. Copy it now - it won\'t be shown again!',
      });
      
      loadApiKeys();
    } catch (error: any) {
      console.error('Error creating API key:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to create API key',
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
  };

  const updateDefaultAssignee = async (keyId: string, assigneeId: string | null) => {
    try {
      const { error } = await supabase
        .from('company_api_keys')
        .update({ default_assignee_id: assigneeId })
        .eq('id', keyId);

      if (error) throw error;

      toast({
        title: 'Updated',
        description: 'Default assignee updated successfully',
      });
      
      loadApiKeys();
    } catch (error) {
      console.error('Error updating assignee:', error);
      toast({
        title: 'Error',
        description: 'Failed to update default assignee',
        variant: 'destructive'
      });
    }
  };

  const revokeApiKey = async (keyId: string) => {
    try {
      const { data: user } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('company_api_keys')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: user?.user?.id
        })
        .eq('id', keyId);

      if (error) throw error;

      toast({
        title: 'API Key Revoked',
        description: 'The API key has been revoked and can no longer be used.',
      });
      
      loadApiKeys();
    } catch (error) {
      console.error('Error revoking API key:', error);
      toast({
        title: 'Error',
        description: 'Failed to revoke API key',
        variant: 'destructive'
      });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`,
    });
  };

  const getAssigneeName = (assigneeId: string | null) => {
    if (!assigneeId) return 'Unassigned';
    const member = teamMembers.find(m => m.id === assigneeId);
    if (!member) return 'Unknown';
    return `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email || 'Unknown';
  };

  const webhookUrl = `${window.location.origin.replace('localhost:8080', 'alxelfrbjzkmtnsulcei.supabase.co')}/functions/v1/external-lead-webhook`;

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setNewKeyName('');
    setNewKeyDescription('');
    setNewKeyAssignee('');
    setGeneratedKey(null);
    setShowKey(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle>API Keys</CardTitle>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create API Key
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New API Key</DialogTitle>
                <DialogDescription>
                  Create a new API key for external integrations like website forms.
                </DialogDescription>
              </DialogHeader>
              
              {!generatedKey ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="keyName">Key Name</Label>
                    <Input
                      id="keyName"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g., Website Contact Form"
                    />
                  </div>
                  <div>
                    <Label htmlFor="keyDescription">Description (optional)</Label>
                    <Input
                      id="keyDescription"
                      value={newKeyDescription}
                      onChange={(e) => setNewKeyDescription(e.target.value)}
                      placeholder="e.g., Used for main website lead capture"
                    />
                  </div>
                  <div>
                    <Label htmlFor="keyAssignee">Default Lead Assignee</Label>
                    <Select value={newKeyAssignee} onValueChange={setNewKeyAssignee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select team member to auto-assign leads" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No auto-assignment</SelectItem>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.first_name} {member.last_name} {member.email && `(${member.email})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      All leads from this API key will be automatically assigned to this person.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-800 mb-2">
                      <Shield className="h-4 w-4" />
                      <span className="font-medium">Important: Copy your API key now</span>
                    </div>
                    <p className="text-sm text-amber-700">
                      This is the only time you'll see this key. Store it securely.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Your API Key</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={generatedKey}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(generatedKey, 'API Key')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                {!generatedKey ? (
                  <>
                    <Button variant="outline" onClick={closeCreateDialog}>
                      Cancel
                    </Button>
                    <Button onClick={createApiKey} disabled={creating}>
                      {creating ? 'Creating...' : 'Create Key'}
                    </Button>
                  </>
                ) : (
                  <Button onClick={closeCreateDialog}>
                    Done
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          Manage API keys for external integrations. Use these keys to submit leads from your website or other platforms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Webhook URL */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <Label className="text-sm font-medium">Webhook Endpoint</Label>
          <div className="flex items-center gap-2">
            <Input
              value={webhookUrl}
              readOnly
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Send POST requests to this URL with your API key and lead data.
          </p>
        </div>

        {/* API Keys Table */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading API keys...
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No API keys created yet.</p>
            <p className="text-sm">Create an API key to start receiving leads from your website.</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{key.name}</p>
                        {key.description && (
                          <p className="text-xs text-muted-foreground">{key.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {key.key_prefix}...
                      </code>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={key.default_assignee_id || 'none'}
                        onValueChange={(value) => updateDefaultAssignee(key.id, value === 'none' ? null : value)}
                      >
                        <SelectTrigger className="w-[180px] h-8 text-xs">
                          <SelectValue>
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              <span className="truncate">{getAssigneeName(key.default_assignee_id)}</span>
                            </div>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {teamMembers.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.first_name} {member.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.is_active ? 'default' : 'secondary'}>
                        {key.is_active ? 'Active' : 'Revoked'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <RefreshCw className="h-3 w-3" />
                        {key.usage_count}
                      </div>
                    </TableCell>
                    <TableCell>
                      {key.last_used_at ? (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(key.last_used_at), 'MMM d, h:mm a')}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.is_active && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will immediately revoke the API key "{key.name}". 
                                Any integrations using this key will stop working.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revokeApiKey(key.id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Revoke Key
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
}
