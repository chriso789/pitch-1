/**
 * Power Dialer Rate Limiting Tests
 * Tests rate limiting and throttling functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import {
  createTestAgent,
  createTestDialerSession,
  cleanupPowerDialerData,
} from '../utils/power-dialer-helpers';
import { createTestContact, cleanupTestData, TEST_TENANT_ID } from '../utils/db-helpers';
import {
  clearRateLimitLogs,
  simulateRateLimitHits,
  getRateLimitCount,
  clearCallLogs,
  simulateCallHistory,
  getCallCount,
} from '../utils/rate-limit-helpers';

describe('Power Dialer Rate Limiting Integration', () => {
  let testUserId: string;

  beforeEach(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No authenticated user for testing');
    testUserId = user.id;

    await cleanupPowerDialerData();
    await cleanupTestData();
    await clearRateLimitLogs(testUserId);
    await clearCallLogs();
  });

  afterEach(async () => {
    await cleanupPowerDialerData();
    await cleanupTestData();
    await clearRateLimitLogs(testUserId);
    await clearCallLogs();
  });

  it('should allow requests within rate limits', async () => {
    const agent = await createTestAgent();
    const contact = await createTestContact();

    // Should succeed within limits
    const { data: startData, error } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'start',
          mode: 'power',
        },
      }
    );

    expect(error).toBeNull();
    expect(startData?.success).toBe(true);

    // Verify rate limit was logged
    const count = await getRateLimitCount(testUserId, 1);
    expect(count).toBeGreaterThan(0);
  });

  it('should reject requests exceeding per-minute rate limit', async () => {
    // Simulate 60 requests in the last minute (at limit)
    await simulateRateLimitHits(testUserId, 60);

    // 61st request should fail
    const { data, error } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'start',
          mode: 'power',
        },
      }
    );

    expect(data?.rateLimitExceeded).toBe(true);
    expect(data?.error).toContain('Rate limit exceeded');
  });

  it('should reject requests exceeding hourly rate limit', async () => {
    // Simulate 500 requests in the last hour (at limit)
    await simulateRateLimitHits(testUserId, 500);

    // Next request should fail
    const { data } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'start',
          mode: 'power',
        },
      }
    );

    expect(data?.rateLimitExceeded).toBe(true);
    expect(data?.error).toContain('per hour');
  });

  it('should enforce call throttling per session', async () => {
    const agent = await createTestAgent({
      configuration: {
        maxCallsPerHour: 10, // Low limit for testing
      },
    });
    const session = await createTestDialerSession(agent.id);
    const contact = await createTestContact();

    // Simulate 10 calls already made in this hour
    await simulateCallHistory(session.id, TEST_TENANT_ID, contact.id, 10);

    const callCount = await getCallCount(session.id, 1);
    expect(callCount).toBe(10);

    // Next call should be throttled
    const { data } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'next-contact',
          sessionId: session.id,
          mode: 'power',
        },
      }
    );

    expect(data?.rateLimitExceeded).toBe(true);
    expect(data?.error).toContain('Call rate limit exceeded');
  });

  it('should enforce maximum active sessions limit', async () => {
    const agent = await createTestAgent();

    // Create 5 active sessions (at limit)
    for (let i = 0; i < 5; i++) {
      await createTestDialerSession(agent.id, { status: 'active' });
    }

    // Try to start another session
    const { data } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'start',
          mode: 'power',
        },
      }
    );

    expect(data?.rateLimitExceeded).toBe(true);
    expect(data?.error).toContain('Maximum active sessions');
  });

  it('should allow new session after stopping an active one', async () => {
    const agent = await createTestAgent();

    // Create 5 active sessions
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(await createTestDialerSession(agent.id, { status: 'active' }));
    }

    // Stop one session
    await supabase.functions.invoke('power-dialer-controller', {
      body: {
        action: 'stop',
        sessionId: sessions[0].id,
      },
    });

    // Now we should be able to start a new session
    const { data, error } = await supabase.functions.invoke(
      'power-dialer-controller',
      {
        body: {
          action: 'start',
          mode: 'power',
        },
      }
    );

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });

  it('should track call logs for throttling', async () => {
    const agent = await createTestAgent();
    const session = await createTestDialerSession(agent.id);
    const contact = await createTestContact();

    // Make a call
    await supabase.functions.invoke('power-dialer-controller', {
      body: {
        action: 'next-contact',
        sessionId: session.id,
        mode: 'power',
      },
    });

    // Verify call log was created
    const callCount = await getCallCount(session.id, 1);
    expect(callCount).toBeGreaterThan(0);
  });

  it('should respect different time windows for rate limiting', async () => {
    // Add some old requests (older than 1 hour)
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await supabase
      .from('api_rate_limits')
      .insert([
        {
          tenant_id: TEST_TENANT_ID,
          user_id: testUserId,
          endpoint: 'power-dialer-controller',
          created_at: oldTime.toISOString(),
        },
      ]);

    // Add recent requests
    await simulateRateLimitHits(testUserId, 5);

    // Should only count recent requests
    const recentCount = await getRateLimitCount(testUserId, 60);
    expect(recentCount).toBe(5);

    const allTimeCount = await getRateLimitCount(testUserId, 180);
    expect(allTimeCount).toBe(6);
  });
});
