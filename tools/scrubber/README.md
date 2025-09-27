# Actionless Button Scrubber

A comprehensive toolchain to detect actionless buttons and broken UI pathways in your React application.

## Setup

```bash
cd tools/scrubber
npm install
npx playwright install chromium
```

## Usage

Start your application locally on port 8080, then run:

```bash
# Run individual scanners
npm run scrub:dyn    # Dynamic Playwright crawler
npm run scrub:stat   # Static AST analyzer
npm run scrub:merge  # Combine reports

# Run all scanners
npm run scrub:all
```

## Reports

Reports are generated in `./out/`:

- `dynamic-report.md` - Runtime actionless buttons and broken endpoints
- `static-report.md` - Code analysis suspects (missing handlers, APIs)
- `scrub-merged.md` - Combined bug report

## What It Detects

- **ACTIONLESS**: Buttons that produce no visible effect when clicked
- **BROKEN_ENDPOINT**: HTTP 4xx/5xx errors after clicking
- **JS_ERROR**: Console/page errors on click
- **NO_HANDLER**: Buttons without onClick handlers
- **MISSING_API**: Frontend API calls to non-existent routes
- **MISSING_FN**: onClick references to undefined functions

## Safety

The scrubber runs in dry-run mode by default, intercepting and blocking all mutating HTTP requests (POST/PUT/PATCH/DELETE) to prevent data changes during testing.