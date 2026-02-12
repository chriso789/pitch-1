

## Add Phone Number Setup to AI Agent Settings Page

### Problem

The "Answering Number" dropdown only shows locations that already have a Telnyx phone number provisioned. If no locations have numbers set up, the user sees "No locations with Telnyx phone numbers found" with no way to fix it. The user needs to be able to search for, purchase, or manually enter a phone number right from this page.

### Solution

Enhance the "Answering Number" section to include:

1. **Keep the existing dropdown** for selecting a pre-provisioned location number
2. **Add a "Set Up New Number" button** that opens the existing `PhoneSetupWizard` in a dialog, letting the user search for and purchase a new Telnyx number or port an existing one -- all without leaving the AI Agent settings page
3. **Show the selected number's status** (active, porting, etc.) with a badge so the user knows if it's ready
4. **Add a link to Phone Provisioning settings** as a secondary action for users who want the full phone management experience

### Changes

#### File: `src/pages/settings/AIAgentSettingsPage.tsx`

**Answering Number card updates:**

- Import `Dialog`, `DialogContent`, `DialogTrigger` and `PhoneSetupWizard`
- Add a state variable `isSetupWizardOpen` and `setupLocationId` (to track which location is being set up)
- When `telnyxLocations` is empty, show both the "no numbers" message AND a "Set Up Phone Number" button that opens the `PhoneSetupWizard` dialog
- When locations exist, show the dropdown plus a "Add Another Number" or "Manage Numbers" link
- After the wizard completes, re-fetch `telnyxLocations` and auto-select the newly provisioned number
- Below the dropdown, show the selected location's phone number and status as a confirmation badge

**Location selection for wizard:**
- The `PhoneSetupWizard` requires a `locationId`. Add a location selector step: if the tenant has locations without numbers, let them pick one; if all locations already have numbers or there's only one without, auto-select it.
- If no locations exist at all, show a message directing to Location Management settings.

---

### Technical Details

| File | Change |
|------|--------|
| `src/pages/settings/AIAgentSettingsPage.tsx` | Add PhoneSetupWizard dialog, location picker for setup, status display, manage numbers link |

**No new files needed** -- reuses existing `PhoneSetupWizard` component.

**No database changes needed.**

**Data flow:**
```text
1. User opens AI Agent Settings
2. Locations with telnyx_phone_number loaded into dropdown
3. If none found --> "Set Up Phone Number" button shown
4. Button opens PhoneSetupWizard dialog (user picks location first if multiple exist)
5. Wizard searches/purchases number via existing edge functions
6. On complete --> re-fetch locations, auto-select new number
7. User saves config with selected location_id
```

**Imports to add:**
- `Dialog, DialogContent` from `@/components/ui/dialog`
- `PhoneSetupWizard` from `@/components/settings/PhoneSetupWizard`

**New state:**
- `isSetupOpen: boolean` -- controls wizard dialog
- `locationsWithoutNumbers: TelnyxLocation[]` -- locations eligible for setup (fetched alongside existing query)

**Modified query in `loadTelnyxLocations`:**
- Also fetch locations WITHOUT phone numbers so we can offer them in the setup wizard
- Store both lists: `telnyxLocations` (have numbers) and `unsetupLocations` (no numbers)
