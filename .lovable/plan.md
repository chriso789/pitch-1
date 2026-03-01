

# Cleaner Estimate Page Splits

## Problem
From the screenshot:
1. When scope overflows to a second page, the continuation page shows both "Project Scope (continued)" AND a second "Project Scope" header from the ItemsTable — redundant double headers
2. No indication on the first page that items continue on the next page (homeowner might think the quote ends there)

## Changes

### A. `EstimatePDFDocument.tsx` — ItemsContinuationPage (~line 661-676)
- Remove the hardcoded "Project Scope (continued)" `<h3>` from `ItemsContinuationPage` since `ItemsTable` already renders its own "Project Scope" header
- Instead, pass a prop to `ItemsTable` so it renders "Project Scope (continued)" as its header on continuation pages (avoiding the duplicate)

### B. `EstimatePDFDocument.tsx` — ItemsTable (~line 710-715)
- Accept an optional `continued` prop
- When `continued=true`, render header as "Project Scope (continued)" instead of "Project Scope"

### C. `EstimatePDFDocument.tsx` — FirstPage (~line 636-638)
- When `isOnlyChunk` is `false` (items overflow), add a one-liner at the bottom of the first page in light italic text:
  `"Scope continues on next page..."`
- Style: `text-[10px] text-gray-400 italic text-right mt-2`

