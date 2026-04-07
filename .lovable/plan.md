

## Update Edge Functions to Use pitchcrm.app Domain

The signing links, proposal review buttons, and share URLs should all point to `https://pitchcrm.app` since that's your purchased and connected domain.

### Changes

1. **Update `email-signature-request/index.ts`** - Change fallback URL from `https://pitch-1.lovable.app` to `https://pitchcrm.app`
2. **Update `create-share-link/index.ts`** - Change fallback URL from `https://pitch-1.lovable.app` to `https://pitchcrm.app`  
3. **Update `send-signature-envelope/index.ts`** - Change fallback URL from `https://pitch-1.lovable.app` to `https://pitchcrm.app`
4. **Set `FRONTEND_URL` Supabase secret** to `https://pitchcrm.app` so all functions use the correct domain dynamically
5. **Redeploy** all three edge functions
6. **Fix AR action buttons** - Verify and fix visibility of the dropdown menu in AccountsReceivable.tsx

### Result
- "Review Your Proposal" button in emails will link to `https://pitchcrm.app/sign/...` which resolves to your app
- All share links will use the correct domain
- AR actions will be visible and functional

