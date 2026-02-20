

# Professional Email & Signing Experience Overhaul

## Problem
The signature request emails and signing pages use intimidating, "forceful" language like "legally binding," "Document Signature Request," and yellow warning banners that make the experience feel like a legal threat rather than a professional business proposal. This causes recipients to distrust the email and treat it as spam.

## What Changes

### 1. Signature Request Email (`supabase/functions/email-signature-request/index.ts`)

**Current issues:**
- Header says "Document Signature Request" -- sounds like a legal summons
- Yellow warning box says "Your signature is legally binding" -- intimidating
- Tone is impersonal and transactional
- No company logo in the header
- Footer says "Sent via [Company]" instead of being **from** the company

**New design:**
- Header: Show company logo + company name (not "Document Signature Request")
- Subject line: Already uses custom subject from the frontend, no change needed
- Body: Warm, inviting tone -- "We've prepared your project proposal for review"
- Remove the yellow "legally binding" warning box entirely
- Replace with a subtle, friendly note: "This secure link was created just for you and is valid for 30 days."
- Footer: Show full company contact info (name, phone, email) instead of just "Sent via"
- Add company logo to the header banner

### 2. Quote Email (`supabase/functions/send-quote-email/index.ts`)

This email is already decent but will get minor polish:
- Keep the existing professional structure (it's the better of the two)
- No "legally binding" language present -- no changes needed here

### 3. Report Packet Email (`supabase/functions/report-packet-send-resend/index.ts`)

- Currently generic ("Your Report Package is Ready") -- add company logo
- Fetch tenant logo_url for the header
- Minor polish to match the signature email styling

### 4. Frontend Signing Pages

**`src/pages/SignDocument.tsx` (line 212-214):**
- Remove: "Your signature will be legally binding."
- Replace with: "By signing, you confirm your acceptance of the terms outlined in this document."

**`src/pages/PublicSignatureCapture.tsx` (line 463-466):**
- Remove: "your electronic signature is legally binding"
- Replace with: "By signing, you confirm your approval of this document."

### 5. Backend Consent Text (`supabase/functions/report-packet-sign/index.ts`, line 126)

- Change default consent text from "I agree that this signature is legally binding..." to "I agree to the terms outlined in this document and authorize my electronic signature."

## Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/email-signature-request/index.ts` | Redesign email HTML -- add logo, warm tone, remove "legally binding" warning |
| `src/pages/SignDocument.tsx` | Remove "legally binding" from footer text |
| `src/pages/PublicSignatureCapture.tsx` | Soften legal notice language |
| `supabase/functions/report-packet-sign/index.ts` | Update default consent_text |
| `supabase/functions/report-packet-send-resend/index.ts` | Add company logo, fetch tenant branding |

## Email Before vs After (Signature Request)

**Before:**
- Header: "Document Signature Request" (dark blue gradient, no logo)
- Yellow warning: "Your signature is legally binding"
- Footer: "Sent via [Company]"

**After:**
- Header: Company logo + company name (branded gradient)
- Warm message: "[Sender] at [Company] has prepared a proposal for your review."
- Soft note: "This secure link was created just for you and is valid for 30 days."
- Footer: Full company info -- name, phone, email
- CTA button: "Review Your Proposal" (instead of "Review & Sign Document")

