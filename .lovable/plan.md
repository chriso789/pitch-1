I found the likely issue: the app is sending the SRS token request as JSON, but the SRS auth endpoint is behaving like it is reading form-encoded OAuth fields, so it returns `client_id is required` even though the value exists in the UI/database.

Plan:
1. Update `supabase/functions/srs-api-proxy/index.ts` so `/authentication/token` sends the OAuth token request as `application/x-www-form-urlencoded` using `client_id`, `client_secret`, `grant_type=client_credentials`, and `scope=ALL`.
2. Add a safe preflight validation in the edge function that returns a clear local error if `client_id` or `client_secret` is actually blank, without exposing secret values.
3. Keep the existing environment switch and customer validation flow unchanged.
4. Update the user-facing SRS settings error copy so this specific error points to token request formatting/credentials instead of assuming the Client ID field is empty.
5. Deploy the updated `srs-api-proxy` edge function so the live test button uses the fix.