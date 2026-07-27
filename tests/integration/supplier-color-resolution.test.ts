import { describe, it, expect } from 'vitest';
import {
  resolveSupplierLines,
  preflightSupplierOrder,
  buildIdempotencyKey,
  CATALOG_VALIDATION_MAX_AGE_MS,
} from '../../supabase/functions/_shared/supplier-resolution.ts';
import {
  buildAbcOrderPayload,
  buildSrsOrderPayload,
  reconcileSupplierOrder,
} from '../../supabase/functions/_shared/supplier-payload.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic GAF / Owens Corning shapes. Item numbers are clearly
// marked as test values and are never used as production mappings.
// ---------------------------------------------------------------------------

const TENANT = 't-1';
const OTHER_TENANT = 't-2';
const CONN_ABC = 'conn-abc';
const CONN_SRS = 'conn-srs';
const BRANCH_A = '123';
const BRANCH_B = '456';

const MFR = {
  gaf: { id: 'mfr-gaf', name: 'GAF' },
  oc: { id: 'mfr-oc', name: 'Owens Corning' },
};

const LINE = {
  hdz: { id: 'pl-hdz', name: 'Timberline HDZ', manufacturer_id: MFR.gaf.id },
  seala: { id: 'pl-seala', name: 'Timberline UHDZ', manufacturer_id: MFR.gaf.id },
  duration: { id: 'pl-duration', name: 'Duration', manufacturer_id: MFR.oc.id },
};

const VARIANTS = [
  {
    id: 'v-hdz-field', manufacturer_id: MFR.gaf.id, product_line_id: LINE.hdz.id,
    variant_name: 'Field Shingle', profile: 'Laminate', dimensions: null, packaging: 'Bundle',
    canonical_uom: 'BD', requires_color: true, is_active: true,
    mfr_manufacturers: MFR.gaf, mfr_product_lines: LINE.hdz,
  },
  {
    id: 'v-hdz-ridge', manufacturer_id: MFR.gaf.id, product_line_id: LINE.hdz.id,
    variant_name: 'Seal-A-Ridge Hip & Ridge', profile: 'Ridge Cap', dimensions: null, packaging: 'Bundle',
    canonical_uom: 'BD', requires_color: true, is_active: true,
    mfr_manufacturers: MFR.gaf, mfr_product_lines: LINE.hdz,
  },
  {
    id: 'v-uhdz-field', manufacturer_id: MFR.gaf.id, product_line_id: LINE.seala.id,
    variant_name: 'Field Shingle', profile: 'Laminate', dimensions: null, packaging: 'Bundle',
    canonical_uom: 'BD', requires_color: true, is_active: true,
    mfr_manufacturers: MFR.gaf, mfr_product_lines: LINE.seala,
  },
  {
    id: 'v-dur-field', manufacturer_id: MFR.oc.id, product_line_id: LINE.duration.id,
    variant_name: 'Field Shingle', profile: 'Laminate', dimensions: null, packaging: 'Bundle',
    canonical_uom: 'BD', requires_color: true, is_active: true,
    mfr_manufacturers: MFR.oc, mfr_product_lines: LINE.duration,
  },
  {
    id: 'v-drip', manufacturer_id: MFR.gaf.id, product_line_id: LINE.hdz.id,
    variant_name: 'Drip Edge 2x2', profile: 'D-Style', dimensions: '2in x 2in x 10ft', packaging: 'Piece',
    canonical_uom: 'PC', requires_color: false, is_active: true,
    mfr_manufacturers: MFR.gaf, mfr_product_lines: LINE.hdz,
  },
];

const COLORS = [
  { id: 'c-hdz-charcoal', product_line_id: LINE.hdz.id, canonical_name: 'Charcoal', manufacturer_color_code: 'HDZ-CHR', is_active: true },
  { id: 'c-uhdz-charcoal', product_line_id: LINE.seala.id, canonical_name: 'Charcoal', manufacturer_color_code: 'UHDZ-CHR', is_active: true },
  { id: 'c-dur-charcoal', product_line_id: LINE.duration.id, canonical_name: 'Charcoal', manufacturer_color_code: 'DUR-CHR', is_active: true },
  { id: 'c-dur-estate', product_line_id: LINE.duration.id, canonical_name: 'Estate Gray', manufacturer_color_code: 'DUR-EGR', is_active: true },
  { id: 'c-hdz-weathered', product_line_id: LINE.hdz.id, canonical_name: 'Weathered Wood', manufacturer_color_code: 'HDZ-WW', is_active: true },
];

const fresh = new Date().toISOString();
const stale = new Date(Date.now() - CATALOG_VALIDATION_MAX_AGE_MS - 60_000).toISOString();

