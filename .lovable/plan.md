

# Plan: Display Estimate Name on Cover Page

## Problem

The estimate cover page currently shows:
```
PROFESSIONAL
ROOFING ESTIMATE
```

The user wants:
1. Remove the "PROFESSIONAL" label above the title
2. Replace "ROOFING ESTIMATE" with the actual estimate name/type (e.g., "Owens Corning Duration", "Standing Seam Painted")

## Current Data Flow

```text
┌─────────────────────────────────────┐
│ MultiTemplateSelector               │
│ └── estimateDisplayName ────────────┼───┐
│     (user-editable input field)     │   │
└─────────────────────────────────────┘   │
                                          ▼
┌─────────────────────────────────────┐
│ EstimatePreviewPanel                │
│ └── estimateDisplayName             │
│     ├── used for PDF filename ✓     │
│     └── NOT passed to PDF document ✗│
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ EstimatePDFDocument                 │
│ └── NO estimate name prop exists    │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ EstimateCoverPage                   │
│ └── Shows hardcoded "ROOFING        │
│     ESTIMATE" text                  │
└─────────────────────────────────────┘
```

## Solution

Pass the estimate name through the component chain and display it on the cover page.

---

## Technical Implementation

### 1. Update EstimateCoverPage Props

**File:** `src/components/estimates/EstimateCoverPage.tsx`

Add new optional prop `estimateName` to the interface and use it in the title section:

```typescript
interface EstimateCoverPageProps {
  // ... existing props
  estimateName?: string;  // NEW: e.g., "Owens Corning Duration"
}
```

Update the title section (lines 103-110):

**Before:**
```tsx
{/* Title Section */}
<div className="text-center space-y-2 my-8">
  <p className="text-sm uppercase tracking-widest text-gray-500">Professional</p>
  <h2 className="text-5xl font-bold text-gray-900 tracking-tight">
    ROOFING ESTIMATE
  </h2>
  <div className="w-24 h-1 bg-primary mx-auto mt-4" />
</div>
```

**After:**
```tsx
{/* Title Section */}
<div className="text-center space-y-2 my-8">
  <h2 className="text-5xl font-bold text-gray-900 tracking-tight">
    {estimateName || 'ROOFING ESTIMATE'}
  </h2>
  <div className="w-24 h-1 bg-primary mx-auto mt-4" />
</div>
```

### 2. Update EstimatePDFDocument Props

**File:** `src/components/estimates/EstimatePDFDocument.tsx`

Add `estimateName` to the props interface and pass it to EstimateCoverPage.

**Interface update (around line 79):**
```typescript
interface EstimatePDFDocumentProps {
  // ... existing props
  estimateName?: string;  // NEW
}
```

**Pass to EstimateCoverPage (around line 409):**
```tsx
<EstimateCoverPage
  key="cover-page"
  companyInfo={companyInfo}
  companyLogo={companyLogo}
  companyName={companyName}
  customerName={customerName}
  customerAddress={customerAddress}
  estimateNumber={estimateNumber}
  createdAt={createdAt}
  propertyPhoto={opts.coverPagePropertyPhoto}
  estimateName={estimateName}  // NEW
/>
```

### 3. Update EstimatePreviewPanel

**File:** `src/components/estimates/EstimatePreviewPanel.tsx`

Pass `estimateDisplayName` to `EstimatePDFDocument`:

**Around line 576-594:**
```tsx
<EstimatePDFDocument
  estimateNumber={estimateNumber}
  estimateName={estimateDisplayName}  // NEW
  customerName={customerName}
  // ... rest of props
/>
```

---

## Visual Result

**Before:**
```
┌────────────────────────────────────────────────┐
│                  O'BRIEN LOGO                  │
│                                                │
│                 PROFESSIONAL                   │
│             ROOFING ESTIMATE                   │
│               ────────────                     │
│                                                │
│                 PREPARED FOR                   │
│               Nicole Walker                    │
└────────────────────────────────────────────────┘
```

**After:**
```
┌────────────────────────────────────────────────┐
│                  O'BRIEN LOGO                  │
│                                                │
│          Owens Corning Duration                │
│               ────────────                     │
│                                                │
│                 PREPARED FOR                   │
│               Nicole Walker                    │
└────────────────────────────────────────────────┘
```

If no estimate name is set, falls back to "ROOFING ESTIMATE".

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/EstimateCoverPage.tsx` | Add `estimateName` prop, remove "Professional" label, use prop for title |
| `src/components/estimates/EstimatePDFDocument.tsx` | Add `estimateName` prop, pass to EstimateCoverPage |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Pass `estimateDisplayName` to EstimatePDFDocument |

---

## Fallback Behavior

- If `estimateDisplayName` is empty → Shows "ROOFING ESTIMATE"
- Estimate name is displayed in title case as entered by user

