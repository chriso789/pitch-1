# Button-Action Matrix

**Phase 1 - Week 1-2: Testing Infrastructure**

This document maps every interactive element (buttons, links, inputs) to their corresponding actions, service calls, and tests.

## Authentication Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `auth-email-input` | AuthTabs | Email input | n/a | Updates form state | e2e/auth.spec.ts | ✅ |
| `auth-password-input` | AuthTabs | Password input | n/a | Updates form state | e2e/auth.spec.ts | ✅ |
| `auth-firstname-input` | AuthTabs | First name input | n/a | Updates form state | e2e/auth.spec.ts | ✅ |
| `auth-lastname-input` | AuthTabs | Last name input | n/a | Updates form state | e2e/auth.spec.ts | ✅ |
| `auth-submit-button` | AuthTabs | Submit login/signup | `supabase.auth.signIn/signUp` | Creates session, redirects to dashboard | e2e/auth.spec.ts | ✅ |
| `auth-toggle-mode` | AuthTabs | Switch auth mode | n/a | Changes active tab | e2e/auth.spec.ts | ✅ |
| `auth-forgot-password` | AuthTabs | Reset password | `supabase.auth.resetPasswordForEmail` | Sends reset email | ❌ TODO | ❌ |
| `auth-reset-button` | ResetPassword | Update password | `supabase.auth.updateUser` | Updates password, redirects | ❌ TODO | ❌ |

## Navigation Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `sidebar-dashboard` | Sidebar | Navigate to dashboard | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-contacts` | Sidebar | Navigate to contacts | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-pipeline` | Sidebar | Navigate to pipeline | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-jobs` | Sidebar | Navigate to jobs | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-estimates` | Sidebar | Navigate to estimates | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-calendar` | Sidebar | Navigate to calendar | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-settings` | Sidebar | Navigate to settings | React Router | Route change | ❌ TODO | ✅ |
| `sidebar-user-menu` | Sidebar | Open user menu | n/a | Shows dropdown | ❌ TODO | ✅ |

## User Menu Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `user-menu-profile` | UserMenu | Navigate to profile | React Router | Route change | ❌ TODO | ❌ |
| `user-menu-settings` | UserMenu | Navigate to settings | React Router | Route change | ❌ TODO | ❌ |
| `user-menu-logout` | UserMenu | Logout | `supabase.auth.signOut` | Clears session, redirects to login | ❌ TODO | ❌ |

## Contacts Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `contacts-create-button` | ContactFormDialog | Open create dialog | n/a | Opens dialog | ❌ TODO | ✅ |
| `contacts-search-input` | EnhancedClientList | Search contacts | Query filter | Updates contact list | ❌ TODO | ✅ |
| `contacts-filter-type` | EnhancedClientList | Filter by type | Query filter | Updates contact list | ❌ TODO | ✅ |
| `contacts-list-item` | EnhancedClientList | View contact details | React Router | Route change | ❌ TODO | ✅ |
| `contacts-edit-button` | ContactItem | Open edit dialog | n/a | Opens dialog | ❌ TODO | ❌ |
| `contacts-delete-button` | ContactItem | Delete contact | `supabase.from('contacts').delete()` | Soft deletes contact | ❌ TODO | ❌ |
| `contact-form-firstname` | ContactForm | First name input | n/a | Updates form state | ❌ TODO | ✅ |
| `contact-form-lastname` | ContactForm | Last name input | n/a | Updates form state | ❌ TODO | ✅ |
| `contact-form-email` | ContactForm | Email input | n/a | Updates form state | ❌ TODO | ✅ |
| `contact-form-phone` | ContactForm | Phone input | n/a | Updates form state | ❌ TODO | ✅ |
| `contact-form-address` | ContactForm | Address input | n/a | Updates form state | ❌ TODO | ❌ |
| `contact-form-submit` | ContactForm | Submit form | `supabase.from('contacts').insert/update()` | Creates/updates contact, closes dialog | ❌ TODO | ✅ |
| `contact-form-cancel` | ContactForm | Cancel form | n/a | Closes dialog without saving | ❌ TODO | ✅ |

