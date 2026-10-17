# Security Remediation Roadmap (per assessment doc)

## Photo Intelligence continuation (2026-10-17)
- [x] Programmatic PDF export from the selected approved saved version, with annotated evidence, original appendix, branding and pagination (synthetic acceptance only).
- [x] Reviewable aerial overview with image-relative building markers; no invented geographic coordinates or measurements (signed-in acceptance pending).
- [x] Independent recognition benchmark harness; real accuracy remains pending suitable originals and authorized session.
- [x] Update all four Photo Intelligence tracking documents and run relevant tests (49 passed).
- [ ] Live recognition — blocked: original photos and authorized test session absent; existing analyzer dispatch/auth and coordinate contract need verified repair before activation.
- [ ] Navarre demonstration — blocked: supplied continuation Markdown references a PDF, but no Navarre PDF is mounted in uploads.
- [ ] Authenticated save/isolation acceptance — blocked: external unmanaged authentication has no test session.

1. [x] Verify latest commit contains UltraScan A–F work (228fc1d0c "Completed UltraScan A–E")
2. [x] Admin API routes server-side auth (adminRoutes.tsx + admin-create-user/admin-delete-user done earlier)
3. [x] Remove hardcoded identity-based password authorization exception (admin-update-password/handler.ts)
4. [x] Sanitize production API errors (admin-update-password now returns generic 401/403/404/500)
5. [x] Env-file protections (.env gitignored) + git history scan (only public publishable keys ever committed)
6. [x] Audit public SECURITY DEFINER functions; revoked anon/PUBLIC EXECUTE on 29 internal functions (71→42)
7. [x] Fix unauthorized record creation: ai_call_transcripts, material_import_batches, training_pairs insert policies tenant-scoped
8. [x] Triage 268 linter warnings by severity (docs/SECURITY_WARNING_TRIAGE.md); fixed confirmed highs
9. [ ] Two-company isolation tests — BLOCKED: needs two test companies + test user credentials
10. [x] Full TypeScript check (tsgo, 0 errors) + build OK + 82/82 tests pass (7 skipped = isolation)
11. [ ] Claude Code security review — BLOCKED: runs in user's GitHub repo (workflows already present)
12. [x] FIXED/TESTED/MERGED/DEPLOYED/BLOCKED report delivered

## Remaining (from earlier turns)
- 179 signed-in SECURITY DEFINER functions need per-function tenant/role check review
- Leaked-password protection + MFA: dashboard switches (owner action)
- Vulnerable deps (pdf-maker, formula calc, drawing canvas, PDF.js) — updates need regression testing
- Email verification, rate limits, webhook signatures, file-upload validation, XSS audit, debug settings
