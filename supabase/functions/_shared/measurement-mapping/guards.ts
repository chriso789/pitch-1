// Phase 1.6 — shared production guards for measurement-mapping tooling.
//
// Every script in this directory MUST call `enforceEnvironmentGuards()` before
// touching the database. The guards block accidental writes against the live
// production project (alxelfrbjzkmtnsulcei) and against any environment marked
// DEPLOY_ENV=production. Mutations additionally require the explicit
// `--allow-staging-write` flag, regardless of env.
//
// The guards log a clear "READ ONLY" or "WRITE MODE" banner at startup so the
// operator always knows what mode they are in.

export const FORBIDDEN_PROJECT_REFS = ["alxelfrbjzkmtnsulcei"] as const;

export interface GuardOptions {
  /** Name of the script (for log banner). */
  scriptName: string;
  /** True when the caller passed `--write` (i.e. intends to mutate). */
  wantsWrite: boolean;
  /** True when the caller passed `--allow-staging-write`. */
  allowStagingWrite: boolean;
  /** Raw argv, used to scan for forbidden flags. */
  argv: string[];
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function deployEnv(): string {
  return (env("DEPLOY_ENV") || env("ENVIRONMENT")).toLowerCase();
}

function supabaseUrl(): string {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
}

function urlPointsAtForbiddenProject(url: string): string | null {
  const lower = url.toLowerCase();
  for (const ref of FORBIDDEN_PROJECT_REFS) {
    if (lower.includes(ref)) return ref;
  }
  return null;
}

/**
 * Enforce all environment guards. Exits the process on violation.
 * Returns the resolved mode for the caller's bookkeeping.
 */
export function enforceEnvironmentGuards(opts: GuardOptions): "READ ONLY" | "WRITE MODE" {
  const url = supabaseUrl();
  const env_ = deployEnv();
  const forbiddenRef = urlPointsAtForbiddenProject(url);
  const mode: "READ ONLY" | "WRITE MODE" = opts.wantsWrite ? "WRITE MODE" : "READ ONLY";

  // Banner — always print first so the operator sees mode + target.
  console.error("──────────────────────────────────────────────────────────────");
  console.error(`[${opts.scriptName}] ${mode}`);
  console.error(`  SUPABASE_URL : ${url || "(unset)"}`);
  console.error(`  DEPLOY_ENV   : ${env_ || "(unset)"}`);
  console.error(`  forbidden ref: ${forbiddenRef ?? "no"}`);
  console.error("──────────────────────────────────────────────────────────────");

  // Rule 1: never mutate when URL points at a forbidden production project.
  if (opts.wantsWrite && forbiddenRef) {
    console.error(
      `REFUSED: --write is forbidden against production project '${forbiddenRef}'. ` +
        "Point SUPABASE_URL at a staging project (see RUNBOOK.md).",
    );
    Deno.exit(2);
  }

  // Rule 2: never mutate when DEPLOY_ENV=production.
  if (opts.wantsWrite && env_ === "production") {
    console.error("REFUSED: --write is forbidden when DEPLOY_ENV=production.");
    Deno.exit(2);
  }

  // Rule 3: any mutation requires the explicit --allow-staging-write flag.
  if (opts.wantsWrite && !opts.allowStagingWrite) {
    console.error(
      "REFUSED: mutating runs require the explicit --allow-staging-write flag. " +
        "Re-run with --write --allow-staging-write once you have confirmed the target is staging.",
    );
    Deno.exit(2);
  }

  // Rule 4: --allow-staging-write must be paired with --write (no silent ops).
  if (opts.allowStagingWrite && !opts.wantsWrite) {
    console.error("REFUSED: --allow-staging-write passed without --write. Refusing to run.");
    Deno.exit(2);
  }

  // Rule 5: mutating runs additionally require staging/development env tag.
  if (opts.wantsWrite && env_ !== "staging" && env_ !== "development" && env_ !== "dev") {
    console.error(
      `REFUSED: --write requires DEPLOY_ENV in {staging,development,dev}. Current: '${env_ || "(unset)"}'.`,
    );
    Deno.exit(2);
  }

  return mode;
}

/** Convenience: does argv contain the flag? */
export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}
