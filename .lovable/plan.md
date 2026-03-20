

# Deduplicate Cover Page & Warranties for Multi-Estimate Preview

## Problem
When multiple estimates are selected, each `EstimatePDFDocument` renders its own cover page, warranty pages, and terms — creating redundant content. The user wants: **one cover page → all estimate content pages → one set of warranty/terms at the end**.

## Approach

### `EstimatePDFDocument.tsx` — Add a `renderMode` prop

Add an optional prop to control which sections render:
- `'full'` (default) — renders everything (cover + content + warranties + terms)
- `'content-only'` — renders only the estimate content pages (scope table with estimate name banner, pricing summary). Skips cover page, warranty pages, terms, and signature block.

Implementation: In the `useMemo` page-building logic (~line 473), when `renderMode === 'content-only'`:
- Skip the cover page block (line 517-534)
- Skip warranty pages (line 503-505 → empty array)
- Skip terms/signature on content pages (`showTerms = false`, hide signature)
- Still render the estimate name banner and all scope/pricing content

### `EstimatePreviewPanel.tsx` — Orchestrate rendering (~line 1244-1300)

Change the multi-estimate rendering:
1. **Primary estimate** renders with `renderMode="full"` (as today) — gets cover page, content, warranties, terms
2. **Additional estimates** render with `renderMode="content-only"` — only their scope pages with the bold estimate name banner inserted between the primary content and the trailing warranty/terms

But this creates an ordering issue: the primary estimate's warranties render at the end of its own `EstimatePDFDocument`, then additional estimate content comes after. To fix this:

- The **primary estimate** also uses a new mode: `'primary-multi'` which renders cover + content but **defers** warranty/terms
- Additional estimates use `'content-only'`
- After all estimate content, render a **single** warranty/terms section

Simplified approach: Add two props instead of modes:
- `skipCoverPage?: boolean` — additional estimates set this to `true`
- `skipWarrantyAndTerms?: boolean` — all estimates except the last set this to `true`

Then in the preview panel:
- Primary estimate: `skipWarrantyAndTerms={hasAdditionalEstimates}`
- Additional estimates: `skipCoverPage={true}`, `skipWarrantyAndTerms={isNotLast}`
- Last estimate (or primary if solo): renders warranty + terms normally

## Changes

### File: `src/components/estimates/EstimatePDFDocument.tsx`
- Add `skipCoverPage?: boolean` and `skipWarrantyAndTerms?: boolean` to props interface
- In page-building `useMemo`: when `skipCoverPage`, skip cover page block; when `skipWarrantyAndTerms`, skip warranty pages and terms/signature rendering

### File: `src/components/estimates/EstimatePreviewPanel.tsx`
- Primary estimate (~line 1245): pass `skipWarrantyAndTerms={selectedAdditionalIds.size > 0}`
- Additional estimates (~line 1278): pass `skipCoverPage={true}` and `skipWarrantyAndTerms={idx < lastIdx}` (last additional estimate renders warranties/terms)

