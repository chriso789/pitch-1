# Dual-Signature Flow (Client + Representative)

## What you'll see
1. **Settings → My Signature** — each user draws or uploads their signature once. Stored privately and reused on every document they send.
2. **Send envelope** — client gets the link and signs (unchanged).
3. **After client signs** — the envelope status changes to **"Awaiting Countersignature"** instead of "Completed". The sending rep sees a **"Countersign & Finalize"** button on the envelope/estimate.
4. **Rep clicks Countersign** — their saved signature is auto-stamped to the right of the client's, the PDF is recompiled with both signatures + dates + IPs, and the envelope is marked Completed. The customer receives the fully-signed copy.
5. **Final PDF** — bottom-of-page signature block now shows two side-by-side signatures:
   - Left: Customer (name, date, IP)
   - Right: Authorized Representative (name, date, IP) under the company name

## Technical details

**Schema**
- Add `signature_image_path TEXT` and `signature_updated_at TIMESTAMPTZ` to `profiles`.
- New private storage bucket `user-signatures` with RLS `{auth.uid()}/...` path scope.
- Add envelope status value `awaiting_countersignature` (string column, no enum change needed).

**Frontend**
- New page `src/pages/settings/MySignature.tsx` with a signature pad (reuse `SignatureCapture` canvas logic) + upload option + preview of saved sig. Route registered under settings.
- Envelope/estimate detail: when `signature_envelopes.status === 'awaiting_countersignature'` AND `auth.uid() === envelope.created_by`, render a "Countersign & Finalize" button. Disable + show tooltip "Set up your signature in Settings → My Signature" if profile has no signature.

**Edge functions**
- Modify `finalize-envelope`: after stamping client signatures, instead of setting `status='completed'`, set `status='awaiting_countersignature'` and skip the final customer email. The interim signed PDF is still saved to documents.
- New `countersign-envelope` function: loads the rep's `profiles.signature_image_path`, opens the latest signed PDF, stamps the rep's signature in the right-half of the signature block on the same target page, recompiles, replaces the document, marks envelope `completed`, and sends the final email to the customer.

**PDF layout (in both functions)**
- Reuse the existing `signature_anchor` for X/Y/page. Client signature occupies left half (`sigX` to `sigX + maxSigWidth`). Rep signature is placed at `sigX + (anchor.widthPt / 2) + 20` with label "Authorized Representative" and the sender's `full_name` / company name from `profiles` + `tenants`.

**Out of scope**
- Existing in-flight envelopes stay in their current state; only new finalizations use the new flow.
- No change to the customer-facing signing page.