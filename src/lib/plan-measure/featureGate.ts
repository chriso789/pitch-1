/**
 * Plan Measurement is not active on the production domain until its accuracy has been
 * signed off. Preview/dev hosts get it; production needs an explicit per-browser opt-in
 * (`localStorage['pitch.planMeasure'] = '1'`). This is a rollout switch, not a security
 * boundary — data access is enforced by RLS.
 */
const PROD_HOSTS = ['pitch-crm.ai', 'www.pitch-crm.ai', 'pitch-1.lovable.app'];
export function isPlanMeasureEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!PROD_HOSTS.includes(window.location.hostname)) return true;
  try { return window.localStorage.getItem('pitch.planMeasure') === '1'; } catch { return false; }
}
