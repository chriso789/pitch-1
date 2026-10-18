import { describe, it, expect, vi } from 'vitest';
import { authorizeLookup } from '../../supabase/functions/_shared/skip-trace/access';

function setup(signedIn = true, membership = true, propertyTenant = 'jae', active = true) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const service = { from(table: string) {
    const filters: Record<string, unknown> = {};
    queries.push({ table, filters });
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
      maybeSingle: async () => ({ data:
        table === 'profiles' ? { tenant_id: 'home' } :
        table === 'user_company_access' ? (membership ? { tenant_id: 'jae' } : null) :
        table === 'tenants' ? { is_active: active, deleted_at: null } :
        table === 'canvassiq_properties' && filters.tenant_id === propertyTenant ? { id: 'pin', tenant_id: propertyTenant } : null,
      }),
    };
    return builder;
  } };
  const user = { auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: 'rep' } : null }, error: null })) } };
  return { service, user, queries };
}

describe('Homeowner lookup authorization', () => {
  it('rejects signed-out callers before any company/property query', async () => {
    const s = setup(false);
    expect((await authorizeLookup(s.user, s.service, 'jae', 'pin')).status).toBe(401);
    expect(s.queries).toHaveLength(0);
  });
  it('rejects a selected company without active membership', async () => {
    const s = setup(true, false);
    expect((await authorizeLookup(s.user, s.service, 'jae', 'pin')).status).toBe(403);
    expect(s.queries.find(q => q.table === 'user_company_access')?.filters).toEqual({ user_id: 'rep', tenant_id: 'jae', is_active: true });
    expect(s.queries.some(q => q.table === 'canvassiq_properties')).toBe(false);
  });
  it('rejects a pin belonging to another company', async () => {
    const s = setup(true, true, 'other');
    expect((await authorizeLookup(s.user, s.service, 'jae', 'pin')).status).toBe(404);
  });
  it('rejects inactive companies', async () => {
    const s = setup(true, true, 'jae', false);
    expect((await authorizeLookup(s.user, s.service, 'jae', 'pin')).status).toBe(403);
  });
  it('allows a switched-company member only for their company-owned pin', async () => {
    const s = setup();
    const result = await authorizeLookup(s.user, s.service, 'jae', 'pin');
    expect(result.status).toBe(200);
    expect(result.tenantId).toBe('jae');
    expect(s.queries.find(q => q.table === 'canvassiq_properties')?.filters).toEqual({ id: 'pin', tenant_id: 'jae' });
  });
});