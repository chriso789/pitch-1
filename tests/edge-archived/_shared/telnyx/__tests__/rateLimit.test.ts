// Deno tests for Telnyx rate-limit classifier + backoff.
// Run: deno test supabase/functions/_shared/telnyx/__tests__/rateLimit.test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  classifyTelnyxResponse,
  computeRetryDelayMs,
  computeNextAttemptAt,
  parseRetryAfterHeader,
  parseRetryFromText,
  DEFAULT_BACKOFF,
} from '../rateLimit.ts';

Deno.test('parseRetryAfterHeader: integer seconds', () => {
  assertEquals(parseRetryAfterHeader('5'), 5000);
  assertEquals(parseRetryAfterHeader(' 30 '), 30_000);
});

Deno.test('parseRetryAfterHeader: HTTP date returns positive ms', () => {
  const target = new Date(Date.now() + 10_000).toUTCString();
  const v = parseRetryAfterHeader(target);
  assert(v! >= 5_000 && v! <= 15_000, `expected ~10s, got ${v}`);
});

Deno.test('parseRetryFromText: milliseconds', () => {
  assertEquals(parseRetryFromText('Retry after 500ms please'), 500);
});
Deno.test('parseRetryFromText: seconds', () => {
  assertEquals(parseRetryFromText('please retry in 30 seconds'), 30_000);
});

Deno.test('classify: HTTP 429 with Retry-After seconds', () => {
  const c = classifyTelnyxResponse({
    status: 429,
    headers: { 'Retry-After': '2', 'x-request-id': 'req_1' },
    body: { errors: [{ code: '10008', title: 'Rate limit exceeded' }] },
  });
  assert(c.is_rate_limited);
  assert(c.is_retryable);
  assert(!c.is_permanent);
  assertEquals(c.category, 'rate_limit');
  assertEquals(c.retry_after_ms, 2000);
  assertEquals(c.provider_status, 429);
  assertEquals(c.provider_request_id, 'req_1');
});

Deno.test('classify: HTTP 429 with HTTP-date Retry-After', () => {
  const dt = new Date(Date.now() + 3000).toUTCString();
  const c = classifyTelnyxResponse({
    status: 429,
    headers: { 'retry-after': dt },
    body: { errors: [{ title: 'Too Many Requests' }] },
  });
  assert(c.is_rate_limited);
  assert(c.retry_after_ms! >= 1000 && c.retry_after_ms! <= 5000);
});

Deno.test('classify: structured retry_after_ms in body meta', () => {
  const c = classifyTelnyxResponse({
    status: 429,
    headers: {},
    body: { errors: [{ code: '10008', title: 'rate limit', meta: { retry_after_ms: 750 } }] },
  });
  assertEquals(c.retry_after_ms, 750);
});

Deno.test('classify: free-form "Retry after Xms" parsing fallback', () => {
  const c = classifyTelnyxResponse({
    status: 429,
    headers: {},
    body: { errors: [{ title: 'Rate limited. Retry after 250ms.' }] },
  });
  assertEquals(c.retry_after_ms, 250);
});

Deno.test('classify: rate-limit without retry hint returns null retry_after', () => {
  const c = classifyTelnyxResponse({
    status: 429,
    headers: {},
    body: { errors: [{ title: 'Rate limit exceeded' }] },
  });
  assert(c.is_rate_limited);
  assertEquals(c.retry_after_ms, null);
});

Deno.test('classify: Canadian destination is permanent, NOT rate limit', () => {
  const c = classifyTelnyxResponse({
    status: 400,
    headers: {},
    body: { errors: [{ code: '40300', title: 'Destination not permitted', detail: 'Canadian destination not allowed on US-only profile' }] },
  });
  assert(!c.is_rate_limited);
  assert(c.is_permanent);
  assertEquals(c.category, 'destination_not_permitted');
});

Deno.test('classify: invalid destination is permanent', () => {
  const c = classifyTelnyxResponse({
    status: 400,
    headers: {},
    body: { errors: [{ title: 'Invalid destination phone number' }] },
  });
  assert(c.is_permanent);
  assertEquals(c.category, 'invalid_destination');
});

Deno.test('classify: 5xx is retryable server_error, not rate limit', () => {
  const c = classifyTelnyxResponse({
    status: 502,
    headers: {},
    body: { errors: [{ title: 'Bad gateway' }] },
  });
  assert(c.is_retryable);
  assert(!c.is_rate_limited);
  assertEquals(c.category, 'server_error');
});

Deno.test('classify: network error is retryable timeout/connection', () => {
  const c = classifyTelnyxResponse({ networkError: new Error('fetch timed out') });
  assert(c.is_retryable);
  assertEquals(c.category, 'timeout');
});

Deno.test('computeRetryDelayMs: uses provider retry when set', () => {
  const d = computeRetryDelayMs(2500, 1);
  assertEquals(d, 2500);
});

Deno.test('computeRetryDelayMs: provider retry is clamped by max', () => {
  const d = computeRetryDelayMs(60 * 60 * 1000, 1);
  assertEquals(d, DEFAULT_BACKOFF.maxMs);
});

Deno.test('computeRetryDelayMs: provider retry is clamped by min', () => {
  const d = computeRetryDelayMs(50, 1);
  assertEquals(d, DEFAULT_BACKOFF.minMs);
});

Deno.test('computeRetryDelayMs: exponential fallback with bounded jitter', () => {
  // Attempt 3 → base 5000 * 2^2 = 20000, ±25% jitter
  let seen = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const d = computeRetryDelayMs(null, 3, {}, () => Math.random());
    assert(d >= 15_000 && d <= 25_000, `delay out of jitter bounds: ${d}`);
    seen.add(d);
  }
  assert(seen.size > 1, 'jitter should vary results');
});

Deno.test('computeRetryDelayMs: fallback caps at maxMs', () => {
  const d = computeRetryDelayMs(null, 15, {}, () => 1);
  assert(d <= DEFAULT_BACKOFF.maxMs);
});

Deno.test('computeNextAttemptAt: returns future timestamp', () => {
  const { nextAttemptAt, delayMs } = computeNextAttemptAt(3000, 1);
  const now = Date.now();
  assert(nextAttemptAt.getTime() >= now + 2000);
  assertEquals(delayMs, 3000);
});
