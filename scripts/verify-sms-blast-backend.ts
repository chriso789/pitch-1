/**
 * SMS Blast Backend Verification
 * -------------------------------------------------------------------
 * Run with: `bun run scripts/verify-sms-blast-backend.ts`
 *
 * Confirms that every table, column, edge function, template, and
 * frontend wiring the Roof Estimate Email Capture — MSFH campaign
 * relies on is actually present. Prints PASS/FAIL + actionable gaps.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   (falls back to VITE_SUPABASE_URL for convenience.)
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://alxelfrbjzkmtnsulcei.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const push = (c: Check) => checks.push(c);

// ---- 1. Required tables + columns ----------------------------------
const REQUIRED_COLUMNS: Record<string, string[]> = {
  sms_blasts: [
    'id', 'tenant_id', 'name', 'script', 'total_recipients',
    'max_attempts_per_contact', 'status', 'template_pool_ids',
    'ai_followup_enabled', 'goal', 'dry_run', 'created_by',
    'created_at', 'updated_at',
  ],
  sms_blast_items: [
    'id', 'tenant_id', 'blast_id', 'contact_id', 'phone', 'status',
    'personalized_message', 'address_street_snapshot',
    'address_city_snapshot', 'address_state_snapshot',
    'address_zip_snapshot', 'telnyx_message_id', 'sent_at',
    'delivered_at', 'replied_at', 'updated_at',
  ],
  sms_messages: [
    'id', 'tenant_id', 'contact_id', 'blast_id', 'blast_item_id',
    'direction', 'from_number', 'to_number', 'body', 'provider',
    'provider_message_id', 'ai_generated', 'metadata',
  ],
  sms_templates: [
    'id', 'tenant_id', 'template_name', 'template_body',
    'category', 'goal', 'active',
  ],
  opt_outs: ['id', 'phone'],
  messaging_providers: ['id'],
  contacts: ['id', 'tenant_id', 'phone'],
  pipeline_stages: ['id'],
  pipeline_entries: ['id'],
  tasks: ['id'],
};

for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
  // Probe by selecting requested columns with limit 0; Postgrest 400s on
  // unknown columns so we get an actionable error.
  const { error } = await supabase
    .from(table)
    .select(cols.join(','))
    .limit(0);
  push({
    name: `table:${table}`,
    ok: !error,
    detail: error?.message,
  });
}

// ---- 2. Required edge function source files ------------------------
const REQUIRED_FUNCTIONS = [
  'generate-campaign-messages',
  'sms-blast-processor',
  'telnyx-send-sms',
  'telnyx-inbound-webhook',
  'ai-followup-worker',
];
const fnDir = join(process.cwd(), 'supabase', 'functions');
for (const fn of REQUIRED_FUNCTIONS) {
  const path = join(fnDir, fn, 'index.ts');
  push({
    name: `edge:${fn}`,
    ok: existsSync(path),
    detail: existsSync(path) ? undefined : `missing ${path}`,
  });
}

// ---- 3. No duplicate processor implementations ---------------------
const blastProcessorDupes = readdirSync(fnDir).filter(
  (d) => /blast.*process|process.*blast/i.test(d) && d !== 'sms-blast-processor'
);
push({
  name: 'no-duplicate-blast-processor',
  ok: blastProcessorDupes.length === 0,
  detail: blastProcessorDupes.join(', ') || undefined,
});

// ---- 4. Frontend calls match real function names -------------------
const creatorPath = join(
  process.cwd(),
  'src', 'components', 'communications', 'TextBlastCreator.tsx'
);
if (existsSync(creatorPath)) {
  const src = readFileSync(creatorPath, 'utf8');
  for (const fn of ['generate-campaign-messages', 'sms-blast-processor']) {
    push({
      name: `frontend-invokes:${fn}`,
      ok: src.includes(fn),
      detail: src.includes(fn) ? undefined : `TextBlastCreator no longer references ${fn}`,
    });
  }
} else {
  push({ name: 'frontend:TextBlastCreator', ok: false, detail: 'file missing' });
}

// ---- 5. MSFH templates seeded --------------------------------------
{
  const { count, error } = await supabase
    .from('sms_templates')
    .select('id', { count: 'exact', head: true })
    .eq('goal', 'collect_homeowner_email_for_roof_estimate')
    .eq('active', true);
  push({
    name: 'seed:msfh-templates',
    ok: !error && (count ?? 0) > 0,
    detail: error?.message ?? `${count ?? 0} active MSFH templates`,
  });
}

// ---- 6. ai-followup-worker references expected tables --------------
{
  const path = join(fnDir, 'ai-followup-worker', 'index.ts');
  if (existsSync(path)) {
    const src = readFileSync(path, 'utf8');
    const expected = ['sms_blast_items', 'opt_outs', 'telnyx-send-sms'];
    const missing = expected.filter((k) => !src.includes(k));
    push({
      name: 'ai-followup-worker-wiring',
      ok: missing.length === 0,
      detail: missing.length ? `missing references: ${missing.join(', ')}` : undefined,
    });
  }
}

// ---- 7. Launch control layer ----------------------------------------
{
  const launch = join(process.cwd(), 'src/components/communications/SmsBlastLaunchChecklist.tsx');
  push({ name: 'launch:SmsBlastLaunchChecklist', ok: existsSync(launch) });
  const locked = join(process.cwd(), 'src/components/communications/LockedSmsPreviewTable.tsx');
  push({ name: 'launch:LockedSmsPreviewTable', ok: existsSync(locked) });
  const metrics = join(process.cwd(), 'src/hooks/useSmsBlastMetrics.ts');
  push({ name: 'launch:useSmsBlastMetrics', ok: existsSync(metrics) });

  if (existsSync(creatorPath)) {
    const src = readFileSync(creatorPath, 'utf8');
    push({
      name: 'creator:requires-dry-run-for-email-capture',
      ok: src.includes('dryRunCompleted') && src.includes('collect_homeowner_email_for_roof_estimate'),
    });
    push({
      name: 'creator:mounts-launch-checklist',
      ok: src.includes('SmsBlastLaunchChecklist'),
    });
    push({
      name: 'creator:mounts-locked-preview',
      ok: src.includes('LockedSmsPreviewTable'),
    });
  }

  if (existsSync(locked)) {
    const src = readFileSync(locked, 'utf8');
    push({
      name: 'locked-preview:reads-personalized_message',
      ok: src.includes('personalized_message') && src.includes("from('sms_blast_items')") ||
          src.includes('personalized_message') && src.includes("'sms_blast_items'"),
    });
  }

  const proc = join(fnDir, 'sms-blast-processor', 'index.ts');
  if (existsSync(proc)) {
    const src = readFileSync(proc, 'utf8');
    push({
      name: 'processor:production-guard',
      ok: src.includes('production_guard_blocked') &&
          src.includes('address_street_snapshot') &&
          src.includes('personalized_message'),
    });
    push({
      name: 'processor:hard-limit-le-100',
      ok: src.includes('HARD_LIMIT_PER_INVOCATION = 100'),
    });
    push({
      name: 'processor:per-phone-cooldown',
      ok: src.includes('PER_PHONE_COOLDOWN_HOURS') && src.includes('skipped_cooldown'),
    });
    push({
      name: 'processor:in-blast-dedupe',
      ok: src.includes('seenInBlast') && src.includes('skipped_duplicate'),
    });
    push({
      name: 'processor:dry-run-body-flag',
      ok: src.includes('opts.dryRun') || src.includes('reqDryRun'),
    });
  }
}

// ---- Report --------------------------------------------------------
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? '✅ PASS' : '❌ FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
console.log('');
console.log(`Summary: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log('\nRecommended fixes:');
  for (const f of failed) {
    if (f.name.startsWith('table:')) {
      console.log(`  • add missing columns on ${f.name.slice(6)} (see REQUIRED_COLUMNS in this script)`);
    } else if (f.name.startsWith('edge:')) {
      console.log(`  • create supabase/functions/${f.name.slice(5)}/index.ts`);
    } else if (f.name === 'seed:msfh-templates') {
      console.log('  • insert sms_templates rows with goal=collect_homeowner_email_for_roof_estimate per tenant');
    } else if (f.name === 'no-duplicate-blast-processor') {
      console.log('  • remove duplicate processor functions to avoid double sends');
    } else {
      console.log(`  • investigate "${f.name}": ${f.detail ?? ''}`);
    }
  }
  process.exit(1);
}
process.exit(0);
