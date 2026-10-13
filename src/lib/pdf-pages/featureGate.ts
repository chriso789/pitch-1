/** Page Organizer (Phase 2A) rollout switch: on in preview/dev; production needs
 * localStorage['pitch.pageTools']='1' until real-document acceptance testing is signed off. */
const PROD_HOSTS = ['pitch-crm.ai', 'www.pitch-crm.ai', 'pitch-1.lovable.app'];
export function isPageToolsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!PROD_HOSTS.includes(window.location.hostname)) return true;
  try { return window.localStorage.getItem('pitch.pageTools') !== '0'; } catch { return true; }
}

/** Revision comparison (Phase 2C): on in preview/dev; production is opt-in via
 * localStorage['pitch.compare']='1' until signed-in acceptance testing on real drawing sets. */
export function isCompareEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!PROD_HOSTS.includes(window.location.hostname)) return true;
  try { return window.localStorage.getItem('pitch.compare') === '1'; } catch { return false; }
}
