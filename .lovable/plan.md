

## Plan: Penny-Precise Pricing + Payments/AR System in Profit Center

### Two Changes

---

### 1. Allow penny-precise pricing everywhere

**Problem**: Several places round selling price to whole dollars:
- `EstimateBreakdownCard.tsx` line 68: `Math.round(breakdown.sellingPrice)` when toggling fixed price — strips cents
- `EstimateHyperlinkBar.tsx` lines 211-217: `formatCurrency` uses `minimumFractionDigits: 0, maximumFractionDigits: 0` — displays without cents
- `ProfitCenterPanel.tsx` lines 136-142: same `formatCurrency` with 0 decimal digits
- `SavedEstimatesList.tsx`, `RepProfitBreakdown.tsx`, `OverheadTab.tsx`: same pattern

**Fix**: Change all `formatCurrency` functions in the estimates module to use `minimumFractionDigits: 2, maximumFractionDigits: 2`. Remove the `Math.round` on line 68 of `EstimateBreakdownCard.tsx` — keep `Math.max(100, breakdown.sellingPrice)` but don't round. The fixed price input already accepts `parseFloat` and passes decimal values through (line 79-81), so the storage path is fine.

**Files**:
| File | Change |
|------|--------|
| `EstimateBreakdownCard.tsx` | Remove `Math.round` on fixed price default |
| `EstimateHyperlinkBar.tsx` | `formatCurrency` → 2 decimal places |
| `ProfitCenterPanel.tsx` | `formatCurrency` → 2 decimal places |
| `SavedEstimatesList.tsx` | `formatCurrency` → 2 decimal places |
| `RepProfitBreakdown.tsx` | `formatCurrency` → 2 decimal places |
| `OverheadTab.tsx` | `formatCurrency` → 2 decimal places |
| `ProfitSlider.tsx` | `formatCurrency` → 2 decimal places |

---

### 2. Add Payments tab to Profit Center + Auto-create AR entry on project approval

This is a significant feature. Here's the approach:

#### Database (new migration)

Create a new `project_invoices` table for internal invoicing (not QBO-dependent) and a `project_payments` table for payment tracking:

```sql
CREATE TABLE project_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  pipeline_entry_id UUID NOT NULL,
  invoice_number TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance NUMERIC(12,2) NOT NULL,
  status TEXT DEFAULT 'draft', -- draft, sent, partial, paid, void
  due_date DATE,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE project_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  pipeline_entry_id UUID NOT NULL,
  invoice_id UUID REFERENCES project_invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT, -- check, card, ach, cash, financing
  reference_number TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Enable RLS on both tables using `tenant_id = get_user_tenant_id()`.

#### Auto-create AR entry on project approval

In `LeadDetails.tsx` `handleApproveToProject`, after setting status to 'project', automatically insert a `project_invoices` record with the full contract value (selling_price from the selected estimate) and balance = selling_price. This creates the initial AR entry.

#### Payments tab in ProfitCenterPanel

Add a "Payments" tab (alongside Summary, Invoices, Details, Budget) that shows:
- **Contract balance**: selling price minus total payments received
- **Invoice list**: all `project_invoices` for this pipeline entry with status badges
- **Create Invoice button**: generates an invoice for the remaining balance (or custom amount)
- **Record Payment button**: opens a form to record a payment (amount, method, date, reference #, optional invoice link)
- **Payment history**: chronological list of all payments received

#### Company-wide AR Dashboard

Create a new `AccountsReceivable` component accessible from the main nav (or a new page) that queries all `project_invoices` with outstanding balances across the tenant. Shows:
- Total AR outstanding
- Aging buckets (current, 30, 60, 90+ days)
- List of all projects with balances, sortable/filterable
- Quick link to each project's payment tab

#### Files to create/modify

| File | Change |
|------|--------|
| New migration | Create `project_invoices` and `project_payments` tables with RLS |
| `src/pages/LeadDetails.tsx` | Auto-insert initial invoice on project approval |
| `src/components/estimates/ProfitCenterPanel.tsx` | Add "Payments" tab with invoice/payment management |
| `src/components/estimates/PaymentsTab.tsx` | **New** — Payment recording, invoice creation, payment history |
| `src/pages/AccountsReceivable.tsx` | **New** — Company-wide AR dashboard page |
| `src/App.tsx` | Add route for `/accounts-receivable` |
| Navigation | Add AR link to main sidebar/nav |

### Technical notes

- The `project_invoices` table is independent of the QBO `invoice_ar_mirror` table — it works without QuickBooks
- Payments are linked to `pipeline_entry_id` (not `project_id`) since the lead/project page uses pipeline entries as the primary entity
- The auto-created invoice on approval uses the selected estimate's `selling_price` as the total amount
- All currency displays will use 2 decimal places for penny precision

