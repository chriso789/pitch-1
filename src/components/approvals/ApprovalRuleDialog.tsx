import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ROLE_DISPLAY_NAMES, type AppRole } from '@/lib/roleUtils';

interface ApprovalRule {
  id: string;
  rule_name: string;
  min_amount: number;
  max_amount: number | null;
  required_approvers: string[];
  approval_type: string;
  is_active: boolean;
}

interface ApprovalRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: ApprovalRule | null;
  onSuccess: () => void;
}

const APPROVER_ROLES: AppRole[] = [
  'office_admin',
  'regional_manager',
  'sales_manager',
  'project_manager',
  'owner',
  'corporate'
];

const APPROVAL_TYPES = [
  { value: 'any', label: 'Any', description: 'One approver is sufficient' },
  { value: 'sequential', label: 'Sequential', description: 'Must approve in order' },
  { value: 'parallel', label: 'Parallel', description: 'All must approve (any order)' }
];

export function ApprovalRuleDialog({ open, onOpenChange, rule, onSuccess }: ApprovalRuleDialogProps) {
  const isEditMode = !!rule;
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [ruleName, setRuleName] = useState('');
  const [minAmount, setMinAmount] = useState('0');
  const [maxAmount, setMaxAmount] = useState('');
  const [noMaximum, setNoMaximum] = useState(false);
  const [approvalType, setApprovalType] = useState('any');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);

  // Reset form when dialog opens/closes or rule changes
  useEffect(() => {
    if (open) {
      if (rule) {
        setRuleName(rule.rule_name);
        setMinAmount(rule.min_amount.toString());
        setMaxAmount(rule.max_amount?.toString() || '');
        setNoMaximum(rule.max_amount === null);
        setApprovalType(rule.approval_type);
        setSelectedRoles(rule.required_approvers);
        setIsActive(rule.is_active);
      } else {
        setRuleName('');
        setMinAmount('0');
        setMaxAmount('');
        setNoMaximum(false);
        setApprovalType('any');
        setSelectedRoles([]);
        setIsActive(true);
      }
    }
  }, [open, rule]);

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const validateForm = (): string | null => {
    if (!ruleName.trim() || ruleName.length < 2 || ruleName.length > 100) {
      return 'Rule name must be between 2 and 100 characters';
    }
    
    const min = parseFloat(minAmount);
    if (isNaN(min) || min < 0) {
      return 'Minimum amount must be a valid number >= 0';
    }
    
    if (!noMaximum) {
      const max = parseFloat(maxAmount);
      if (isNaN(max) || max <= min) {
        return 'Maximum amount must be greater than minimum amount';
      }
    }
    
    if (selectedRoles.length === 0) {
      return 'At least one approver role must be selected';
    }
    
    return null;
  };

  const handleSave = async () => {
    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const ruleData = {
        rule_name: ruleName.trim(),
        min_amount: parseFloat(minAmount),
        max_amount: noMaximum ? null : parseFloat(maxAmount),
        required_approvers: selectedRoles,
        approval_type: approvalType,
        is_active: isActive
      };

      if (isEditMode && rule) {
        const { error } = await supabase
          .from('purchase_order_approval_rules')
          .update(ruleData)
          .eq('id', rule.id);

        if (error) throw error;
        toast.success('Approval rule updated');
      } else {
        const { error } = await supabase
          .from('purchase_order_approval_rules')
          .insert({
            ...ruleData,
            tenant_id: profile.tenant_id,
            created_by: user.id
          });

        if (error) throw error;
        toast.success('Approval rule created');
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving approval rule:', error);
      toast.error(error.message || 'Failed to save approval rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Approval Rule' : 'Create Approval Rule'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Rule Name */}
          <div className="space-y-2">
            <Label htmlFor="ruleName">Rule Name</Label>
            <Input
              id="ruleName"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g., Medium Orders Approval"
              maxLength={100}
            />
          </div>

          {/* Amount Range */}
          <div className="space-y-3">
            <Label>Amount Range</Label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    className="pl-7"
                    min={0}
                    placeholder="0"
                  />
                </div>
                <span className="text-xs text-muted-foreground mt-1">Minimum</span>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    className="pl-7"
                    disabled={noMaximum}
                    placeholder="No limit"
                  />
                </div>
                <span className="text-xs text-muted-foreground mt-1">Maximum</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="noMaximum"
                checked={noMaximum}
                onCheckedChange={(checked) => {
                  setNoMaximum(!!checked);
                  if (checked) setMaxAmount('');
                }}
              />
              <Label htmlFor="noMaximum" className="text-sm font-normal cursor-pointer">
                No maximum (unlimited)
              </Label>
            </div>
          </div>

          {/* Approval Type */}
          <div className="space-y-2">
            <Label>Approval Type</Label>
            <Select value={approvalType} onValueChange={setApprovalType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <span className="font-medium">{type.label}</span>
                      <span className="text-muted-foreground ml-2">- {type.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Required Approvers */}
          <div className="space-y-3">
            <Label>Required Approvers</Label>
            <div className="grid grid-cols-2 gap-2">
              {APPROVER_ROLES.map(role => (
                <div key={role} className="flex items-center gap-2">
                  <Checkbox
                    id={role}
                    checked={selectedRoles.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                  />
                  <Label htmlFor={role} className="text-sm font-normal cursor-pointer">
                    {ROLE_DISPLAY_NAMES[role]}
                  </Label>
                </div>
              ))}
            </div>
            {selectedRoles.length === 0 && (
              <p className="text-xs text-destructive">Select at least one approver role</p>
            )}
          </div>

          {/* Active Switch */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="isActive">Active</Label>
              <p className="text-xs text-muted-foreground">Enable this rule for new orders</p>
            </div>
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : (isEditMode ? 'Update Rule' : 'Create Rule')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
