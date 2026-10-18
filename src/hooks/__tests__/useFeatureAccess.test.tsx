import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ tenantId: 'jae', disabled: false, eq: vi.fn() }));
vi.mock('@/hooks/useEffectiveTenantId', () => ({ useEffectiveTenantId: () => state.tenantId }));
vi.mock('@/contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ profile: { role: 'project_manager', tenant_id: 'home-company' } }),
}));
vi.mock('@/hooks/usePlatformFeatureFlags', () => ({
  usePlatformFeatureFlags: () => ({
    isPlatformDisabled: () => state.disabled, getReason: () => null, isLoading: false,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: state.eq }) }) },
}));
import { useFeatureAccess } from '../useFeatureAccess';

function mountAccess() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFeatureAccess(), { wrapper });
}

describe('Storm Canvass company access', () => {
  beforeEach(() => {
    state.tenantId = 'jae';
    state.disabled = false;
    state.eq.mockReset();
    state.eq.mockImplementation((_column, id) => ({ single: async () => ({
      data: { features_enabled: id === 'jae' ? ['storm_canvass'] : [] }, error: null,
    }) }));
  });

  it('allows ordinary JAE users when Storm Canvass is explicitly enabled', async () => {
    const { result } = mountAccess();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasFeature('storm_canvass')).toBe(true);
    expect(state.eq).toHaveBeenCalledWith('id', 'jae');
  });

  it('checks the selected company instead of the profile home company after switching', async () => {
    const { result, rerender } = mountAccess();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    state.tenantId = 'other-company';
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(state.eq).toHaveBeenCalledWith('id', 'other-company');
    expect(result.current.hasFeature('storm_canvass')).toBe(false);
  });

  it('continues respecting platform restrictions', async () => {
    state.disabled = true;
    const { result } = mountAccess();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasFeature('storm_canvass')).toBe(false);
  });
});