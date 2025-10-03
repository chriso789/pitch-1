# QBO Webhook Handler

## Overview

The `qbo-webhook-handler` receives and processes incoming webhooks from QuickBooks Online. It verifies HMAC signatures, journals events, and triggers downstream processing for payment updates.

## Webhook Setup

### 1. Configure in QBO Developer Portal

1. Go to https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks
2. Navigate to your app → Webhooks
3. Add Webhook URL:
   ```
   https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-webhook-handler
   ```
4. Generate Verifier Token (save this for `QBO_WEBHOOK_VERIFIER` secret)
5. Subscribe to events:
   - ✅ Payment (CREATE, UPDATE)
   - ✅ Invoice (UPDATE)
   - ✅ Customer (UPDATE)

### 2. Set Function Secrets

```bash
supabase secrets set \
  QBO_WEBHOOK_VERIFIER=your_verifier_token_from_qbo \
  SUPABASE_URL=https://alxelfrbjzkmtnsulcei.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Architecture

```
QuickBooks Online
    ↓
POST /qbo-webhook-handler
    ↓
Verify HMAC-SHA256 Signature
    ↓
Journal Event in qbo_webhook_journal
    ↓
Process Payment Events → Update invoice_ar_mirror
    ↓
Return 200 OK (fast acknowledgment)
```

## Event Processing

### Incoming Webhook Format

```json
{
  "eventNotifications": [
    {
      "realmId": "123456789",
      "dataChangeEvent": {
        "entities": [
          {
            "name": "Payment",
            "id": "255",
            "operation": "Create",
            "lastUpdated": "2025-10-03T12:34:56Z"
          }
        ]
      }
    }
  ]
}
```

### HMAC Signature Verification

QBO includes `intuit-signature` header with HMAC-SHA256 signature:

```typescript
function verifyWebhookSignature(payload: string, signature: string): boolean {
  const verifier = Deno.env.get('QBO_WEBHOOK_VERIFIER');
  const hmac = createHmac('sha256', verifier);
  hmac.update(payload);
  const calculatedSignature = hmac.digest('base64');
  
  return calculatedSignature === signature;
}
```

**Security**: If signature doesn't match, return 401 and log attempt.

### Event Journaling

All events are logged to `qbo_webhook_journal`:

```sql
INSERT INTO qbo_webhook_journal (
  tenant_id,
  realm_id,
  event_name,
  event_time,
  entities,
  processing_status
) VALUES (...)
```

Fields:
- `event_name`: CREATE, UPDATE, DELETE, MERGE
- `entities`: JSONB array of changed entities
- `processing_status`: pending, processing, completed, failed

### Payment Event Processing

When a Payment event is received:

1. **Fetch Payment Details** from QBO API:
   ```
   GET /v3/company/{realmId}/payment/{paymentId}?minorversion=75
   ```

2. **Extract Linked Invoices**:
   ```json
   {
     "Payment": {
       "Id": "255",
       "TotalAmt": 5000.00,
       "Line": [
         {
           "Amount": 5000.00,
           "LinkedTxn": [
             {
               "TxnId": "155",
               "TxnType": "Invoice"
             }
           ]
         }
       ]
     }
   }
   ```

3. **Update Each Invoice**:
   - Call `updateInvoiceBalance(realmId, invoiceId)`
   - Fetch latest invoice from QBO
   - Update `invoice_ar_mirror` with new balance

4. **Mark Event as Processed**:
   ```sql
   UPDATE qbo_webhook_journal
   SET processing_status = 'completed',
       processed_at = now()
   WHERE id = ...
   ```

### Invoice Balance Update

```typescript
async function updateInvoiceBalance(realmId: string, invoiceId: string) {
  // Fetch latest invoice state
  const invoice = await qboClient.get(
    `/v3/company/${realmId}/invoice/${invoiceId}?minorversion=75`
  );
  
  // Update AR mirror
  await supabase.rpc('api_qbo_update_invoice_mirror', {
    p_realm_id: realmId,
    p_qbo_invoice_id: invoiceId,
    p_doc_number: invoice.DocNumber,
    p_total: invoice.TotalAmt,
    p_balance: invoice.Balance,
    p_status: invoice.Balance === 0 ? 'Paid' : 'Partial'
  });
}
```

## Webhook Flow Diagram

```
Customer pays invoice in QBO
    ↓
QBO sends webhook (< 5 seconds)
    ↓