let mappingSeq = 0;
const mapping = (o: Partial<any>) => ({
  id: `m-${++mappingSeq}`,
  supplier: 'abc',
  supplier_connection_id: CONN_ABC,
  supplier_account_number: 'ACCT-1',
  branch_code: BRANCH_A,
  supplier_catalog_item_id: null,
  supplier_description: 'test description',
  supplier_color_name: null,
  supplier_uom: 'BD',
  status: 'active',
  approval_state: 'approved',
  superseded_by: null,
  effective_from: '2020-01-01T00:00:00Z',
  effective_to: null,
  validated_at: fresh,
  catalog_fingerprint: 'fp-1',
  revision: 1,
  ...o,
});

const MAPPINGS: any[] = [
  // GAF HDZ Charcoal — different code per supplier
  mapping({ id: 'm-abc-hdz-chr', variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', supplier: 'abc', supplier_item_number: 'ABC-TEST-HDZCHR', supplier_color_name: 'Charcoal' }),
  mapping({ id: 'm-srs-hdz-chr', variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', supplier: 'srs', supplier_connection_id: CONN_SRS, supplier_item_number: 'SRS-TEST-441122', supplier_catalog_item_id: '441122', supplier_color_name: 'Charcoal' }),
  // GAF HDZ ridge cap — a DIFFERENT code from the field shingle
  mapping({ id: 'm-abc-hdz-ridge', variant_id: 'v-hdz-ridge', color_id: 'c-hdz-charcoal', supplier: 'abc', supplier_item_number: 'ABC-TEST-SARCHR', supplier_color_name: 'Charcoal' }),
  // GAF HDZ Weathered Wood
  mapping({ id: 'm-abc-hdz-ww', variant_id: 'v-hdz-field', color_id: 'c-hdz-weathered', supplier: 'abc', supplier_item_number: 'ABC-TEST-HDZWW', supplier_color_name: 'Weathered Wood' }),
  // OC Duration Estate Gray, both suppliers
  mapping({ id: 'm-abc-dur-egr', variant_id: 'v-dur-field', color_id: 'c-dur-estate', supplier: 'abc', supplier_item_number: 'ABC-TEST-DUREGR', supplier_color_name: 'Estate Gray' }),
  mapping({ id: 'm-srs-dur-egr', variant_id: 'v-dur-field', color_id: 'c-dur-estate', supplier: 'srs', supplier_connection_id: CONN_SRS, supplier_item_number: 'SRS-TEST-559900', supplier_catalog_item_id: '559900', supplier_color_name: 'Estate Gray' }),
  // Accessory, no color
  mapping({ id: 'm-abc-drip', variant_id: 'v-drip', color_id: null, supplier: 'abc', supplier_uom: 'PC', supplier_item_number: 'ABC-TEST-DRIP22' }),
  // Inactive / discontinued / unapproved / stale / branch-B / ambiguous cases
  mapping({ id: 'm-abc-uhdz-chr', variant_id: 'v-uhdz-field', color_id: 'c-uhdz-charcoal', supplier: 'abc', supplier_item_number: 'ABC-TEST-UHDZCHR', status: 'discontinued' }),
  mapping({ id: 'm-abc-dur-chr', variant_id: 'v-dur-field', color_id: 'c-dur-charcoal', supplier: 'abc', supplier_item_number: 'ABC-TEST-DURCHR', validated_at: stale }),
];

/** Minimal service-client stub over the fixtures. */
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
          const tenantOk = q._tenant === tenantId && tenantId === TENANT;
          if (!tenantOk) return resolve({ data: [] });
          if (table === 'mfr_product_variants') {
            return resolve({ data: VARIANTS.filter((v) => q._ids.includes(v.id)) });
          }
          if (table === 'mfr_colors') {
            return resolve({ data: COLORS.filter((c) => q._ids.includes(c.id)) });
          }
          if (table === 'supplier_item_mappings') {
            return resolve({
              data: MAPPINGS.filter((m) => m.supplier === q._supplier && q._ids.includes(m.variant_id)),
            });
          }
          return resolve({ data: [] });
        },
      };
      return q;
    },
  };
}

