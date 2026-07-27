// Payload-contract tests.
//
// Acceptance gate: the exact approved, color-specific supplier item code must
// appear in the server-generated outbound payload — in the correct field, for
// the correct supplier — and nothing the browser sends can change it.
//
// Item numbers below are clearly-marked TEST values. They are never written to
// `supplier_item_mappings` and are never used as production mappings.

import { describe, it, expect } from 'vitest';
import {
  resolveSupplierLines,
  preflightSupplierOrder,
  buildIdempotencyKey,
  hashPayload,
} from '../../supabase/functions/_shared/supplier-resolution.ts';
import {
  buildAbcOrderPayload,
  buildSrsOrderPayload,
  buildOrderPayload,
} from '../../supabase/functions/_shared/supplier-payload.ts';

const TENANT = 't-1';
const CONN_ABC = 'conn-abc';
const CONN_SRS = 'conn-srs';
const BRANCH_A = '0123';
const BRANCH_B = '0456';

const fresh = new Date().toISOString();

const MFR = {
  gaf: { id: 'mfr-gaf', name: 'GAF' },
  oc: { id: 'mfr-oc', name: 'Owens Corning' },
};
const PLINE = {
  hdz: { id: 'pl-hdz', name: 'Timberline HDZ' },
  duration: { id: 'pl-duration', name: 'Duration' },
};

const variant = (o: Partial<any>) => ({
  profile: null,
  dimensions: null,
  packaging: 'Bundle',
  canonical_uom: 'BD',
  requires_color: true,
  is_active: true,
  ...o,
});

const VARIANTS: any[] = [
  variant({
    id: 'v-hdz-field', manufacturer_id: MFR.gaf.id, product_line_id: PLINE.hdz.id,
    variant_name: 'Timberline HDZ Field Shingle', profile: 'Laminate',
    mfr_manufacturers: MFR.gaf, mfr_product_lines: PLINE.hdz,
  }),
  variant({
    id: 'v-hdz-ridge', manufacturer_id: MFR.gaf.id, product_line_id: PLINE.hdz.id,
    variant_name: 'Seal-A-Ridge Hip & Ridge', profile: 'Ridge Cap',
    mfr_manufacturers: MFR.gaf, mfr_product_lines: PLINE.hdz,
  }),
  variant({
    id: 'v-hdz-starter', manufacturer_id: MFR.gaf.id, product_line_id: PLINE.hdz.id,
    variant_name: 'Pro-Start Starter Strip', profile: 'Starter', requires_color: false,
    mfr_manufacturers: MFR.gaf, mfr_product_lines: PLINE.hdz,
  }),
  variant({
    id: 'v-dur-field', manufacturer_id: MFR.oc.id, product_line_id: PLINE.duration.id,
    variant_name: 'Duration Field Shingle', profile: 'Laminate',
    mfr_manufacturers: MFR.oc, mfr_product_lines: PLINE.duration,
  }),
];

const COLORS: any[] = [
  { id: 'c-hdz-charcoal', product_line_id: PLINE.hdz.id, canonical_name: 'Charcoal', manufacturer_color_code: 'HDZ-CHR', is_active: true },
  { id: 'c-hdz-barkwood', product_line_id: PLINE.hdz.id, canonical_name: 'Barkwood', manufacturer_color_code: 'HDZ-BWD', is_active: true },
  { id: 'c-dur-estate', product_line_id: PLINE.duration.id, canonical_name: 'Estate Gray', manufacturer_color_code: 'DUR-EGR', is_active: true },
];

let seq = 0;
const mapping = (o: Partial<any>) => ({
  id: `m-${++seq}`,
  supplier: 'abc',
  supplier_connection_id: CONN_ABC,
  supplier_account_number: 'ACCT-TEST',
  branch_code: BRANCH_A,
  supplier_catalog_item_id: null,
  supplier_description: 'TEST catalog description',
  supplier_color_name: null,
  supplier_uom: 'BD',
  status: 'active',
  approval_state: 'approved',
  mapping_source: 'api',
  superseded_by: null,
  effective_from: '2020-01-01T00:00:00Z',
  effective_to: null,
  validated_at: fresh,
  catalog_fingerprint: 'fp-test',
  revision: 3,
  ...o,
});

