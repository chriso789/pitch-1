// Builds a schematic, phase-ordered outline of an estimate so the AI scope
// always walks the customer through removal work first and then the
// installation of the materials, instead of describing materials alone.

export interface ScopeItem {
  item_name?: string;
  description?: string | null;
  qty?: number;
  unit?: string;
  item_type?: string;
  trade_type?: string;
  emphasize?: boolean;
}

const REMOVAL_PATTERN =
  /\b(tear[\s-]*off|tear[\s-]*out|tearoff|remove|removal|removing|demo|demolition|demolish|strip|stripping|detach|abate|abatement)\b/i;

export function isRemovalItem(item: ScopeItem): boolean {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'material') return false;
  return REMOVAL_PATTERN.test(`${item.item_name || ''} ${item.description || ''}`);
}

function tradeKey(item: ScopeItem): string {
  return (item.trade_type || '').trim() || 'General';
}

function label(item: ScopeItem): string {
  const name = (item.item_name || 'Item').trim();
  const desc = item.description ? ` — ${String(item.description).trim()}` : '';
  return `${name}${desc}${item.emphasize ? ' [EMPHASIZE]' : ''}`;
}

export interface ScopeOutline {
  removal: ScopeItem[];
  tradeOrder: string[];
  installLaborByTrade: Map<string, ScopeItem[]>;
  materialsByTrade: Map<string, ScopeItem[]>;
  turnkey: ScopeItem[];
  other: ScopeItem[];
}

export function buildScopeOutline(items: ScopeItem[]): ScopeOutline {
  const outline: ScopeOutline = {
    removal: [],
    tradeOrder: [],
    installLaborByTrade: new Map(),
    materialsByTrade: new Map(),
    turnkey: [],
    other: [],
  };
  const addTrade = (t: string) => {
    if (!outline.tradeOrder.includes(t)) outline.tradeOrder.push(t);
  };
  for (const item of items) {
    const type = (item.item_type || '').toLowerCase();
    if (type === 'turnkey') {
      outline.turnkey.push(item);
    } else if (isRemovalItem(item)) {
      outline.removal.push(item);
    } else if (type === 'labor') {
      const t = tradeKey(item);
      addTrade(t);
      outline.installLaborByTrade.set(t, [...(outline.installLaborByTrade.get(t) || []), item]);
    } else if (type === 'material') {
      const t = tradeKey(item);
      addTrade(t);
      outline.materialsByTrade.set(t, [...(outline.materialsByTrade.get(t) || []), item]);
    } else {
      outline.other.push(item);
    }
  }
  return outline;
}

/** Plain-text outline handed to the AI as the order the scope must follow. */
export function formatScopeOutline(outline: ScopeOutline): string {
  const lines: string[] = [];
  let step = 1;
  if (outline.removal.length > 0) {
    lines.push(`${step++}. REMOVAL / TEAR-OFF (labor — describe first):`);
    outline.removal.forEach((it) => lines.push(`   - ${label(it)}`));
  }
  for (const trade of outline.tradeOrder) {
    const labor = outline.installLaborByTrade.get(trade) || [];
    const materials = outline.materialsByTrade.get(trade) || [];
    lines.push(`${step++}. INSTALLATION${trade !== 'General' ? ` — ${trade}` : ''}:`);
    if (labor.length > 0) {
      lines.push('   Installation labor:');
      labor.forEach((it) => lines.push(`   - ${label(it)}`));
    }
    if (materials.length > 0) {
      lines.push('   Materials being installed:');
      materials.forEach((it) => lines.push(`   - ${label(it)}`));
    }
  }
  if (outline.turnkey.length > 0) {
    lines.push(`${step++}. TURNKEY SCOPES:`);
    outline.turnkey.forEach((it) => lines.push(`   - ${label(it)}`));
  }
  if (outline.other.length > 0) {
    lines.push(`${step++}. OTHER INCLUDED ITEMS:`);
    outline.other.forEach((it) => lines.push(`   - ${label(it)}`));
  }
  return lines.join('\n');
}

const REMOVAL_WORDS = /\b(tear[\s-]*off|tear[\s-]*out|tearoff|remov\w*|demo\w*|strip\w*|detach\w*|abate\w*)\b/i;
const INSTALL_WORDS = /\b(install\w*|replac\w*|appl(y|ied|ies)|new)\b/i;

/** Returns the phases a generated narrative failed to mention. */
export function missingPhases(narrative: string, outline: ScopeOutline): string[] {
  const missing: string[] = [];
  if (outline.removal.length > 0 && !REMOVAL_WORDS.test(narrative)) missing.push('removal');
  const hasInstallWork = outline.tradeOrder.length > 0;
  if (hasInstallWork && !INSTALL_WORDS.test(narrative)) missing.push('installation');
  return missing;
}