const line = (o: Partial<any>) => ({ key: 'k1', variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal', uom: 'BD', quantity: 30, ...o });

const resolve = (scope: any, lines: any[], tenant = TENANT) =>
  resolveSupplierLines(stubClient(tenant), tenant, { supplier: 'abc', supplier_connection_id: CONN_ABC, branch_code: BRANCH_A, ...scope, lines });

// ---------------------------------------------------------------------------

describe('supplier item-code resolution', () => {
  it('resolves GAF Timberline HDZ / Charcoal to the correct ABC item number', async () => {
    const [r] = await resolve({}, [line({})]);
    expect(r.ok).toBe(true);
    expect(r.supplier_item_number).toBe('ABC-TEST-HDZCHR');
    expect(r.color_name).toBe('Charcoal');
  });

  it('resolves the same GAF product/color to a separate SRS item code', async () => {
    const [r] = await resolve({ supplier: 'srs', supplier_connection_id: CONN_SRS }, [line({})]);
    expect(r.ok).toBe(true);
    expect(r.supplier_item_number).toBe('SRS-TEST-441122');
    expect(r.supplier_item_number).not.toBe('ABC-TEST-HDZCHR');
  });

  it('resolves Owens Corning Duration / Estate Gray correctly for both suppliers', async () => {
    const l = line({ variant_id: 'v-dur-field', color_id: 'c-dur-estate' });
    const [abc] = await resolve({}, [l]);
    const [srs] = await resolve({ supplier: 'srs', supplier_connection_id: CONN_SRS }, [l]);
    expect(abc.supplier_item_number).toBe('ABC-TEST-DUREGR');
    expect(srs.supplier_item_number).toBe('SRS-TEST-559900');
  });

  it('never cross-matches the same color name across manufacturers', async () => {
    // OC Charcoal is a distinct color row; it must not resolve to GAF's Charcoal item.
    const [r] = await resolve({}, [line({ variant_id: 'v-dur-field', color_id: 'c-dur-charcoal' })]);
    expect(r.supplier_item_number).not.toBe('ABC-TEST-HDZCHR');
  });

  it('never cross-matches the same color name across product lines of one manufacturer', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-uhdz-field', color_id: 'c-uhdz-charcoal' })]);
    expect(r.supplier_item_number).not.toBe('ABC-TEST-HDZCHR');
  });

  it('rejects a color that belongs to a different product line', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-hdz-field', color_id: 'c-dur-estate' })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('color_not_in_product_line');
  });

  it('changing the color changes the resolved supplier item code', async () => {
    const [a] = await resolve({}, [line({ color_id: 'c-hdz-charcoal' })]);
    const [b] = await resolve({}, [line({ color_id: 'c-hdz-weathered' })]);
    expect(a.supplier_item_number).toBe('ABC-TEST-HDZCHR');
    expect(b.supplier_item_number).toBe('ABC-TEST-HDZWW');
  });

  it('field shingles and ridge caps resolve to different item codes', async () => {
    const [field] = await resolve({}, [line({ key: 'f', variant_id: 'v-hdz-field' })]);
    const [ridge] = await resolve({}, [line({ key: 'r', variant_id: 'v-hdz-ridge' })]);
    expect(field.supplier_item_number).toBe('ABC-TEST-HDZCHR');
    expect(ridge.supplier_item_number).toBe('ABC-TEST-SARCHR');
    expect(field.supplier_item_number).not.toBe(ridge.supplier_item_number);
  });

  it('template color propagation still resolves each line independently', async () => {
    const lines = [
      line({ key: 'field', variant_id: 'v-hdz-field', color_id: 'c-hdz-charcoal' }),
      line({ key: 'ridge', variant_id: 'v-hdz-ridge', color_id: 'c-hdz-charcoal' }),
    ];
    const out = await resolve({}, lines);
    expect(out.every((r) => r.ok)).toBe(true);
    expect(new Set(out.map((r) => r.supplier_item_number)).size).toBe(2);
  });

  it('switching ABC to SRS re-resolves every line to SRS codes', async () => {
    const lines = [line({ key: 'a' }), line({ key: 'b', variant_id: 'v-dur-field', color_id: 'c-dur-estate' })];
    const srs = await resolve({ supplier: 'srs', supplier_connection_id: CONN_SRS }, lines);
    expect(srs.map((r) => r.supplier_item_number)).toEqual(['SRS-TEST-441122', 'SRS-TEST-559900']);
  });

  it('changing branch invalidates a location-dependent resolution', async () => {
    const [r] = await resolve({ branch_code: BRANCH_B }, [line({})]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('branch_mismatch');
  });

  it('a mapping from a different connection cannot be used', async () => {
    const [r] = await resolve({ supplier_connection_id: 'conn-other' }, [line({})]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('connection_mismatch');
  });

  it('missing mapping blocks submission', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-hdz-ridge', color_id: 'c-hdz-weathered' })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('no_mapping');
  });

  it('discontinued item blocks submission', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-uhdz-field', color_id: 'c-uhdz-charcoal' })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('discontinued');
  });

  it('wrong UOM blocks submission and is never defaulted', async () => {
    const [r] = await resolve({}, [line({ uom: 'EA' })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('uom_mismatch');
  });

  it('wrong profile/dimensions cannot be substituted (accessory needs its own variant)', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-drip', color_id: null, uom: 'PC' })]);
    expect(r.ok).toBe(true);
    expect(r.supplier_item_number).toBe('ABC-TEST-DRIP22');
    const [wrongUom] = await resolve({}, [line({ variant_id: 'v-drip', color_id: null, uom: 'BD' })]);
    expect(wrongUom.failure_code).toBe('uom_mismatch');
  });

  it('stale catalog validation requires revalidation', async () => {
    const [r] = await resolve({}, [line({ variant_id: 'v-dur-field', color_id: 'c-dur-charcoal' })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('stale_validation');
  });

  it('ambiguous mapping blocks submission', async () => {
    MAPPINGS.push(mapping({ id: 'm-dupe', variant_id: 'v-hdz-field', color_id: 'c-hdz-weathered', supplier: 'abc', supplier_item_number: 'ABC-TEST-HDZWW-ALT' }));
    const [r] = await resolve({}, [line({ color_id: 'c-hdz-weathered' })]);
    MAPPINGS.pop();
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('ambiguous');
    expect(r.candidates?.length).toBe(2);
  });

  it('a missing required color blocks submission', async () => {
    const [r] = await resolve({}, [line({ color_id: null })]);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('color_required');
  });

  it('cross-tenant mappings are inaccessible', async () => {
    const [r] = await resolve({}, [line({})], OTHER_TENANT);
    expect(r.ok).toBe(false);
    expect(r.failure_code).toBe('variant_not_found');
  });
});

describe('preflight gate + outbound payload', () => {
  it('blocks the whole order when any line fails', async () => {
    const res = await preflightSupplierOrder(stubClient(TENANT), TENANT, {
      supplier: 'abc', supplier_connection_id: CONN_ABC, branch_code: BRANCH_A,
      lines: [line({ key: 'good' }), line({ key: 'bad', uom: 'EA' })],
    });
    expect(res.ok).toBe(false);
    expect(res.blocking.map((b) => b.key)).toEqual(['bad']);
  });

  it('exact ABC item numbers appear in the outbound payload', async () => {
    const lines = await resolve({}, [line({ key: 'f' }), line({ key: 'r', variant_id: 'v-hdz-ridge' })]);
    const payload: any = buildAbcOrderPayload(lines, { branch_code: BRANCH_A, ship_to_number: 'ST-1' });
    expect(payload.lines.map((l: any) => l.itemNumber)).toEqual(['ABC-TEST-HDZCHR', 'ABC-TEST-SARCHR']);
    expect(payload.lines[0]._pitch_trace.color_name).toBe('Charcoal');
  });

  it('exact SRS catalog ids appear in the outbound payload with the color option', async () => {
    const lines = await resolve({ supplier: 'srs', supplier_connection_id: CONN_SRS }, [line({})]);
    const payload: any = buildSrsOrderPayload(lines, { account_number: 'A1', branch_code: BRANCH_A });
    expect(payload.orderLineItems[0].productId).toBe('441122');
    expect(payload.orderLineItems[0].orderLineItemDetails.option).toBe('Charcoal');
  });

  it('payload construction refuses unresolved lines (client cannot force a code)', async () => {
    const lines = await resolve({}, [line({ uom: 'EA' })]);
    expect(() => buildAbcOrderPayload(lines, {})).toThrow(/payload_build_blocked/);
  });

  it('retry idempotency key is stable for an identical payload', () => {
    const args = { tenantId: TENANT, supplier: 'abc' as const, materialOrderId: 'mo-1', orderVersion: 1, payloadHash: 'a'.repeat(64) };
    expect(buildIdempotencyKey(args)).toBe(buildIdempotencyKey(args));
    expect(buildIdempotencyKey({ ...args, orderVersion: 2 })).not.toBe(buildIdempotencyKey(args));
  });

  it('reconciliation detects a mismatched returned line', async () => {
    const lines = await resolve({}, [line({})]);
    const good = reconcileSupplierOrder(lines, [{ item_number: 'ABC-TEST-HDZCHR', quantity: 30, uom: 'BD' }], BRANCH_A, BRANCH_A);
    expect(good.verified).toBe(true);

    const bad = reconcileSupplierOrder(lines, [{ item_number: 'ABC-TEST-HDZWW', quantity: 30, uom: 'BD' }], BRANCH_A, BRANCH_A);
    expect(bad.verified).toBe(false);
    expect(bad.lines[0].mismatch_reasons).toContain('returned_order_missing_line');

    const wrongBranch = reconcileSupplierOrder(lines, [{ item_number: 'ABC-TEST-HDZCHR', quantity: 30, uom: 'BD' }], BRANCH_A, BRANCH_B);
    expect(wrongBranch.verified).toBe(false);
  });
});