const MAPPINGS: any[] = [
  mapping({ variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', supplier_item_number: 'ABC-TEST-HDZ-CHR', supplier_color_name: 'Charcoal', supplier_description: 'TIMBERLINE HDZ CHARCOAL' }),
  mapping({ variant_id: 'v-hdz-field', color_id: 'c-hdz-barkwood', supplier_item_number: 'ABC-TEST-HDZ-BWD', supplier_color_name: 'Barkwood' }),
  mapping({ variant_id: 'v-hdz-ridge', color_id: 'c-hdz-charcoal', supplier_item_number: 'ABC-TEST-SAR-CHR', supplier_color_name: 'Charcoal' }),
  mapping({ variant_id: 'v-hdz-starter', color_id: null, supplier_item_number: 'ABC-TEST-PROSTART', supplier_uom: 'BD' }),
  mapping({ variant_id: 'v-dur-field', color_id: 'c-dur-estate', supplier_item_number: 'ABC-TEST-DUR-EGR', supplier_color_name: 'Estate Gray' }),

  // SRS — same Pitch products, different connection, different codes + catalog ids
  mapping({ supplier: 'srs', supplier_connection_id: CONN_SRS, variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', supplier_item_number: 'SRS-TEST-HDZCHR', supplier_catalog_item_id: '900111', supplier_color_name: 'Charcoal' }),
  mapping({ supplier: 'srs', supplier_connection_id: CONN_SRS, variant_id: 'v-hdz-ridge', color_id: 'c-hdz-charcoal', supplier_item_number: 'SRS-TEST-SARCHR', supplier_catalog_item_id: '900222', supplier_color_name: 'Charcoal' }),
  mapping({ supplier: 'srs', supplier_connection_id: CONN_SRS, variant_id: 'v-hdz-starter', color_id: null, supplier_item_number: 'SRS-TEST-PROSTART', supplier_catalog_item_id: '900333' }),

  // A suggestion-grade row that was never approved — must never reach a payload.
  mapping({ variant_id: 'v-dur-field', color_id: 'c-hdz-charcoal', supplier_item_number: 'ABC-TEST-FUZZY', approval_state: 'pending', mapping_source: 'catalog_import' }),
];

function stubClient(tenantId: string) {
  return {
    from(table: string) {
      const q: any = {
        _tenant: null as string | null,
        _supplier: null as string | null,
        _ids: [] as string[],
        select() { return q; },
        eq(col: string, val: any) {
          if (col === 'tenant_id') q._tenant = val;
          if (col === 'supplier') q._supplier = val;
          return q;
        },
        in(_col: string, vals: string[]) { q._ids = vals; return q; },
        then(resolve: any) {
          if (q._tenant !== tenantId || tenantId !== TENANT) return resolve({ data: [] });
          if (table === 'mfr_product_variants') return resolve({ data: VARIANTS.filter((v) => q._ids.includes(v.id)) });
          if (table === 'mfr_colors') return resolve({ data: COLORS.filter((c) => q._ids.includes(c.id)) });
          if (table === 'supplier_item_mappings') {
            return resolve({ data: MAPPINGS.filter((m) => m.supplier === q._supplier && q._ids.includes(m.variant_id)) });
          }
          return resolve({ data: [] });
        },
      };
      return q;
    },
  };
}

/** A realistic 3-line reroof order: field shingle + matching ridge cap + starter. */
const ORDER_LINES = [
  { key: 'field', variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', uom: 'BD', quantity: 96 },
  { key: 'ridge', variant_id: 'v-hdz-ridge', color_id: 'c-hdz-charcoal', uom: 'BD', quantity: 8 },
  { key: 'starter', variant_id: 'v-hdz-starter', color_id: null, uom: 'BD', quantity: 6 },
];

const HEADER = {
  po_number: 'PO-TEST-1001',
  job_number: 'J-1001',
  customer_name: 'Test Customer',
  ship_to_number: 'SHIP-TEST-1',
  account_number: 'ACCT-TEST',
  branch_code: BRANCH_A,
  requested_delivery_date: '2026-08-10',
  delivery_address: { line1: '123 Test St', city: 'North Port', state: 'FL', postal_code: '34286' },
  notes: 'Sandbox contract test — do not fulfill.',
};

const resolve = (scope: any, lines: any[] = ORDER_LINES, tenant = TENANT) =>
  resolveSupplierLines(stubClient(tenant), tenant, {
    supplier: 'abc', supplier_connection_id: CONN_ABC, supplier_account_number: 'ACCT-TEST',
    branch_code: BRANCH_A, ...scope, lines,
  });

const abcScope = {};
const srsScope = { supplier: 'srs', supplier_connection_id: CONN_SRS };

describe('supplier payload contract — resolved code reaches the outbound payload', () => {
  it('ABC: the exact approved item number appears in lines[].itemNumber', async () => {
    const lines = await resolve(abcScope);
    expect(lines.every((l) => l.ok)).toBe(true);
    const payload: any = buildAbcOrderPayload(lines, HEADER);
    expect(payload.lines.map((l: any) => l.itemNumber)).toEqual([
      'ABC-TEST-HDZ-CHR',
      'ABC-TEST-SAR-CHR',
      'ABC-TEST-PROSTART',
    ]);
    expect(payload.lines[0].colorName).toBe('Charcoal');
    expect(payload.lines[0].uom).toBe('BD');
    expect(payload.branchNumber).toBe(BRANCH_A);
    expect(payload.shipToNumber).toBe('SHIP-TEST-1');
  });

  it('SRS: the exact approved code appears in orderLineItems[].productId / productNumber', async () => {
    const lines = await resolve(srsScope);
    expect(lines.every((l) => l.ok)).toBe(true);
    const payload: any = buildSrsOrderPayload(lines, HEADER);
    expect(payload.orderLineItems.map((l: any) => l.productId)).toEqual(['900111', '900222', '900333']);
    expect(payload.orderLineItems.map((l: any) => l.productNumber)).toEqual([
      'SRS-TEST-HDZCHR',
      'SRS-TEST-SARCHR',
      'SRS-TEST-PROSTART',
    ]);
    expect(payload.orderLineItems[0].orderLineItemDetails.color).toBe('Charcoal');
    expect(payload.branchId).toBe(BRANCH_A);
  });

  it('the same Pitch product/color yields different codes for ABC and SRS', async () => {
    const abc: any = buildAbcOrderPayload(await resolve(abcScope), HEADER);
    const srs: any = buildSrsOrderPayload(await resolve(srsScope), HEADER);
    expect(abc.lines[0].itemNumber).toBe('ABC-TEST-HDZ-CHR');
    expect(srs.orderLineItems[0].productNumber).toBe('SRS-TEST-HDZCHR');
    expect(abc.lines[0].itemNumber).not.toBe(srs.orderLineItems[0].productNumber);
  });

  it('changing the color changes the outbound supplier code', async () => {
    const charcoal: any = buildAbcOrderPayload(await resolve(abcScope, [ORDER_LINES[0]]), HEADER);
    const barkwood: any = buildAbcOrderPayload(
      await resolve(abcScope, [{ ...ORDER_LINES[0], color_id: 'c-hdz-barkwood' }]),
      HEADER,
    );
    expect(charcoal.lines[0].itemNumber).toBe('ABC-TEST-HDZ-CHR');
    expect(barkwood.lines[0].itemNumber).toBe('ABC-TEST-HDZ-BWD');
  });

  it('field shingle and ridge cap carry their own distinct codes in one payload', async () => {
    const payload: any = buildAbcOrderPayload(await resolve(abcScope), HEADER);
    const codes = payload.lines.map((l: any) => l.itemNumber);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('switching supplier invalidates the previous resolution (no ABC code in an SRS payload)', async () => {
    const srs: any = buildSrsOrderPayload(await resolve(srsScope), HEADER);
    const json = JSON.stringify(srs);
    expect(json).not.toContain('ABC-TEST-');
  });

  it('changing branch forces revalidation and blocks payload build', async () => {
    const lines = await resolve({ branch_code: BRANCH_B });
    expect(lines.every((l) => l.ok)).toBe(false);
    expect(() => buildAbcOrderPayload(lines, { ...HEADER, branch_code: BRANCH_B })).toThrow(
      /payload_build_blocked/,
    );
  });

  it('an unapproved (fuzzy-suggested) mapping can never appear in a payload', async () => {
    const lines = await resolve(abcScope, [
      { key: 'bad', variant_id: 'v-dur-field', color_id: 'c-hdz-charcoal', uom: 'BD', quantity: 10 },
    ]);
    expect(lines[0].ok).toBe(false);
    expect(() => buildAbcOrderPayload(lines, HEADER)).toThrow(/payload_build_blocked/);
  });

  it('one blocked line blocks the entire order', async () => {
    const lines = await resolve(abcScope, [
      ...ORDER_LINES,
      { key: 'unmapped', variant_id: 'v-dur-field', color_id: 'c-dur-estate', uom: 'SQ', quantity: 5 },
    ]);
    const pre = await preflightSupplierOrder(stubClient(TENANT), TENANT, {
      supplier: 'abc', supplier_connection_id: CONN_ABC, supplier_account_number: 'ACCT-TEST',
      branch_code: BRANCH_A,
      lines: [
        ...ORDER_LINES,
        { key: 'unmapped', variant_id: 'v-dur-field', color_id: 'c-dur-estate', uom: 'SQ', quantity: 5 },
      ],
    });
    expect(pre.ok).toBe(false);
    expect(pre.blocking).toHaveLength(1);
    expect(() => buildAbcOrderPayload(lines, HEADER)).toThrow(/payload_build_blocked/);
  });

  it('client-supplied item codes, colors, UOM and price are ignored by the payload builder', async () => {
    // Simulate a tampered client request: extra fields on each line.
    const tampered = ORDER_LINES.map((l) => ({
      ...l,
      supplier_item_number: 'HACKED-CODE',
      supplier_uom: 'EA',
      unit_price: 0.01,
      color_name: 'Hacked Color',
      branch_code: 'HACKED-BRANCH',
    }));
    const lines = await resolve(abcScope, tampered);
    const payload: any = buildAbcOrderPayload(lines, HEADER);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('HACKED');
    expect(json).not.toContain('0.01');
    expect(payload.lines[0].itemNumber).toBe('ABC-TEST-HDZ-CHR');
    expect(payload.lines[0].uom).toBe('BD');
  });

  it('every outbound line keeps internal traceability back to the approved mapping', async () => {
    const payload: any = buildAbcOrderPayload(await resolve(abcScope), HEADER);
    for (const l of payload.lines) {
      expect(l._pitch_trace.supplier_mapping_id).toBeTruthy();
      expect(l._pitch_trace.supplier_mapping_revision).toBe(3);
      expect(l._pitch_trace.validated_at).toBeTruthy();
    }
    expect(payload.lines[0]._pitch_trace.manufacturer).toBe('GAF');
    expect(payload.lines[0]._pitch_trace.product_line).toBe('Timberline HDZ');
    expect(payload.lines[0]._pitch_trace.manufacturer_color_code).toBe('HDZ-CHR');
  });

  it('resolution exposes the mapping source and approval state for the preview table', async () => {
    const [l] = await resolve(abcScope, [ORDER_LINES[0]]);
    expect(l.mapping_source).toBe('api');
    expect(l.approval_state).toBe('approved');
  });

  it('buildOrderPayload dispatches to the right supplier builder', async () => {
    const abc: any = buildOrderPayload('abc', await resolve(abcScope), HEADER);
    const srs: any = buildOrderPayload('srs', await resolve(srsScope), HEADER);
    expect(abc.lines).toBeDefined();
    expect(srs.orderLineItems).toBeDefined();
    expect(() => buildOrderPayload('qxo', [], HEADER)).toThrow(/unsupported_supplier/);
  });

  it('the idempotency key is stable for an identical payload and changes when the color changes', async () => {
    const a: any = buildAbcOrderPayload(await resolve(abcScope), HEADER);
    const b: any = buildAbcOrderPayload(await resolve(abcScope), HEADER);
    const c: any = buildAbcOrderPayload(
      await resolve(abcScope, [{ ...ORDER_LINES[0], color_id: 'c-hdz-barkwood' }, ORDER_LINES[1], ORDER_LINES[2]]),
      HEADER,
    );
    const key = async (p: unknown) =>
      buildIdempotencyKey({
        tenantId: TENANT, supplier: 'abc', materialOrderId: 'mo-1', orderVersion: 1,
        payloadHash: await hashPayload(p),
      });
    expect(await key(a)).toBe(await key(b));
    expect(await key(a)).not.toBe(await key(c));
  });
});
