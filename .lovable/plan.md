
## Goals
1. Add/update the **Master** user’s phone number to **7708420812** (stored in a usable format for Telnyx, ideally E.164).
2. Fix **public quote/estimate sharing** so opening `/view-quote/:token` reliably shows the PDF instead of the Storage `{"statusCode":404,"error":"not_found","message":"Object not found"}` response.

## What’s happening (root causes)
### A) Phone number
- `track-quote-view` only sends SMS notifications if `profiles.phone` is present.
- Your Settings UI currently doesn’t expose a clear “My phone number” field, so Master’s `profiles.phone` stays null.

### B) Share link PDF failing
- Estimate PDFs are uploaded to **Supabase Storage bucket `documents`** using paths like:
  `"{pipelineEntryId}/estimates/{estimateNumber}.pdf"` (see `saveEstimatePdf`).
- That bucket is **private** (`public = false` in migrations), so building a **public URL** and embedding it in `<object data="...">` returns **404 Object not found** even when the file exists.
- The edge function `track-quote-view` currently does:
  - `getPublicUrl(storagePath)` for estimate PDFs, which is not valid for a private bucket.
- Result: the quote page loads the “shell” (company + pricing) but the PDF viewer renders the Storage 404 JSON.

## Implementation plan (code changes)
### 1) Add “My Profile” phone editor (so Master can set 7708420812)
**Where**
- `src/components/settings/GeneralSettings.tsx` (add a new “Your Profile” card near the top)

**What**
- Load the current user’s profile (at minimum: `id, first_name, last_name, email, phone`).
- Add an input for phone number and a “Save” button.
- On save:
  - Normalize the phone (simple sanitizer: remove non-digits; if 10 digits → `+1${digits}`; if already starts with `+` keep; otherwise validate and show error).
  - `supabase.from('profiles').update({ phone: normalized }).eq('id', user.id)`
  - Show toast success/error.
  - Trigger a profile refresh (use `useCurrentUser().refetch()` or invalidate whatever query/context backs `useUserProfile`).

**Why this solves it**
- Master can immediately set `7708420812` (stored as `+17708420812`), and all quote view SMS notifications will start sending.

**Acceptance checks**
- After saving, the UI shows the stored phone.
- Trigger a quote view → `track-quote-view` logs “SMS notification sent …” (and you receive the SMS).

---

### 2) Fix `/view-quote/:token` PDF URL generation for private Storage
**Where**
- `supabase/functions/track-quote-view/index.ts`

**What**
- Replace the `getPublicUrl()` logic with **signed URL generation** for Storage paths in private buckets.
- Implement a small helper inside the function:

  - If `pdf_url` value is:
    - `null` → return `null`
    - starts with `http://` or `https://` → treat as already usable URL and return as-is
    - otherwise treat as a Storage path and call:
      - `supabase.storage.from('documents').createSignedUrl(path, 60 * 60)` (1 hour)
      - if that errors, log and return `null` (and optionally include a friendly error string)

- Apply this helper to:
  1) `trackingLink.pdf_url` (if present)
  2) fallback `trackingLink.enhanced_estimates.pdf_url` (which is actually a Storage path in your system)

**Why this solves it**
- The public quote page will always receive a **real, accessible URL** for the PDF even though the bucket is private.

**Acceptance checks**
- Open a sent link in an incognito window:
  - PDF renders inside the viewer (no 404 JSON)
  - Download button works
- Edge logs show signed-url creation success (no storage errors)

---

### 3) Make the ViewQuote page resilient if PDF is missing/unavailable
**Where**
- `src/pages/ViewQuote.tsx`

**What**
- If `quote.pdf_url` is null/empty (or the viewer errors), show a clear fallback panel:
  - “We couldn’t load the document. Please contact us.”
  - Optionally show a “Open in new tab” button only when URL exists.

**Why**
- Prevents a confusing “PDF box with raw JSON error” experience.

**Acceptance checks**
- If Storage path is wrong/missing, the page shows a friendly error block rather than a broken embedded object.

---

## Data update for Master (7708420812)
After the profile phone editor is added:
- Go to **Settings → General → Your Profile**
- Enter `7708420812`
- Save → it will store as `+17708420812` for best Telnyx compatibility.

(If you prefer, we can also add a small “Format as US (+1)” hint in the UI.)

---

## Testing plan (end-to-end)
1. In-app: set phone to `7708420812` → confirm saved.
2. Send a quote email (creates tracking link).
3. Open the link externally/incognito:
   - PDF loads
   - Download works
4. Open the same link again:
   - `view_count` increments
   - SMS notification is received on the Master number

---

## Files to change
- `src/components/settings/GeneralSettings.tsx` (add profile phone UI + save)
- `supabase/functions/track-quote-view/index.ts` (signed URL generation for private bucket)
- `src/pages/ViewQuote.tsx` (fallback UI for missing/unavailable PDFs)

## Notes / risks
- Signed URLs expiring after 1 hour is fine because `ViewQuote` fetches a fresh one on page load. If you want long viewing sessions, we can raise TTL to e.g. 6 hours.
- This approach keeps `documents` bucket private (good security) while still enabling controlled external access via signed URLs.
