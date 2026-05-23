---
name: migration-readiness-scanner
description: Produces a portability report showing what is locked to Lovable vs portable if the user migrates away. Triggers on "migrate", "portable", "lock-in", "leave Lovable", "export", "what happens if I migrate", "can I take my code", or requests to assess migration readiness.
---

# Migration Readiness Scanner

## Purpose

When the user asks about leaving Lovable, migrating to another platform, or what they own vs what is trapped, run this scan and report. Do not give vague reassurance — classify every major component explicitly.

## Classification Rules

For each row in the report, answer Portable / Partial / Locked / Unknown.

| Component | Default Verdict | Why |
|---|---|---|
| React frontend code in `src/` | **Portable** | Standard Vite + React + TypeScript. Can run anywhere that hosts static builds. |
| Supabase tables / data | **Portable** | Lives in the connected Supabase project, not Lovable. Export via Supabase dashboard or pg_dump. |
| Supabase Edge Functions | **Portable** | Standard Deno/TypeScript. Can deploy to Deno Deploy, Netlify Functions, or AWS Lambda with minor adapter work. |
| Supabase Storage buckets / files | **Portable** | Lives in connected Supabase project. Migrate via Supabase SDK or rclone. |
| RLS policies | **Portable** | Defined in SQL migrations or Supabase dashboard. Re-playable on any Postgres instance. |
| SQL migrations | **Portable** | Raw SQL in the repo. Replayable on any Postgres. |
| Lovable prompt / chat history | **Locked** | Not committed to repo. No export API. Gone if project is deleted. |
| Lovable visual builder state | **Locked** | UI graph lives in Lovable Cloud. Cannot be exported as code. |
| Lovable-hosted environment config | **Locked** | Preview domains, publish settings, badges, etc. Must be recreated elsewhere. |
| Lovable AI "skills" not committed | **Locked** | Skills in `.agents/skills/` may be committed to repo if the user saved them; uncommitted ones are lost. Check git status. |
| Custom code committed to GitHub | **Portable** | Standard git history. Clone and run elsewhere. |
| Supabase cron jobs / pg_cron | **Portable** | Lives in Postgres / Supabase. Re-create in target environment. |
| External API credentials (Stripe, Telnyx, etc.) | **Partial** | Secrets are stored in Supabase vault / Edge Function env vars, not Lovable. You own them, but moving them requires secure transfer (never paste secrets in chat). |
| Supabase Auth users / MFA | **Partial** | Users live in Supabase auth schema. Migrating auth requires export/import scripts or SSO; passwords are hashed and non-portable without user reset. |
| Supabase Realtime subscriptions | **Partial** | Config is in Supabase. Code is in repo. Re-point client to new Supabase project. |
| Git submodule / `.gitmodules` | **Portable** | Standard git behavior. |
| `node_modules` / lockfile | **Portable** | Reproducible from committed lockfile. |
| Build artifacts in `dist/` | **Irrelevant** | Regenerable. |

## Hard Rules

- Never tell the user "everything is portable" without the above nuance.
- If a component is marked Locked, explain what they would lose and whether it can be recreated manually.
- If skills exist in `.agents/skills/` or `.workspace/skills/`, note whether they are committed to git (`git status` check).
- Never paste actual secret values. When discussing credentials, say "stored in Supabase secrets" and advise secure transfer.
- If the project uses Lovable Cloud (not an external Supabase), the database is also locked to Lovable unless they connect their own Supabase first.

## Scan Procedure

1. Read `supabase/config.toml` to determine if the project uses an external Supabase project or Lovable Cloud.
2. List root files (`package.json`, `vite.config.ts`, `.gitignore`, `README.md`) to assess standard-repo health.
3. Check whether `.agents/skills/` or `.workspace/skills/` exist and whether they are tracked by git.
4. Look for any Lovable-specific metadata files (`.lovable/`, `.agents/` configs) that are not committed.
5. Check for `supabase/migrations/` or `supabase/functions/` to confirm backend portability.

## Report Format

Produce a Markdown table with columns: **Component**, **Portable?**, **Notes**, **Action Required if Migrating**.

Then add a short risk summary:
- **Low risk**: Everything important is committed + external Supabase.
- **Medium risk**: Some backend in Lovable Cloud, or uncommitted skills, or missing migrations.
- **High risk**: Heavy reliance on uncommitted Lovable builder state, no external Supabase, no git remote.

End with concrete next steps the user can take to increase portability (e.g., "Connect your own Supabase project", "Commit uncommitted skills", "Export database").
