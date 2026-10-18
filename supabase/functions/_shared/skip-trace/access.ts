// Only authenticated, active company members may look up a company-owned pin.
export async function authorizeLookup(userClient: any, service: any, requestedTenant: string | null, propertyId: string) {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return { status: 401, code: 'unauthorized' };
  const userId = data.user.id;
  const { data: profile } = await service.from('profiles').select('tenant_id').eq('id', userId).maybeSingle();
  const tenantId = requestedTenant || profile?.tenant_id;
  if (!tenantId) return { status: 403, code: 'no_tenant' };
  const { data: membership } = await service.from('user_company_access').select('tenant_id')
    .eq('user_id', userId).eq('tenant_id', tenantId).eq('is_active', true).maybeSingle();
  if (!membership && profile?.tenant_id !== tenantId) return { status: 403, code: 'no_tenant' };
  const { data: tenant } = await service.from('tenants').select('is_active,deleted_at').eq('id', tenantId).maybeSingle();
  if (!tenant?.is_active || tenant.deleted_at) return { status: 403, code: 'company_inactive' };
  const { data: property } = await service.from('canvassiq_properties').select('id,tenant_id,owner_name,address')
    .eq('id', propertyId).eq('tenant_id', tenantId).maybeSingle();
  if (!property) return { status: 404, code: 'property_not_found' };
  return { status: 200, code: 'authorized', tenantId, property };
}