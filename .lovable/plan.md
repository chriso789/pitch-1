

## Fix Landing Page Routes + Update Pricing to $50/user/month

### Root Cause: All Public Routes Are Broken

Every public route (`/pricing`, `/features`, `/demo-request`, `/request-setup-link`) renders a **blank page**. Verified by navigating to each one in the browser.

**Why:** In `App.tsx`, routes like `<Route path="/pricing" element={<PublicRoutes />} />` mount PublicRoutes at an exact path. But inside `PublicRoutes`, there's a nested `<Routes>` component that also tries to match `path="/pricing"`. React Router v6 strips the matched prefix before passing to child Routes, so the inner route sees `""` but tries to match `/pricing` -- which fails silently, rendering nothing.

### Audit Results -- All Landing Page Links

| Link | Target | Status | Issue |
|------|--------|--------|-------|
| Nav "Features" | `/features` | BROKEN | Blank page (routing bug) |
| Nav "Pricing" | `/pricing` | BROKEN | Blank page (routing bug) |
| Nav "Log In" | `/login` | Works | Direct route in App.tsx |
| Nav "Start Free Trial" | `/signup` | Works | Direct route in App.tsx |
| Hero "Start Free Trial" | `/signup` | Works | |
| Hero "Watch Demo" | Modal | Works | |
| Footer "Features" | `/features` | BROKEN | Same routing bug |
| Footer "Pricing" | `/pricing` | BROKEN | Same routing bug |
| Footer "Integration" | `/integration` | BROKEN | No route exists at all |
| Footer "Request Demo" | `/demo-request` | BROKEN | Same routing bug |
| Footer "Contact" | `/demo-request` | BROKEN | Same routing bug |
| Footer "Support" | `/help` | Goes to protected route (requires auth) |
| Footer "Privacy Policy" | `/legal/privacy` | Works | Has `/*` wildcard in App.tsx |
| Footer "Terms of Service" | `/legal/terms` | Works | |
| Footer "Security" | `/legal/security` | Works | |
| CTA "Schedule Demo" | Nothing | BROKEN | onClick only tracks, no navigation |

### Plan

**Step 1 -- Fix routing for all public pages**

In `App.tsx`, the simplest fix: render `Pricing` and `Features` as **direct eager routes** (like `/login`), not through the `PublicRoutes` wrapper. Same for `/demo-request` and `/request-setup-link`. This avoids the nested Routes mismatch entirely.

```
<Route path="/pricing" element={<Pricing />} />
<Route path="/features" element={<Features />} />
<Route path="/demo-request" element={<DemoRequest />} />
<Route path="/request-setup-link" element={<RequestSetupLink />} />
```

**Step 2 -- Update pricing to $50/user/month**

In `src/pages/Pricing.tsx`, change the plans array:
- **Starter**: $50/month per user (was $199/month)
- **Professional**: $99/month per user (scale proportionally, or keep as-is if you prefer -- will use $50 as base)
- **Enterprise**: Custom (unchanged)

Update copy to show "per user" pricing clearly.

**Step 3 -- Fix remaining broken links**

- Footer "Integration" link (`/integration`) -- no page exists. Change to link to `#features` section or remove it.
- Footer "Support" (`/help`) -- goes to protected route. Either make it public or link to external support.
- CTA "Schedule Demo" button -- add `navigate('/demo-request')` to its onClick.

**Step 4 -- Fix footer links to use React Router navigation**

Footer links use raw `<a href="...">` tags which cause full page reloads. Change to use `navigate()` or `<Link>` from react-router-dom for internal links.

### Files to Edit

| File | Change |
|------|--------|
| `src/App.tsx` | Add direct routes for `/pricing`, `/features`, `/demo-request` |
| `src/pages/Pricing.tsx` | Update pricing to $50/user/month base |
| `src/pages/LandingPage.tsx` | Fix footer links (integration, support, Schedule Demo CTA) |

