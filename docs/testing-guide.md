# Testing Guide - PITCH CRM

**Phase 1 - Week 1-2: Testing Infrastructure**

## Overview

This project uses a comprehensive testing strategy with:
- **E2E Tests**: Playwright for end-to-end testing
- **Unit Tests**: Vitest for component and utility testing
- **Integration Tests**: Vitest for API and database testing

## Running Tests

```bash
# Run all unit tests
npm run test

# Run unit tests in watch mode
npm run test:watch

# Run unit tests with UI
npm run test:ui

# Run E2E tests
npm run test:e2e

# Run E2E tests in headed mode
npm run test:e2e:headed

# Generate coverage report
npm run test:coverage
```

## Test ID Convention

All interactive elements use `data-testid` attributes following this pattern:

```
{feature}-{component}-{action}
```

### Examples:
- `auth-email-input` - Email input on auth form
- `contacts-create-button` - Create button on contacts page
- `pipeline-card-edit` - Edit button on pipeline card

### Centralized Test IDs

Import from `tests/utils/test-ids.ts`:

```typescript
import { TEST_IDS } from '@/tests/utils/test-ids';

<Button data-testid={TEST_IDS.contacts.createButton}>
  Create Contact
</Button>
```

## Writing E2E Tests

### Basic Structure

```typescript
import { test, expect } from '@playwright/test';
import { loginAsUser } from '../tests/utils/auth-helpers';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await loginAsUser(page);
    
    // Your test code
    await page.getByTestId('feature-action-button').click();
    await expect(page.getByText('Success')).toBeVisible();
  });
});
```

### Auth Helpers

```typescript
import { loginAsUser, logout, TEST_USER, TEST_ADMIN } from '../tests/utils/auth-helpers';

// Login as regular user
await loginAsUser(page);

// Login as admin
await loginAsUser(page, TEST_ADMIN);

// Logout
await logout(page);
```

### Database Helpers

```typescript
import { 
  createTestContact, 
  createTestPipelineEntry,
  cleanupTestData 
} from '../tests/utils/db-helpers';

test('should handle contact', async () => {
  const contact = await createTestContact({
    first_name: 'John',
    last_name: 'Doe'
  });
  
  // Test logic
  
  await cleanupTestData();
});
```

## Writing Unit Tests

### Component Testing

```typescript
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByTestId('my-component')).toBeInTheDocument();
  });
  
  it('should handle click', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    
    await user.click(screen.getByTestId('my-button'));
    expect(screen.getByText('Clicked!')).toBeInTheDocument();
  });
});
```

### Service Testing

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myService } from './myService';

describe('myService', () => {
  it('should process data', () => {
    const result = myService.process('input');
    expect(result).toBe('expected output');
  });
});
```

## Adding Test IDs to Components

### Example: Button with Test ID

```typescript
<Button 
  data-testid="contacts-create-button"
  onClick={handleCreate}
>
  Create Contact
</Button>
```

### Example: Input with Test ID

```typescript
<Input
  data-testid="contact-form-email"
  type="email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>
```

## Coverage Goals

- **Unit Tests**: ≥70% coverage for new modules
- **Integration Tests**: All API endpoints and DB operations
- **E2E Tests**: All critical user flows

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Main branch commits
- Release builds

### GitHub Actions Workflow

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test
      - run: npm run test:e2e
```

## Test Organization

```
project-root/
├── e2e/                    # E2E tests
│   ├── auth.spec.ts
│   ├── contacts.spec.ts
│   └── pipeline.spec.ts
├── tests/
│   ├── setup.ts           # Test setup
│   └── utils/             # Test utilities
│       ├── auth-helpers.ts
│       ├── db-helpers.ts
│       └── test-ids.ts
└── src/
    └── **/*.test.tsx      # Unit tests next to components
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up test data
3. **Descriptive Names**: Use clear, descriptive test names
4. **Arrange-Act-Assert**: Follow AAA pattern
5. **Mock Sparingly**: Use real services when possible
6. **Test User Behavior**: Test what users do, not implementation

## Debugging Tests

### E2E Tests

```bash
# Run in headed mode
npm run test:e2e:headed

# Debug specific test
npx playwright test auth.spec.ts --debug

# View test report
npx playwright show-report
```

### Unit Tests

```bash
# Run tests in watch mode
npm run test:watch

# Open Vitest UI
npm run test:ui

# Debug in VS Code
# Add breakpoint and use "Debug Test" CodeLens
```

## Next Steps (Phase 1 Week 3-4)

- [ ] Add `data-testid` to remaining 50+ core components
- [ ] Write 20+ E2E tests covering critical flows
- [ ] Achieve ≥70% unit test coverage
- [ ] Document button-action matrix
- [ ] Set up CI/CD pipeline

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Vitest Documentation](https://vitest.dev)
- [Testing Library](https://testing-library.com)
