
# Implementation Plan: Complete Approval Rules CRUD & Status Summary

## Summary

Based on my analysis, **4 of the 5 requested features are already implemented**:

| Feature | Status | Evidence |
|---------|--------|----------|
| Labor Line Items Tab | **Done** | `LaborLineItemForm` component exists in `AddEstimateLineDialog.tsx` |
| PDF Download in ProposalBuilder | **Done** | Uses `downloadProposalPdf()` with html2canvas + jsPDF |
| Dialer SMS/Email Buttons | **Done** | `QuickSMSDialog` and `QuickEmailDialog` integrated |
| Send for Signature | **Done** | `RequestSignatureDialog` integrated with SmartDocs |
| Approval Rules CRUD | **Incomplete** | Buttons show "coming soon" toasts |

This plan covers only the **Approval Rules CRUD** implementation.

---

## Feature: Approval Rules CRUD Operations

### Current State

The `ApprovalRules.tsx` page displays rules from the `purchase_order_approval_rules` table but has placeholder handlers:
- Line 101: `toast.info('Add rule dialog coming soon')`
- Line 177: `toast.info('Edit coming soon')`
- Line 183: `toast.info('Delete coming soon')`

### Database Schema (Already Exists)

```sql
purchase_order_approval_rules:
  - id: UUID
  - tenant_id: UUID
  - rule_name: TEXT
  - min_amount: DECIMAL
  - max_amount: DECIMAL (nullable)
  - required_approvers: JSONB (array of role names)
  - approval_type: TEXT (any, sequential, parallel)
  - is_active: BOOLEAN
  - created_by: UUID
  - created_at: TIMESTAMP
```

---

## Files to Create

### 1. `src/components/approvals/ApprovalRuleDialog.tsx`

A unified dialog for Create and Edit operations.

**Props:**
```typescript
interface ApprovalRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: ApprovalRule | null; // null = create mode, object = edit mode
  onSuccess: () => void;
}
```

**Form Fields:**
| Field | Type | Validation |
|-------|------|------------|
| Rule Name | Text Input | Required, max 100 chars |
| Min Amount | Number Input | Required, >= 0 |
| Max Amount | Number Input | Optional, must be > min_amount if set |
| Approval Type | Select | Required: any, sequential, parallel |
| Required Approvers | Multi-select Checkbox | At least one role selected |
| Active | Switch/Checkbox | Default: true |

**Approver Role Options (from roleUtils.ts):**
- Office Admin
- Regional Manager
- Sales Manager
- Project Manager
- Owner
- Corporate

**UI Layout:**
```text
┌───────────────────────────────────────────────────┐
│  Create Approval Rule  /  Edit Approval Rule      │
├───────────────────────────────────────────────────┤
│  Rule Name:     [________________________]        │
│                                                   │
│  Amount Range:                                    │
│  ┌─────────────────┐   ┌─────────────────┐       │
│  │ Min: $[______]  │ → │ Max: $[______]  │       │
│  └─────────────────┘   └─────────────────┘       │
│  ☐ No maximum (unlimited)                        │
│                                                   │
│  Approval Type:  [Any ▾]                         │
│  • Any: One approver is sufficient               │
│  • Sequential: Must approve in order             │
│  • Parallel: All must approve (any order)        │
│                                                   │
│  Required Approvers:                             │
│  ☑ Office Admin                                  │
│  ☑ Regional Manager                              │
│  ☐ Sales Manager                                 │
│  ☐ Project Manager                               │
│  ☐ Owner                                         │
│  ☐ Corporate                                     │
│                                                   │
│  ☑ Active                                        │
│                                                   │
│            [Cancel]  [Save Rule]                 │
└───────────────────────────────────────────────────┘
```

---

### 2. `src/components/approvals/DeleteApprovalRuleDialog.tsx`

A confirmation dialog for deletion.

**Props:**
```typescript
interface DeleteApprovalRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: ApprovalRule | null;
  onSuccess: () => void;
}
```

