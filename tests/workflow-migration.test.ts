import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const user = '10000000-0000-0000-0000-000000000001';
const tenant = '20000000-0000-0000-0000-000000000001';
const otherTenant = '20000000-0000-0000-0000-000000000002';
const job = '30000000-0000-0000-0000-000000000001';
const checklist = '40000000-0000-0000-0000-000000000001';
const item = '50000000-0000-0000-0000-000000000001';
const photo = '60000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA crew;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
    CREATE FUNCTION public.get_user_tenant_ids() RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT '${tenant}'::uuid $$;
    CREATE TABLE public.automation_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, status text, started_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE public.achievement_rewards(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, user_id uuid, status text, claimed_at timestamptz);
    CREATE TABLE crew.job_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, company_id uuid, subcontractor_user_id uuid, is_locked boolean DEFAULT false);
    CREATE TABLE crew.photo_buckets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, key text, label text, description text);
    CREATE TABLE crew.job_photo_requirements(job_id uuid, company_id uuid, bucket_id uuid, required_count integer, is_required boolean);
    CREATE TABLE crew.job_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_id uuid, subcontractor_user_id uuid, bucket_id uuid, file_url text, taken_at timestamptz DEFAULT now(), gps_lat numeric, gps_lng numeric);
    CREATE TABLE crew.checklist_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid, sort_order integer, label text, help_text text, requires_photo boolean, is_required boolean);
    CREATE TABLE crew.job_checklists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, company_id uuid, template_id uuid);
    CREATE TABLE crew.job_checklist_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_checklist_id uuid, item_id uuid, subcontractor_user_id uuid, is_checked boolean, proof_photo_id uuid, note text, checked_at timestamptz, UNIQUE(company_id,job_checklist_id,item_id,subcontractor_user_id));
  `);
  await db.exec(readFileSync('supabase/migrations/20261111180000_complete_workflow_operations.sql', 'utf8'));
  await db.query(`SELECT set_config('test.user_id', $1, false)`, [user]);
  await db.query('INSERT INTO crew.job_assignments(job_id, company_id, subcontractor_user_id) VALUES ($1,$2,$3)', [job, tenant, user]);
  await db.query('INSERT INTO crew.job_checklists(id,job_id,company_id,template_id) VALUES ($1,$2,$3,$1)', [checklist,job,tenant]);
  await db.query('INSERT INTO crew.checklist_items(id,template_id,sort_order,label,requires_photo,is_required) VALUES ($1,$2,1,\'Cleanup\',true,true)', [item,checklist]);
  await db.query('INSERT INTO crew.job_photos(id,company_id,job_id,subcontractor_user_id) VALUES ($1,$2,$3,$4)', [photo,tenant,job,user]);
}, 30000);
afterAll(() => db.close());

it('atomic workers claim disjoint runs and never reclaim running effects', async () => {
  await db.query("INSERT INTO automation_runs(company_id,status) VALUES ($1,'queued'),($1,'queued')", [tenant]);
  const results = await Promise.all([db.query<{id: string}>('SELECT * FROM claim_automation_runs(1)'), db.query<{id: string}>('SELECT * FROM claim_automation_runs(1)')]);
  expect(results.map(result => result.rows.length)).toEqual([1,1]);
  expect(results[0].rows[0].id).not.toBe(results[1].rows[0].id);
  expect((await db.query('SELECT * FROM claim_automation_runs(25)')).rows).toHaveLength(0);
});
it('ordinary authenticated users cannot dequeue automation runs', async () => {
  await db.exec('SET ROLE authenticated');
  try { await expect(db.query('SELECT * FROM claim_automation_runs(1)')).rejects.toThrow(/permission denied/); }
  finally { await db.exec('RESET ROLE'); }
});
it('crew requirements reject a different company', async () => {
  await expect(db.query('SELECT get_crew_job_requirements($1,$2)', [job,otherTenant])).rejects.toThrow(/Assignment not found/);
});
it('required proof must belong to the same job and company; saved response reads back', async () => {
  await expect(db.query('SELECT save_crew_checklist_response($1,$2,$3,$4,true,NULL)', [job,tenant,checklist,item])).rejects.toThrow(/Photo proof required/);
  await expect(db.query('SELECT save_crew_checklist_response($1,$2,$3,$4,true,$5)', [job,tenant,checklist,item,'60000000-0000-0000-0000-000000000099'])).rejects.toThrow(/does not belong/);
  await db.query('SELECT save_crew_checklist_response($1,$2,$3,$4,true,$5)', [job,tenant,checklist,item,photo]);
  const result = await db.query<{requirements: {checklistItems: Array<{isChecked: boolean; proofPhotoId: string}>}}>('SELECT get_crew_job_requirements($1,$2) AS requirements', [job,tenant]);
  expect(result.rows[0].requirements.checklistItems[0]).toMatchObject({isChecked:true,proofPhotoId:photo});
  expect((await db.query<{ok: boolean}>('SELECT crew.checklist_met($1,$2,$3) AS ok',[tenant,job,user])).rows[0].ok).toBe(true);
});
it('a second incomplete checklist blocks completion', async () => {
  const second = '40000000-0000-0000-0000-000000000002';
  await db.query('INSERT INTO crew.job_checklists(id,job_id,company_id,template_id) VALUES ($1,$2,$3,$1)',[second,job,tenant]);
  await db.query("INSERT INTO crew.checklist_items(template_id,requires_photo,is_required) VALUES($1,false,true)",[second]);
  expect((await db.query<{ok: boolean}>('SELECT crew.checklist_met($1,$2,$3) AS ok',[tenant,job,user])).rows[0].ok).toBe(false);
});
it('reward claim cannot pay pending rewards or cross company boundaries; duplicate claims are safe', async () => {
  const id = '70000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO achievement_rewards(id,tenant_id,user_id,status) VALUES($1,$2,$3,'pending')",[id,tenant,user]);
  await expect(db.query('SELECT claim_canvass_reward($1,$2)',[id,tenant])).rejects.toThrow(/not ready/);
  await expect(db.query('SELECT claim_canvass_reward($1,$2)',[id,otherTenant])).rejects.toThrow(/Forbidden/);
  await db.query("UPDATE achievement_rewards SET status='sent' WHERE id=$1",[id]);
  await db.query('SELECT claim_canvass_reward($1,$2)',[id,tenant]);
  const result = await db.query<{result: {already_claimed: boolean}}>('SELECT claim_canvass_reward($1,$2) AS result',[id,tenant]);
  expect(result.rows[0].result.already_claimed).toBe(true);
});
