# Power Dialer Rate Limiting & Throttling

## Overview

The Power Dialer system implements comprehensive rate limiting and throttling to prevent abuse, ensure compliance with calling regulations, and protect system resources.

## Rate Limit Types

### 1. API Request Rate Limits

Limits the number of API requests to the power dialer controller:

- **Per Minute**: 60 requests per user
- **Per Hour**: 500 requests per user

**Purpose**: Prevents API abuse and ensures fair resource usage.

**Response**: HTTP 429 (Too Many Requests) with `Retry-After` header.

### 2. Call Throttling

Limits the actual number of calls made through the system:

- **Per Hour**: Configurable per agent (default: 100 calls)
- **Per Day**: 800 calls per session
- **Configurable**: Each AI agent can have custom limits

**Purpose**: Ensures compliance with TCPA, FCC regulations, and carrier guidelines.

**Configuration**: Set in AI agent's `configuration.maxCallsPerHour` field.

### 3. Session Limits

Controls the number and duration of active dialing sessions:

- **Max Active Sessions**: 5 per tenant
- **Max Session Duration**: 8 hours
- **Paused sessions** count toward the active limit

**Purpose**: Prevents resource exhaustion and encourages session management.

## Implementation Details

### Database Tables

#### `api_rate_limits`
Tracks all API requests for rate limiting:
```sql
- tenant_id: UUID
- user_id: UUID
- endpoint: TEXT
- created_at: TIMESTAMP
```

Records are automatically cleaned up after 24 hours.

#### `call_logs`
Tracks all calls for throttling and compliance:
```sql
- tenant_id: UUID
- session_id: UUID
- contact_id: UUID
- phone_number: TEXT
- status: TEXT
- disposition: TEXT
- duration: INTEGER
- recording_url: TEXT
- created_at: TIMESTAMP
```

### Edge Function Checks

The power-dialer-controller performs these checks:

1. **On Every Request**: API rate limit validation
2. **On next-contact**: Call throttling validation
3. **On start-session**: Active session count validation

### Response Headers

When rate limited, the API returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: <seconds>
X-RateLimit-Reset: <unix timestamp>
Content-Type: application/json

{
  "error": "Rate limit exceeded: 60 requests per minute allowed",
  "rateLimitExceeded": true
}
```

## Compliance Features

### TCPA Compliance

- Limits calls per hour to prevent harassment
- Tracks all call attempts with timestamps
- Enforces maximum session duration
- Maintains audit trail in `call_logs`

### FCC Guidelines

- Respects "do not call" lists (when implemented)
- Limits simultaneous calling campaigns
- Provides detailed call logging
- Enforces timeout between calls

### Carrier Requirements

- Prevents call flooding (max calls/hour)
- Implements proper call pacing
- Tracks call dispositions
- Monitors call success rates

## Configuration

### Per-Agent Configuration

Configure limits in the AI agent's settings:

```json
{
  "configuration": {
    "mode": "power",
    "maxCallsPerHour": 100,
    "callTimeout": 30,
    "autoDialDelay": 2
  }
}
```

### System-Wide Limits

Defined in `power-dialer-controller/index.ts`:

```typescript
const RATE_LIMITS = {
  requestsPerMinute: 60,
  requestsPerHour: 500,
  maxCallsPerHour: 100,
  maxCallsPerDay: 800,
  maxActiveSessions: 5,
  maxSessionDuration: 8 * 60 * 60 * 1000
};
```

## Testing

### Unit Tests
```bash
bun test tests/integration/power-dialer-rate-limiting.test.ts
```

### Test Scenarios Covered
- ✅ Requests within limits
- ✅ Per-minute rate limit exceeded
- ✅ Per-hour rate limit exceeded
- ✅ Call throttling per session
- ✅ Maximum active sessions
- ✅ Session duration limits
- ✅ Call log tracking

### Test Helpers

```typescript
import {
  clearRateLimitLogs,
  simulateRateLimitHits,
  getRateLimitCount,
  simulateCallHistory,
} from '../utils/rate-limit-helpers';
```

## Monitoring

### Check Rate Limit Status

```sql
-- Current hour's requests per user
SELECT user_id, COUNT(*) as request_count
FROM api_rate_limits
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id
ORDER BY request_count DESC;

-- Calls per session in last hour
SELECT session_id, COUNT(*) as call_count
FROM call_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY session_id
ORDER BY call_count DESC;
```

### Cleanup Old Logs

```sql
SELECT cleanup_old_rate_limits();
```

Automatically removes rate limit logs older than 24 hours.

## Best Practices

### For Developers

1. **Always handle 429 responses** with proper retry logic
2. **Implement exponential backoff** when rate limited
3. **Use the Retry-After header** to determine when to retry
4. **Monitor call logs** for compliance audits
5. **Configure agent limits** based on use case

### For Administrators

1. **Review call logs regularly** for compliance
2. **Adjust agent limits** based on campaign needs
3. **Monitor active sessions** to prevent resource issues
4. **Set up alerts** for rate limit violations
5. **Clean up old sessions** periodically

### For Campaigns

1. **Power Mode**: Use for high-volume, low-touch outreach (100 calls/hour)
2. **Preview Mode**: Use for high-value sales calls (40 calls/hour)
3. **Predictive Mode**: Use for maximum efficiency (150 calls/hour with ML)

## Error Handling

### Client-Side Example

```typescript
async function makeDialerRequest(body: any) {
  try {
    const { data, error } = await supabase.functions.invoke(
      'power-dialer-controller',
      { body }
    );
    
    if (data?.rateLimitExceeded) {
      const retryAfter = data.retryAfter || 60;
      toast.error(`Rate limited. Retry in ${retryAfter} seconds`);
      
      // Implement retry logic
      setTimeout(() => makeDialerRequest(body), retryAfter * 1000);
      return;
    }
    
    return data;
  } catch (error) {
    console.error('Request failed:', error);
  }
}
```

## Future Enhancements

- [ ] Redis-based rate limiting for better performance
- [ ] Dynamic rate limits based on tenant tier
- [ ] Geographic rate limiting
- [ ] Time-of-day restrictions
- [ ] Automatic rate limit adjustment based on success rates
- [ ] Real-time rate limit dashboard
- [ ] WebSocket notifications for rate limit warnings
