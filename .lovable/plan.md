## Goal

Stop CI email spam by removing the `push: main` trigger from `.github/workflows/ci.yml`. CI will run on pull requests and manual dispatch only.

## Change

Edit `.github/workflows/ci.yml` — replace the current `on:` block:

```yaml
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
```

with:

```yaml
on:
  pull_request:
    paths-ignore:
      - '**/*.md'
      - 'docs/**'
      - 'public/**'
      - '.github/ISSUE_TEMPLATE/**'
  workflow_dispatch:
```

## Side effect to be aware of

The `edge-functions-check` job has a `main`-only step ("Deno type-check ALL edge functions") guarded by `github.ref == 'refs/heads/main'`. After this change that branch is unreachable (CI no longer runs on main push). I will leave it in place — harmless, and it re-activates if you ever add `push: main` back. No other workflow logic is impacted.

## Out of scope

- No code/test fixes for the current Build/Lint/Typecheck/Unit failures (those are separate; address via PRs going forward).
- No GitHub notification settings — that's a per-account UI change you do yourself.
- No branch protection / merge-queue setup (recommend doing it manually in GitHub repo settings).
