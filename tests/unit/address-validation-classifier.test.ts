// PR #3: Address Validation — integration test matrix (skeleton)
// These tests are wired against a staging Supabase. They are skipped by default
// because they require service-role + Google API credentials and tenant fixtures.

import { describe, it, expect } from 'vitest';
import { classifyGoogleAddressValidation, isProductionReady } from '../../supabase/functions/_shared/address-validation';

describe('PR#3 classifyGoogleAddressValidation', () => {
  it('classifies a complete PREMISE address with no flags as valid', () => {
    const out = classifyGoogleAddressValidation({
      responseId: 'r1',
      result: {
        verdict: {
          validationGranularity: 'PREMISE',
          geocodeGranularity: 'PREMISE',
          addressComplete: true,
        },
        address: {
          formattedAddress: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
          addressComponents: [
            { componentType: 'street_number', componentName: { text: '1600' } },
            { componentType: 'route', componentName: { text: 'Amphitheatre Pkwy' } },
            { componentType: 'locality', componentName: { text: 'Mountain View' } },
            { componentType: 'administrative_area_level_1', componentName: { text: 'CA' } },
            { componentType: 'postal_code', componentName: { text: '94043' } },
            { componentType: 'country', componentName: { text: 'US' } },
          ],
          missingComponentTypes: [],
          unresolvedTokens: [],
        },
        geocode: { location: { latitude: 37.4, longitude: -122.0 }, placeId: 'p1' },
        uspsData: { dpvConfirmation: 'Y' },
      },
    });
    expect(out.status).toBe('valid');
    expect(isProductionReady(out.status)).toBe(true);
  });

  it('flags inferred components as needs_review', () => {
    const out = classifyGoogleAddressValidation({
      result: {
        verdict: {
          validationGranularity: 'PREMISE',
          addressComplete: true,
          hasInferredComponents: true,
        },
        address: { addressComponents: [], missingComponentTypes: [], unresolvedTokens: [] },
      },
    });
    expect(out.status).toBe('needs_review');
    expect(isProductionReady(out.status)).toBe(false);
  });

  it('marks ROUTE-only granularity as invalid', () => {
    const out = classifyGoogleAddressValidation({
      result: {
        verdict: { validationGranularity: 'ROUTE', addressComplete: false },
        address: { addressComponents: [], missingComponentTypes: [], unresolvedTokens: [] },
      },
    });
    expect(out.status).toBe('invalid');
  });

  it('marks unresolved tokens as invalid', () => {
    const out = classifyGoogleAddressValidation({
      result: {
        verdict: { validationGranularity: 'PREMISE', addressComplete: true },
        address: {
          addressComponents: [],
          missingComponentTypes: [],
          unresolvedTokens: ['Apt'],
        },
      },
    });
    expect(out.status).toBe('invalid');
  });
});
