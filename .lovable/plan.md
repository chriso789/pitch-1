## Why GitHub is spamming failures

Two factors are compounding:

**1. CI runs on EVERY push to EVERY branch.** `.github/workflows/ci.yml` triggers on `push: branches: ['**']` and `pull_request`. Lovable creates many commits per chat loop on the same branch, so every iteration fires the full CI suite. Even with `concurrency: cancel-in-progress`, each cancelled run still emits a "Run failed" notification.

**2. Two brittle jobs that fail loudly:**

- `**Deno • Edge Function Typecheck**` runs `deno check` over `supabase/functions/**/index.ts` — currently 400+ functions. A single unresolved `npm:` import, missing shared file, or a Deno-only API used in shared TS makes the WHOLE job red. This is the most-frequent failure mode in the screenshot (most rows say "Deno • Edge Function Typecheck failed").
- `**Typecheck • Lint • Unit Tests • Build**` is a single sequential job. One TS error / one lint warning that's promoted to error / one flaky vitest = whole job red, "Build failed (2 annotations)".

There are also three `claude-*.yml` workflows. Those only run on PRs / cron / manual dispatch, so they are NOT the source of the spam — leave them alone.

## Plan

### 1. Stop the email spam at the source — narrow CI triggers

Update `.github/workflows/ci.yml`:

