

# Fix: Signature Position to Align with "Customer Signature" Block

## Problem

The signature image and verification text are drawn at `sigY = 120` (120 points from the bottom of the page). This places them below the "Date: ___" line and into the footer area. They need to be moved UP to sit directly on the "Customer Signature" line.

In PDF coordinates (letter size = 612 x 792 points), Y=0 is the very bottom. The signature block ("Customer Signature" label, horizontal line, "Date: ___") sits roughly 25-30% from the bottom of the page, which translates to approximately Y=200-250.

## Current vs. Target Placement

```text
Current layout (wrong):                    Target layout (correct):
                                           
  Customer Signature    Company Rep          Customer Signature    Company Rep
  _______________       _______________      [signature image]     _______________
  Date: ___             Date: ___            _______________       _______________
                                             Jason Dudjak
                                             Date: 2/19/2026
  [signature image]  <-- too low             IP: 173.x.x.x
  Jason Dudjak
  Date: 2/19/2026
  IP: 173.x.x.x
  [FOOTER]                                   [FOOTER]
```

## Changes

### File: `supabase/functions/finalize-envelope/index.ts`

One change only -- adjust the signature Y coordinate and verification text positions:

| Current | New | Purpose |
|---|---|---|
| `sigY = 120` | `sigY = 215` | Move signature image UP to sit just above the horizontal signature line |
| Verification at `sigY - 14`, `sigY - 26`, `sigY - 37` | At `sigY - 65`, `sigY - 77`, `sigY - 88` | Place name, date, IP below the signature line (filling in the "Date: ___" area) |

The signature image will be drawn at Y=215 (just above the "Customer Signature" horizontal line), and the verification details will appear at Y=150-127 (just below the line, replacing the blank "Date: ___" text).

This applies to all three rendering paths (storage image, base64 image, plain text).