## Pipeline Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `pipeline-kanban` | Pipeline | View Kanban board | Query | Displays pipeline stages | ❌ TODO | ❌ |
| `pipeline-column` | KanbanColumn | View column | n/a | Displays entries in stage | ❌ TODO | ❌ |
| `pipeline-card` | KanbanCard | View card details | n/a | Shows entry summary | ❌ TODO | ❌ |
| `pipeline-create-button` | Pipeline | Create entry | Opens dialog | Shows creation form | ❌ TODO | ❌ |
| `pipeline-drag-handle` | KanbanCard | Drag card | DnD handler | Allows drag operation | ❌ TODO | ❌ |
| `pipeline-view-details` | KanbanCard | View full details | React Router | Route change | ❌ TODO | ❌ |
| `pipeline-edit-button` | KanbanCard | Edit entry | Opens dialog | Shows edit form | ❌ TODO | ❌ |
| `pipeline-delete-button` | KanbanCard | Delete entry | `supabase.from('pipeline_entries').delete()` | Soft deletes entry | ❌ TODO | ❌ |

## Settings Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `settings-general-tab` | Settings | View general settings | n/a | Shows general tab | ❌ TODO | ❌ |
| `settings-users-tab` | Settings | View users settings | n/a | Shows users tab | ❌ TODO | ❌ |
| `settings-roles-tab` | Settings | View roles settings | n/a | Shows roles tab | ❌ TODO | ❌ |
| `settings-api-tab` | Settings | View API settings | n/a | Shows API tab | ❌ TODO | ❌ |
| `settings-save-button` | Settings | Save settings | Various service calls | Updates settings, shows toast | ❌ TODO | ❌ |
| `settings-cancel-button` | Settings | Cancel changes | n/a | Resets form, closes dialog | ❌ TODO | ❌ |

## Task Assignment Module

| Test ID | Component | Action | Service/Function | Side Effects | Test File | Status |
|---------|-----------|--------|------------------|--------------|-----------|--------|
| `task-create-button` | TaskAssignmentDialog | Open task dialog | n/a | Opens dialog | ❌ TODO | ✅ |
| `task-title-input` | TaskAssignmentDialog | Title input | n/a | Updates form state | ❌ TODO | ✅ |
| `task-description-input` | TaskAssignmentDialog | Description input | n/a | Updates form state | ❌ TODO | ✅ |
| `task-priority-select` | TaskAssignmentDialog | Select priority | n/a | Updates form state | ❌ TODO | ✅ |
| `task-due-date-input` | TaskAssignmentDialog | Due date input | n/a | Updates form state | ❌ TODO | ✅ |
| `task-assign-to-select` | TaskAssignmentDialog | Select assignee | Query users | Updates form state | ❌ TODO | ✅ |
| `task-submit-button` | TaskAssignmentDialog | Create task | `supabase.from('tasks').insert()` | Creates task, closes dialog, shows toast | ❌ TODO | ✅ |
| `task-cancel-button` | TaskAssignmentDialog | Cancel task | n/a | Closes dialog without saving | ❌ TODO | ✅ |

## Legend

- ✅ Implemented and tested
- ❌ TODO - Not yet implemented
- 🔄 In Progress
- ⚠️ Needs update

## Implementation Progress

**Phase 1 - Week 1-2 (Current)**
- Auth Module: 67% (6/9 test IDs implemented)
- Navigation: 100% (8/8)
- Contacts: 77% (10/13 test IDs implemented)
- Pipeline: 0% (0/8)
- Settings: 0% (0/6)
- Tasks: 100% (8/8 test IDs implemented)

**Overall: 62% (32/52 test IDs implemented)**

## Next Steps

1. Complete Auth module test coverage
2. Add test IDs to Sidebar navigation
3. Add test IDs to Contacts module
4. Write E2E tests for each critical flow
5. Achieve 100% button-action coverage for Phase 1

## Adding New Buttons

When adding a new button:

1. **Choose a test ID** following the convention
2. **Add to TEST_IDS** in `tests/utils/test-ids.ts`
3. **Add to component** with `data-testid` attribute
4. **Document here** in the appropriate module section
5. **Write tests** for the action
6. **Update status** when complete

Example:
```typescript
// 1. Add to TEST_IDS
export const TEST_IDS = {
  myFeature: {
    myButton: 'my-feature-my-button'
  }
};

// 2. Use in component
<Button data-testid={TEST_IDS.myFeature.myButton}>
  My Action
</Button>

// 3. Write test
test('should handle my action', async ({ page }) => {
  await page.getByTestId('my-feature-my-button').click();
  await expect(page.getByText('Success')).toBeVisible();
});

// 4. Document in this file
```