- `push:` only on `branches: [main]` (so Lovable's working-branch pushes stop firing CI).
- Keep `pull_request:` so PR review still gets coverage.
- Add `paths-ignore` for docs/markdown/asset-only changes (`*.md`, `docs/**`, `public/**`, `mem://` files do not live in git but `*.md` are common).
- Keep `concurrency.cancel-in-progress: true` (already there).

Expected effect: CI runs drop from ~every commit to ~once per merge to main + once per PR push. The email volume in the screenshot disappears immediately.

### 2. Split the monolithic quality job so one failure ≠ whole job red

Replace the single `quality` job with four parallel jobs sharing one `setup` job that caches `node_modules`:

```text
setup (npm ci, upload node_modules cache)
  ├── typecheck   (npm run typecheck)
  ├── lint        (npm run lint)
  ├── unit-tests  (npm run test:unit)
  └── build       (npm run build)
```

Each becomes its own check on the PR. A flaky unit test no longer hides a real typecheck failure, and the failure annotation points at the actual problem instead of the umbrella "Build failed (2 annotations)".

### 3. Tame the Deno edge-function typecheck

`deno check` over 400+ functions is the single biggest source of red runs. Make it scoped and non-fatal for unrelated functions:

- **Scope to changed functions only on PRs**: use `tj-actions/changed-files` (already used in `claude-code-review.yml`) to compute the list of changed `supabase/functions/*/index.ts` and run `deno check` on just those. Full-tree check stays only on push to `main`.
- **Add `--no-npm` / explicit `--allow-import` flags** consistent with how the functions actually deploy, so legitimate `npm:` specifiers don't fail locally.
- **Make the `main`-branch full sweep `continue-on-error: true` for now** and instead publish a JSON report as a workflow artifact. We'll wire a follow-up job that opens a single tracking issue when the count of broken functions changes, instead of emailing on every push.

### 4. Fix the real underlying failures (separate follow-up tickets)

Triggers above will reduce email noise even if real failures remain. To actually get CI green, after step 1–3 ship:

- Inventory current failures by downloading the latest red run's annotations (the "2 annotations" referenced in the email subjects) and bucket them: TS errors vs Deno import errors vs vitest failures vs lint.
- Address each bucket in its own small PR. Likely candidates based on the project's edge-function rules: missing `npm:` prefix, `serve(handler)` instead of `Deno.serve(handler)`, shared files importing from `src/`, edge functions importing types from frontend.
- For lint: confirm `eslint .` isn't promoting warnings to errors on files Lovable touches frequently; if it is, demote to warn for the noisy rules.

### 5. Optional — kill notifications on cancelled runs

`concurrency.cancel-in-progress` produces "cancelled" events that GitHub still emails about for some user notification settings. Add `if: github.event.action != 'cancelled'` is not a thing, but we can instead set `concurrency.group` to include `github.workflow` (already implicit) and document that the user should switch GitHub notification preferences to "Only notify for failed workflows I triggered" — this is a one-line settings change in github.com/settings/notifications.

## Files touched

- `.github/workflows/ci.yml` — rewrite (steps 1–3).
- No code or app changes in this plan. Underlying CI failures in step 4 will be addressed in follow-up PRs once the noise is gone and we can actually read the real annotations.

## Out of scope

- Editing the three `claude-*.yml` workflows (they're not the source of spam).
- Refactoring edge functions — the architecture guard owns that work, and the consolidation skill should drive any function merges.
- Changing branch-protection or required-checks rules on the GitHub side (user-side config).  
  
The repo confirms the cause.
  Your `.github/workflows/ci.yml` is set to run CI on **every push to every branch**:
  ```

  ```
  ```
  on:
    push:
      branches: ['**']
    pull_request:
  ```
  That means every Lovable/Codex/GitHub commit loop is firing the whole CI workflow. Since your workflow has `concurrency.cancel-in-progress: true`, GitHub cancels older runs when new commits come in — but those failed/cancelled runs can still email you. That is why your inbox is getting hammered. 
  The two failing jobs are also exactly what the emails show:
  ```

  ```
  ```
  quality:
    name: Typecheck • Lint • Unit Tests • Build
  ```
  and:
  ```

  ```
  ```
  edge-functions-check:
    name: Deno • Edge Function Typecheck
  ```
  The Deno job is checking **every Supabase edge function index file**:
  ```

  ```
  ```
  files=(supabase/functions/**/index.ts)
  deno check --no-lock "${files[@]}"
  ```
  So one bad import, one broken shared file, one Deno incompatibility, or one function that Lovable half-edited makes the entire CI run red. 
  ### What is causing it
  You have a bad CI design for a fast-moving Lovable/Codex project.
  The problem is not just “code is broken.” The bigger issue is:
  1. **CI runs on every branch push**  

  2. **Lovable/Codex creates a lot of commits**  

  3. **The Deno check scans all edge functions every time**  

  4. **The frontend job combines typecheck, lint, tests, and build into one red failure**  

  5. **GitHub emails you for every failed workflow run**  

  So the inbox spam is expected behavior with this workflow.
  ### Fix this first
  Change `.github/workflows/ci.yml` so CI only runs on `main` pushes and pull requests, not every random branch push.
  Use this as the immediate replacement header:
  ```

  ```
  ```
  name: CI

  on:
    push:
      branches:
        - main
      paths-ignore:
        - '**/*.md'
        - 'docs/**'
        - 'public/**'
        - '.github/ISSUE_TEMPLATE/**'

    pull_request:
      paths-ignore:
        - '**/*.md'
        - 'docs/**'
        - 'public/**'
        - '.github/ISSUE_TEMPLATE/**'

  concurrency:
    group: ci-${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: true
  ```
  That alone should stop most of the email flood.
  ### Then fix the Deno job
  Right now this is too aggressive:
  ```

  ```
  ```
  deno check --no-lock "${files[@]}"
  ```
  For a repo with hundreds of Supabase functions, that is asking for constant red runs.
  Better structure:
  ```

  ```
  ```
  edge-functions-check:
    name: Deno • Changed Edge Functions
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x

      - name: Find changed edge functions
        id: changed
        uses: tj-actions/changed-files@v45
        with:
          files: |
            supabase/functions/**/index.ts
            supabase/functions/_shared/**/*.ts

      - name: Deno type-check changed edge functions
        if: steps.changed.outputs.any_changed == 'true'
        run: |
          deno check --no-lock ${{ steps.changed.outputs.all_changed_files }}

      - name: No changed edge functions
        if: steps.changed.outputs.any_changed != 'true'
        run: echo "No changed edge functions to check"
  ```
  This prevents one old broken edge function from making every unrelated commit fail.
  ### Then split the quality job
  Right now this one job does everything:
  ```

  ```
  ```
  Typecheck • Lint • Unit Tests • Build
  ```
  That makes debugging worse. Split it into separate jobs:
  ```

  ```
  ```
  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci --no-audit --no-fund
      - run: npm run typecheck

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci --no-audit --no-fund
      - run: npm run lint

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci --no-audit --no-fund
      - run: npm run test:unit
        env:
          VITE_SUPABASE_URL: https://example.supabase.co
          VITE_SUPABASE_PUBLISHABLE_KEY: test-anon-key

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci --no-audit --no-fund
      - run: npm run build
  ```
  This makes GitHub tell you **exactly** what failed instead of hiding everything under one umbrella failure.
  ### Bottom line
  Your repo is not “randomly broken.” Your CI is too broad for the way you are building.
  Immediate move: update `.github/workflows/ci.yml` so push only runs on `main`, PRs still run normally, and Deno only checks changed edge functions. That will stop the GitHub email flood and make the remaining real errors much easier to fix.