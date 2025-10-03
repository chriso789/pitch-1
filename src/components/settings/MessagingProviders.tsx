import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Mail, MessageSquare, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDER_TYPES = [
  { value: 'twilio_sms', label: 'Twilio SMS', icon: MessageSquare },
  { value: 'sendgrid_email', label: 'SendGrid Email', icon: Mail },
  { value: 'twilio_voice', label: 'Twilio Voice', icon: Phone },
];

export function MessagingProviders() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newProvider, setNewProvider] = useState({
    provider_type: 'twilio_sms',
    provider_name: '',
    credentials_secret_name: '',
    is_default: false,
  });

  const { data: providers, isLoading } = useQuery({
    queryKey: ['messaging-providers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messaging_providers')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const createProvider = useMutation({
    mutationFn: async (provider: typeof newProvider) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      const { error } = await supabase
        .from('messaging_providers')
        .insert({
          ...provider,
          tenant_id: profile?.tenant_id,
          created_by: user.id,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-providers'] });
      toast({
        title: "Provider added",
        description: "Messaging provider has been configured successfully.",
      });
      setIsAddDialogOpen(false);
      setNewProvider({
        provider_type: 'twilio_sms',
        provider_name: '',
        credentials_secret_name: '',
        is_default: false,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('messaging_providers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-providers'] });
      toast({
        title: "Provider deleted",
        description: "Messaging provider has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('messaging_providers')
        .update({ is_active })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-providers'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Messaging Providers</h3>
          <p className="text-sm text-muted-foreground">
            Configure SMS, email, and voice messaging providers
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Messaging Provider</DialogTitle>
              <DialogDescription>
                Configure a new messaging provider for your tenant
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Provider Type</Label>
                <Select
                  value={newProvider.provider_type}
                  onValueChange={(value) =>
                    setNewProvider({ ...newProvider, provider_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <type.icon className="h-4 w-4" />
                          {type.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Provider Name</Label>
                <Input
                  placeholder="e.g., Main SMS Provider"
                  value={newProvider.provider_name}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, provider_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Credentials Secret Name</Label>
                <Input
                  placeholder="e.g., TWILIO_ACCOUNT_SID"
                  value={newProvider.credentials_secret_name}
                  onChange={(e) =>
                    setNewProvider({
                      ...newProvider,
                      credentials_secret_name: e.target.value,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Reference to the Supabase secret containing credentials
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={newProvider.is_default}
                  onCheckedChange={(checked) =>
                    setNewProvider({ ...newProvider, is_default: checked })
                  }
                />
                <Label>Set as default provider</Label>
              </div>
              <Button
                className="w-full"
                onClick={() => createProvider.mutate(newProvider)}
                disabled={createProvider.isPending}
              >
                {createProvider.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add Provider
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {providers?.map((provider) => {
          const ProviderIcon =
            PROVIDER_TYPES.find((t) => t.value === provider.provider_type)?.icon ||
            MessageSquare;

          return (
            <Card key={provider.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <ProviderIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{provider.provider_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {PROVIDER_TYPES.find((t) => t.value === provider.provider_type)
                        ?.label}
                      {provider.is_default && (
                        <span className="ml-2 text-xs font-medium text-primary">
                          (Default)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={provider.is_active}
                    onCheckedChange={(checked) =>
                      toggleActive.mutate({ id: provider.id, is_active: checked })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteProvider.mutate(provider.id)}
                    disabled={deleteProvider.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
        {providers?.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No messaging providers configured yet
          </div>
        )}
      </div>
    </div>
  );
}
