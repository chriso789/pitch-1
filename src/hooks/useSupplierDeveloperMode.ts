// Single source of truth for "should this user see supplier developer
// surfaces?" (raw OAuth payloads, callback logs, WAF debug, environment
// labels, sandbox helpers, etc.).
//
// Surfaces that previously rolled their own role check disagreed about
// who counts as a developer — Cox Roofing's tenant admins were seeing
// sandbox-only widgets meant for the O'Brien platform team. Anything
// that wants to gate a dev-only block MUST consume this hook so the
// rules stay consistent across ABC / SRS / QXO settings.

import { useCurrentUser } from './useCurrentUser';

export interface SupplierDeveloperMode {
  isDeveloper: boolean;
  /** True for the master/platform role only. */
  isMaster: boolean;
  /** True for any flag that should reveal sandbox/staging UI. */
  showSandboxSurfaces: boolean;
}

export function useSupplierDeveloperMode(): SupplierDeveloperMode {
  const { user } = useCurrentUser();
  const role = (user?.role || '').toLowerCase();
  const isMaster = role === 'master' || role === 'cob';
  const isDeveloper = !!user?.is_developer || isMaster;
  return {
    isDeveloper,
    isMaster,
    showSandboxSurfaces: isDeveloper,
  };
}
