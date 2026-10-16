# Security Remediation Roadmap (per assessment doc)

1. [ ] Verify latest commit contains UltraScan A–F work
2. [ ] Admin API routes: consistent server-side auth (adminRoutes + edge functions done earlier; verify remaining)
3. [ ] Remove hardcoded identity-based password authorization exception
4. [ ] Sanitize production API errors
5. [ ] Env-file protections + scan git history for exposed credentials
6. [ ] Audit public (anon-executable) SECURITY DEFINER functions; restrict unnecessary EXECUTE
7. [ ] Fix unauthorized record creation on call transcripts (ai_call_transcripts WITH CHECK true)
8. [ ] Triage 268 linter warnings by severity; fix confirmed critical/high
9. [ ] Two-company isolation tests (BLOCKED: needs test accounts/credentials)
10. [ ] Full TypeScript check + build
11. [ ] Claude Code security review (runs in user's GitHub repo — document)
12. [ ] Report FIXED / TESTED / MERGED / DEPLOYED / BLOCKED per item
