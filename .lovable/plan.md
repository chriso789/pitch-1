# Switch Supplier Quote Parser off Lovable AI Credits

## Problem
The "Upload Supplier Quote" button on the estimate page calls the `parse-supplier-quote` edge function, which hits the Lovable AI Gateway (`google/gemini-2.5-flash`). When the workspace AI balance is empty, the gateway returns 402 and the UI shows "AI credits exhausted - please add funds". The feature was never converted to bypass Lovable credits.

## Solution
Re-route `parse-supplier-quote` to call OpenAI directly using a project secret (`OPENAI_API_KEY`), so it consumes the user's own OpenAI billing instead of Lovable AI credits. No UI/UX changes — same button, same merge behavior.

## Steps

1. **Add secret** — request `OPENAI_API_KEY` via the secrets tool (user pastes their key once).

2. **Rewrite `supabase/functions/parse-supplier-quote/index.ts`**:
   - Keep existing pdfjs text extraction, signed-URL fetch, and tool-calling JSON schema (unchanged).
   - Replace the `https://ai.gateway.lovable.dev/...` call with `https://api.openai.com/v1/chat/completions` using `Authorization: Bearer ${OPENAI_API_KEY}`.
   - Use `gpt-4o-mini` (cheap, strong at structured extraction, vision-capable for image fallback).
   - Preserve the existing `tools` / `tool_choice` payload shape — OpenAI accepts it as-is.
   - Update 429 / 402 / generic error messages to say "OpenAI" instead of "AI credits".
   - Fail fast with a clear message if `OPENAI_API_KEY` is missing.

3. **No frontend changes** — `SupplierQuoteUploader.tsx` already surfaces the edge function's error string verbatim, so the new error copy flows through automatically.

4. **Verify** — deploy the function, upload a quote PDF on the Fonsica lead, confirm parse succeeds and no Lovable 402 appears.

## Out of scope
- Other AI features (invoice parser, AI admin, measurement pipeline) keep using Lovable AI.
- No deterministic/regex fallback parser.
- No role-gating of the upload button.
