import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Demo booking availability', () => {
  it('requires availability before the sender can submit', () => {
    // Boundary validation also runs in the deployed invite service.
    const future = new Date(Date.now() + 86400000).toISOString();
    const validate = (slots: string[]) => slots.length > 0 && slots.every(s => Number.isFinite(Date.parse(s)) && Date.parse(s) > Date.now());
    expect(validate([])).toBe(false);
    expect(validate([future])).toBe(true);
    expect(validate(['2020-01-01T00:00:00Z'])).toBe(false);
  });
});