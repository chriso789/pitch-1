

# Mobile WebView Compatibility Upgrade -- Architecture Reality Check and Plan

## Important Context

This project is **React + Vite + Supabase** (client-side SPA), **not Next.js**. There is no server-side middleware, no API routes, and no ability to set HTTP cookies from the frontend. The prompt assumes Next.js patterns that don't apply here.

Here's what we **can** and **cannot** do, and the adapted plan for the actual stack.

---

## What Cannot Be Done (and Why)

| Requested Feature | Why Not Possible |
|---|---|
| `Set-Cookie: pitchcrm_session` with httpOnly | No server-side rendering -- Vite serves static files. Supabase auth uses localStorage JWTs, not cookies. |
| `middleware/auth.ts` intercepting requests | No server middleware in Vite/SPA architecture. |
| `X-Frame-Options` / CSP headers from code | These are set at the hosting/CDN level, not in React code. |
| `/api/*` routes | No API layer -- all backend logic goes through Supabase Edge Functions. |

## Adapted Plan for Vite + Supabase + Capacitor

### Step 1: Mobile App Detection Utility
Extend `src/utils/mobileDetection.ts` to detect the native WebView via user-agent string `PitchCRM-iOS`. Add `isMobileApp()` and `isNativeWebView()` functions.

### Step 2: Mobile Entry Route `/app/mobile`
Add a new route in `App.tsx` that:
- If authenticated, redirects to `/dashboard`
- If not, redirects to `/login`
- Skips marketing/landing content
- Sets a sessionStorage flag so the app knows it launched from native

### Step 3: Session Validation Edge Function
Create `supabase/functions/mobile-session/index.ts`:
- `GET` with Bearer token returns `{ authenticated, userId, companyId, expiresAt }`
- The iOS app calls this after FaceID unlock to verify the Supabase JWT is still valid
- Uses `verify_jwt = false` with manual `getClaims()` validation

### Step 4: Deep Link Resolver Route
Add a `/deeplink` route in the React app that parses `pitchcrm://` scheme URLs passed as query params and redirects to the correct internal route (`/jobs/:id`, `/contacts/:id`, etc.).

### Step 5: Mobile Device Registration (Push Prep)
Create `mobile_devices` table via migration:
- `id`, `user_id`, `device_id`, `push_token`, `platform`, `created_at`, `updated_at`
- RLS: users can only read/write their own devices

Create `supabase/functions/register-mobile-device/index.ts` to upsert device records.

### Step 6: Camera Upload Endpoint (Prep)
Create `supabase/functions/mobile-upload/index.ts`:
- Accepts multipart file upload with `jobId`
- Stores in existing `documents` storage bucket under `{tenant_id}/jobs/{jobId}/`
- Returns the public URL

### Step 7: Mobile UX Adaptations
Update `ProtectedRoute` and layout components to check `isMobileApp()`:
- Collapse sidebar by default
- Hide marketing banners
- Show mobile-specific upload buttons (placeholder)

### Step 8: Session Persistence for WebView
The existing Supabase client already uses `localStorage` with `persistSession: true` and `autoRefreshToken: true`. WKWebView preserves localStorage between launches by default. The existing `sessionPersistence.ts` refresh logic and 30-day "Remember Me" duration already cover this use case. No cookie system needed -- the JWT in localStorage **is** the persistent session.

### Step 9: Security Hardening
- Add JWT expiry check to the mobile-session endpoint
- Add device session logging (tie login events to device fingerprint, already partially implemented)
- Ensure logout clears all localStorage (already implemented in `clearAllSessionData`)

---

## Files to Create/Modify

| File | Action |
|---|---|
| `src/utils/mobileDetection.ts` | Add `isMobileApp()`, `isNativeWebView()` |
| `src/pages/MobileEntry.tsx` | New -- `/app/mobile` route |
| `src/App.tsx` | Add `/app/mobile` and `/deeplink` routes |
| `src/pages/DeepLinkResolver.tsx` | New -- parse deep link params, redirect |
| `supabase/functions/mobile-session/index.ts` | New -- session validation endpoint |
| `supabase/functions/register-mobile-device/index.ts` | New -- push token registration |
| `supabase/functions/mobile-upload/index.ts` | New -- camera file upload |
| `supabase/config.toml` | Register 3 new edge functions |
| Migration SQL | Create `mobile_devices` table with RLS |
| Layout components | Conditional mobile UX tweaks |

## What the iOS App Should Do

1. Store the Supabase JWT (from login response) in the iOS Keychain
2. On launch, inject the JWT into WKWebView's localStorage before loading the URL
3. Load `https://pitch-1.lovable.app/app/mobile`
4. Call the `mobile-session` edge function after FaceID to verify token validity
5. If expired, redirect to `/login`

This approach works with the existing Supabase auth system without requiring cookies or server middleware.

