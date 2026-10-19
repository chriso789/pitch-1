import { describe, expect, it } from 'vitest';
import { contributesToTraining, sharedClassReady } from '@/lib/photo-intelligence/training/platformTraining';

describe('platform-wide training', () => {
  it('only opted-in companies contribute; withdrawn and never-enrolled do not', () => {
    expect(contributesToTraining('opted_in')).toBe(true);
    expect(contributesToTraining('withdrawn')).toBe(false);
    expect(contributesToTraining('not_enrolled')).toBe(false);
    expect(contributesToTraining(undefined)).toBe(false);
  });
  it('a class is not ready from a single company even with enough examples', () => {
    expect(sharedClassReady({ cls: 'clay_tile', condition: 'normal', examples: 40, properties: 5, companies: 1 })).toBe(false);
    expect(sharedClassReady({ cls: 'clay_tile', condition: 'normal', examples: 30, properties: 3, companies: 2 })).toBe(true);
    expect(sharedClassReady({ cls: 'clay_tile', condition: 'normal', examples: 30, properties: 2, companies: 2 })).toBe(false);
  });
});
