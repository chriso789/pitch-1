import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const tenantA = '20000000-0000-0000-0000-000000000001';
const tenantB = '20000000-0000-0000-0000-000000000002';
const admin = '10000000-0000-0000-0000-000000000001';
const rep = '10000000-0000-0000-0000-000000000002';
beforeAll(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user_id', true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;`);
  for (const file of [
    '20250918012708_178e6df0-e95d-4635-bba2-ac68205f4808.sql',
    '20250918013258_e5d4a068-1422-4d74-bad3-5ebf1d39d9cb.sql',
    '20250918013409_13804517-6975-47f4-8407-597bfe73c49d.sql',
    '20250918013502_8190c539-1d51-4e8a-9a27-e2ea64e4b3ca.sql',
    '20250918013547_a4532217-ff8e-4739-9ff2-c024e887aabd.sql',
    '20250918013954_80e4ea59-68ac-4e38-b5d0-beee6874f727.sql',
    '20250918045028_d2370a71-1b48-4476-ac41-fb6a64b61b35.sql',
    '20250918045128_d6c67bd1-bc49-4477-b291-8e0a6c2f8610.sql',
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await db.exec('GRANT SELECT, UPDATE ON public.tenant_settings TO authenticated;');
  await db.query('INSERT INTO tenants(id,name) VALUES($1,\'A\'),($2,\'B\')',[tenantA,tenantB]);
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[admin,rep]);
  await db.query("INSERT INTO profiles(id,tenant_id,role) VALUES($1,$3,'admin'),($2,$3,'rep')",[admin,rep,tenantA]);
  await db.query('INSERT INTO tenant_settings(tenant_id) VALUES($1),($2)',[tenantA,tenantB]);
}, 30000);
afterAll(() => db.close());
it('initial role policies replay in chronological order without missing overloads or duplicate policies', async () => {
  const result = await db.query<{count: number}>('SELECT count(*)::integer AS count FROM pg_policies WHERE schemaname=\'public\'');
  expect(result.rows[0].count).toBeGreaterThan(30);
});
it('bootstrap fixes preserve admin company boundaries and refuse rep setting updates', async () => {
  await db.query("SELECT set_config('test.user_id',$1,false)",[admin]);
  await db.exec('SET ROLE authenticated');
  try {
    expect((await db.query('UPDATE tenant_settings SET portal_show_photos=false WHERE tenant_id=$1 RETURNING id',[tenantA])).rows).toHaveLength(1);
    expect((await db.query('UPDATE tenant_settings SET portal_show_photos=false WHERE tenant_id=$1 RETURNING id',[tenantB])).rows).toHaveLength(0);
    await db.query("SELECT set_config('test.user_id',$1,false)",[rep]);
    expect((await db.query('UPDATE tenant_settings SET portal_show_photos=true WHERE tenant_id=$1 RETURNING id',[tenantA])).rows).toHaveLength(0);
  } finally { await db.exec('RESET ROLE'); }
});

it('calls are created before their campaign, list-item and disposition references', async () => {
  const result = await db.query<{count:number}>("SELECT count(*)::integer AS count FROM pg_constraint WHERE conrelid='public.calls'::regclass AND contype='f'");
  expect(result.rows[0].count).toBe(4);
  const policies = await db.query<{count:number}>("SELECT count(*)::integer AS count FROM pg_policies WHERE schemaname='public' AND tablename='calls'");
  expect(policies.rows[0].count).toBe(4);
});
