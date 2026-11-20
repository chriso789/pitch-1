import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { demoEventId, overlapsBusy } from './calendar.ts';

Deno.test('event id is deterministic and uses only Google-allowed characters', () => {
  const id = demoEventId('c3f916f4-4406-425e-afcb-9e10cc421758');
  assertEquals(id, 'pitchdemoc3f916f44406425eafcb9e10cc421758');
  assert(/^[a-v0-9]{5,1024}$/.test(id));
});

Deno.test('a slot that overlaps a busy calendar block is unavailable', () => {
  const busy = [{ start: Date.parse('2026-11-21T15:15:00Z'), end: Date.parse('2026-11-21T16:00:00Z') }];
  assert(overlapsBusy('2026-11-21T15:00:00Z', busy));
  assert(overlapsBusy('2026-11-21T15:30:00Z', busy));
});

Deno.test('back-to-back slots next to a busy block stay available', () => {
  const busy = [{ start: Date.parse('2026-11-21T15:00:00Z'), end: Date.parse('2026-11-21T15:30:00Z') }];
  assertFalse(overlapsBusy('2026-11-21T14:30:00Z', busy));
  assertFalse(overlapsBusy('2026-11-21T15:30:00Z', busy));
});
