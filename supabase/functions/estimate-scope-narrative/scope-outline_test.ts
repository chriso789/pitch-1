import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildScopeOutline, formatScopeOutline, isRemovalItem, missingPhases } from './scope-outline.ts';

const items = [
  { item_name: 'Shingles GAF Timberline HDZ', item_type: 'material', trade_type: 'Roofing' },
  { item_name: 'Synthetic Underlayment', item_type: 'material', trade_type: 'Roofing' },
  { item_name: 'Tear Off', item_type: 'labor', trade_type: 'Roofing' },
  { item_name: 'Shingle Install', item_type: 'labor', trade_type: 'Roofing' },
  { item_name: 'Remove existing gutters', item_type: 'labor', trade_type: 'Gutters' },
];

Deno.test('tear-off and remove labor items are removal work', () => {
  assert(isRemovalItem({ item_name: 'Tile Tear Off', item_type: 'labor' }));
  assert(isRemovalItem({ item_name: 'Remove siding', item_type: 'labor' }));
  assert(!isRemovalItem({ item_name: 'Shingle Install', item_type: 'labor' }));
  // A material named "drip edge" or similar is never removal work.
  assert(!isRemovalItem({ item_name: 'Strip shingles starter', item_type: 'material' }));
});

Deno.test('outline lists removal first, then install labor with its materials', () => {
  const outline = buildScopeOutline(items);
  assertEquals(outline.removal.map((i) => i.item_name), ['Tear Off', 'Remove existing gutters']);
  assertEquals(outline.installLaborByTrade.get('Roofing')?.map((i) => i.item_name), ['Shingle Install']);
  assertEquals(outline.materialsByTrade.get('Roofing')?.length, 2);
  const text = formatScopeOutline(outline);
  const removalAt = text.indexOf('REMOVAL / TEAR-OFF');
  const installAt = text.indexOf('INSTALLATION — Roofing');
  assert(removalAt >= 0 && removalAt < 5 && installAt > removalAt);
  assert(text.indexOf('Shingle Install') < text.indexOf('Shingles GAF Timberline HDZ'));
});

Deno.test('narrative missing the tear-off is flagged', () => {
  const outline = buildScopeOutline(items);
  assertEquals(missingPhases('- Install new GAF Timberline HDZ shingles.', outline), ['removal']);
  assertEquals(missingPhases('- Tear off the existing roof.\n- Install new shingles.', outline), []);
});

Deno.test('no removal labor means no removal requirement', () => {
  const outline = buildScopeOutline(items.filter((i) => !isRemovalItem(i)));
  assertEquals(missingPhases('- Install new shingles.', outline), []);
});