Webhook handler receives event
    ↓
Verify signature → Journal event
    ↓
If Payment: Fetch payment details
    ↓
For each linked invoice:
    ├─→ Fetch invoice details
    └─→ Update invoice_ar_mirror
    ↓
UI shows updated balance (< 10 seconds total)
```

## Error Handling

### Retry Logic

QBO retries webhooks if not acknowledged quickly:
- Return 200 ASAP after journaling
- Process events asynchronously
- Max 10 retry attempts from QBO

### Failed Events

If processing fails:
1. Event status set to `failed`
2. Error message logged in `qbo_webhook_journal.error_message`
3. Alert shown in `qbo_sync_errors` table
4. Can be manually retried from admin panel

## Security

### Public Endpoint Requirements

This function has `verify_jwt = false` because:
- Called by QBO, not by authenticated users
- Uses HMAC signature verification instead
- No user context needed

### Signature Validation

```typescript
// Extract signature from header
const signature = req.headers.get('intuit-signature');

// Read raw body
const payload = await req.text();

// Verify HMAC
if (!verifyWebhookSignature(payload, signature)) {
  return new Response('Invalid signature', { status: 401 });
}
```

### Replay Attack Prevention

- QBO includes `eventId` (unique per event)
- Journal tracks `event_id` to detect duplicates
- Reject duplicate `event_id` within 24-hour window

## Testing

### 1. Local Testing (Simulator)

QBO provides a webhook simulator:
1. Go to Developer Portal → Webhooks
2. Click "Test Webhook"
3. Select event type (e.g., Payment.Create)
4. Click "Send Test Event"

### 2. Ngrok Testing

For local development:
```bash
# Start ngrok tunnel
ngrok http 54321

# Update webhook URL in QBO to ngrok URL
https://abc123.ngrok.io/functions/v1/qbo-webhook-handler

# Run local Supabase
supabase functions serve qbo-webhook-handler

# Trigger test payment in QBO sandbox
```

### 3. Sandbox Testing

Use QBO Sandbox environment:
1. Create test invoice
2. Record test payment
3. Webhook fires automatically
4. Verify event in `qbo_webhook_journal`
5. Verify balance update in `invoice_ar_mirror`

## Monitoring

### Webhook Journal Query

```sql
-- Recent webhook events
SELECT 
  realm_id,
  event_name,
  entities,
  processing_status,
  error_message,
  created_at,
  processed_at
FROM qbo_webhook_journal
ORDER BY created_at DESC
LIMIT 50;
```

### Failed Events

```sql
-- Find failed events
SELECT *
FROM qbo_webhook_journal
WHERE processing_status = 'failed'
ORDER BY created_at DESC;
```

### Payment Processing Stats

```sql
-- Payment processing performance
SELECT 
  event_name,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE processing_status = 'completed') as completed,
  COUNT(*) FILTER (WHERE processing_status = 'failed') as failed,
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_seconds
FROM qbo_webhook_journal
WHERE event_name = 'Payment.Create'
  AND created_at > now() - interval '7 days'
GROUP BY event_name;
```

## Troubleshooting

### Webhook Not Received

**Check**:
1. Webhook URL correct in QBO Developer Portal
2. Function deployed: `supabase functions list`
3. Secrets set: `supabase secrets list`
4. QBO webhook status (should be "Active")

### Signature Verification Failing

**Check**:
1. `QBO_WEBHOOK_VERIFIER` secret matches QBO
2. Payload not modified in transit
3. Header `intuit-signature` present

### Payment Not Updating Balance

**Check**:
1. Event journaled in `qbo_webhook_journal`?
2. Processing status = 'completed'?
3. OAuth token still valid for API call?
4. Invoice ID correct in `invoice_ar_mirror`?

### Slow Processing

**Optimize**:
- Batch invoice updates if multiple payments
- Use connection pooling for Supabase
- Cache frequently accessed data
- Process large batches asynchronously

## Production Checklist

- [ ] Webhook URL updated to production domain
- [ ] `verify_jwt = false` in `supabase/config.toml`
- [ ] `QBO_WEBHOOK_VERIFIER` secret set
- [ ] Test webhook received successfully
- [ ] Monitor first 100 production events
- [ ] Set up alerts for failed events
- [ ] Document escalation process

## Related Functions

- `qbo-worker` - Outbound QBO operations
- `qbo-oauth-connect` - OAuth connection flow
- `qbo-sync-payment` - Manual payment sync
