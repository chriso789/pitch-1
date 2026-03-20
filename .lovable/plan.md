

# Fix Page Overflow for Items with Descriptions

## Problem
The pagination logic uses fixed row counts (`MAX_ROWS_FIRST_PAGE = 12`, `MAX_ROWS_CONTINUATION = 16`) treating every item as 1 row. But items with descriptions take 2-3x the vertical space, causing the "5V Metal Mill Finish" estimate to overflow its fixed-height page container (`maxHeight: 1056px`).

## Solution
Make the chunking logic description-aware by counting items with descriptions as more than 1 row.

## Changes

### File: `src/components/estimates/EstimatePDFDocument.tsx`

**1. Update `chunkRenderBlocks` to be description-aware:**

Modify the function signature to accept `opts: PDFComponentOptions`. When counting toward the page limit, an item block with a non-empty `description` (and `opts.showItemDescriptions` is true) counts as 2.5 rows instead of 1. Headers/sub-headers still count as 1.

```typescript
function chunkRenderBlocks(blocks: RenderBlock[], firstPageMax: number, continuationMax: number, opts?: PDFComponentOptions): RenderBlock[][] {
  // ...
  const blockWeight = (b: RenderBlock) => {
    if (b.type === 'item' && b.item?.description && opts?.showItemDescriptions) {
      // Long descriptions get extra weight
      const descLen = b.item.description.length;
      return descLen > 120 ? 3 : 2;
    }
    return 1;
  };
  // Use weighted sum instead of count for page-fit check
}
```

**2. Update `chunkItems` to pass `opts` through:**
```typescript
function chunkItems(items, firstPageMax, continuationMax, opts?) {
  const blocks = buildRenderBlocks(items);
  const blockChunks = chunkRenderBlocks(blocks, firstPageMax, continuationMax, opts);
  // ...
}
```

**3. Update call site (~line 504):**
```typescript
const { itemChunks, blockChunks } = chunkItems(scopeItems, MAX_ROWS_FIRST_PAGE, MAX_ROWS_CONTINUATION, opts);
```

This ensures pages with description-heavy items split earlier, preventing overflow.

