

# Marketing Assets & Facebook Product Feed Generator

## What You Need
Downloadable promotional materials for advertising PITCH CRM on Facebook — including ad copy, product catalog feed (for Facebook Commerce Manager), and a marketing asset download page.

## Plan

### 1. Create a Marketing Downloads Page (`/marketing-assets`)
A new page (accessible from settings or a direct link) with downloadable marketing files:

- **Facebook Product Catalog Feed (CSV)** — Formatted to Facebook's Commerce Manager spec (`id`, `title`, `description`, `availability`, `condition`, `price`, `link`, `image_link`, `brand`)
- **Ad Copy Pack (TXT/Markdown)** — Pre-written Facebook ad copy with headlines, primary text, and CTAs for 5 campaign types (Lead Gen, Retargeting, Testimonial, Feature Highlight, Savings)
- **Brand Guidelines Summary (PDF)** — Company colors, logo usage, tagline, fonts

### 2. Facebook Product Catalog CSV Generator
Auto-generates a CSV with PITCH CRM's features as "products" formatted to Facebook's catalog spec:
- Each major feature (Power Dialer, Estimates, Pipeline, etc.) as a line item
- Pulls data from the existing `features`, `benefits`, and `replaces` arrays in LandingPage
- Includes `link` pointing to `https://pitch-1.lovable.app` and relevant sections
- Download button triggers browser CSV download

### 3. Ad Copy Generator
Pre-built ad copy templates pulled from landing page data:
- **5 campaign templates**: Awareness, Feature Demo, Testimonial Proof, Cost Savings, Free Trial
- Each includes: Headline (40 char), Primary Text (125 char), Description, CTA
- Download as `.txt` file

### 4. Route & Navigation
- Add route `/marketing-assets` in `App.tsx`
- Link from Settings or Facebook Marketing Dashboard page
- No auth required (marketing team may not have accounts)

### Files to Create/Modify
| File | Change |
|---|---|
| `src/pages/MarketingAssetsPage.tsx` | New page with download buttons for all assets |
| `src/lib/marketing-export.ts` | Utility functions to generate Facebook catalog CSV + ad copy files |
| `src/App.tsx` | Add route |