**UI Layout:**
```text
┌───────────────────────────────────────────────────┐
│  ⚠ Delete Approval Rule                          │
├───────────────────────────────────────────────────┤
│                                                   │
│  Are you sure you want to delete                 │
│  "Medium Orders ($5,000 - $25,000)"?             │
│                                                   │
│  This action cannot be undone. Any pending       │
│  purchase orders using this rule will need       │
│  to be reassigned.                               │
│                                                   │
│            [Cancel]  [Delete]                    │
└───────────────────────────────────────────────────┘
```

---

## Files to Modify

### 1. `src/pages/ApprovalRules.tsx`

**Changes:**
1. Import the new dialog components
2. Add state for dialog visibility and selected rule
3. Connect button handlers to dialogs
4. Add delete mutation with confirmation

**State Additions:**
```typescript
const [createDialogOpen, setCreateDialogOpen] = useState(false);
const [editDialogOpen, setEditDialogOpen] = useState(false);
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [selectedRule, setSelectedRule] = useState<ApprovalRule | null>(null);
```

**Handler Updates:**
```typescript
// Line 101: Add Rule button
onClick={() => setCreateDialogOpen(true)}

// Line 122: Empty state button
onClick={() => setCreateDialogOpen(true)}

// Line 177: Edit button
onClick={() => {
  setSelectedRule(rule);
  setEditDialogOpen(true);
}}

// Line 183: Delete button
onClick={() => {
  setSelectedRule(rule);
  setDeleteDialogOpen(true);
}}
```

---

## Implementation Details

### Create Rule Logic

```typescript
const handleCreateRule = async (formData: ApprovalRuleFormData) => {
  // Get tenant_id from user profile
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user?.id)
    .single();

  const { error } = await supabase
    .from('purchase_order_approval_rules')
    .insert({
      tenant_id: profile.tenant_id,
      rule_name: formData.ruleName,
      min_amount: formData.minAmount,
      max_amount: formData.noMaximum ? null : formData.maxAmount,
      required_approvers: formData.selectedRoles,
      approval_type: formData.approvalType,
      is_active: formData.isActive,
      created_by: user?.id
    });

  if (error) throw error;
  toast.success('Approval rule created');
  fetchRules(); // Refresh list
};
```

### Edit Rule Logic

```typescript
const handleEditRule = async (ruleId: string, formData: ApprovalRuleFormData) => {
  const { error } = await supabase
    .from('purchase_order_approval_rules')
    .update({
      rule_name: formData.ruleName,
      min_amount: formData.minAmount,
      max_amount: formData.noMaximum ? null : formData.maxAmount,
      required_approvers: formData.selectedRoles,
      approval_type: formData.approvalType,
      is_active: formData.isActive
    })
    .eq('id', ruleId);

  if (error) throw error;
  toast.success('Approval rule updated');
  fetchRules();
};
```

### Delete Rule Logic

```typescript
const handleDeleteRule = async (ruleId: string) => {
  const { error } = await supabase
    .from('purchase_order_approval_rules')
    .delete()
    .eq('id', ruleId);

  if (error) throw error;
  toast.success('Approval rule deleted');
  fetchRules();
};
```

---

## Validation Rules

1. **Rule Name**: Required, 2-100 characters
2. **Min Amount**: Required, must be >= 0
3. **Max Amount**: If provided, must be > min_amount
4. **Required Approvers**: At least one role must be selected
5. **No Overlapping Ranges**: Warn if new rule overlaps existing amounts

---

## File Summary

| Action | File |
|--------|------|
| Create | `src/components/approvals/ApprovalRuleDialog.tsx` |
| Create | `src/components/approvals/DeleteApprovalRuleDialog.tsx` |
| Modify | `src/pages/ApprovalRules.tsx` |

---

## Testing Checklist

1. Create a new approval rule with all fields
2. Verify rule appears in the table immediately
3. Edit an existing rule and change the amount range
4. Toggle the active status on/off
5. Delete a rule and confirm it's removed
6. Verify validation prevents invalid inputs
7. Check that multi-role selection works correctly
