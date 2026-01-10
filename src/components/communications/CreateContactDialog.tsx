/**
 * Create Contact Dialog
 * Quick form to create a new contact from unmatched inbox
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contactId: string) => void;
  initialPhone?: string;
}

export const CreateContactDialog = ({
  open,
  onOpenChange,
  onCreated,
  initialPhone,
}: CreateContactDialogProps) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [email, setEmail] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('No tenant');

      const { data, error } = await supabase
        .from('contacts')
        .insert({
          tenant_id: tenantId,
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          source: 'unmatched_inbox',
        })
        .select('id')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Contact created successfully');
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      onCreated(data.id);
      resetForm();
    },
    onError: (error) => {
      console.error('Failed to create contact:', error);
      toast.error('Failed to create contact');
    },
  });

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setPhone(initialPhone ?? '');
    setEmail('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      toast.error('First name is required');
      return;
    }
    createMutation.mutate();
  };

  // Update phone when initialPhone changes
  if (open && initialPhone && !phone) {
    setPhone(initialPhone);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) resetForm();
      onOpenChange(o);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Contact</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || !firstName.trim()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create & Link'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
