# QBO Worker - Unified QuickBooks Online Operations

## Overview

The `qbo-worker` is a unified Supabase Edge Function that handles all outbound QuickBooks Online operations through a single action-routing endpoint. This consolidates OAuth management, rate limiting, error handling, and API versioning in one place.

## Architecture

```
UI Component
    ↓
supabase.functions.invoke('qbo-worker', { op: 'action', args: {...} })
    ↓
Action Router
    ├─→ syncProject (GraphQL Projects API / Sub-Customer fallback)
    ├─→ createInvoiceFromEstimates (REST API with Items + DepartmentRef)
    ├─→ toggleOnlinePayments (Sparse update + optional email)
    └─→ setLocation (Session storage for DepartmentRef tracking)
```

## Actions

### 1. syncProject

**Purpose**: Create a QBO Project (or Sub-Customer as fallback) for a job

**Request**:
```json
{
  "op": "syncProject",
  "args": {
    "tenant_id": "uuid",
    "realm_id": "123456789",
    "customer_id": "42",
    "job_id": "uuid",
    "job_name": "Smith Roof Repair",
    "mode": "auto" // or "force-fallback"
  }
}
```

**Response**:
```json
{
  "success": true,
  "qbo_project_id": "5000001234" // or null if sub-customer
  "qbo_customer_id": "42:Smith Roof Repair",
  "mode_used": "projects-api" // or "sub-customer"
}
```

**Decision Logic**:
1. Check if Projects API is enabled in company preferences
2. Check if `project-management.project` scope is present in OAuth token
3. If both true: Create Project via GraphQL
4. Otherwise: Create Sub-Customer via REST (Customer:Job pattern)

**Stored Mapping**:
- `qbo_entity_mapping` table: `entity_type='job'`, `entity_id=job_id`, `qbo_entity_id=project_id or customer_id`

---

### 2. createInvoiceFromEstimates

**Purpose**: Build and create a QBO Invoice from job estimates with automatic item mapping

**Request**:
```json
{
  "op": "createInvoiceFromEstimates",
  "args": {
    "tenant_id": "uuid",
    "realm_id": "123456789",
    "job_id": "uuid",
    "customer_ref": "42",
    "department_id": "10", // Optional, from user_sessions.active_location_id
    "lines_override": [ // Optional, overrides auto-mapping
      {
        "job_type_code": "ROOF_REPAIR",
        "description": "Asphalt shingle replacement",
        "amount": 5000,
        "class_id": "1"
      }
    ]
  }
}
```

**Response**:
```json
{
  "success": true,
  "qbo_invoice_id": "155",
  "doc_number": "1042",
  "total_amount": 5000.00,
  "message": "Invoice created successfully"
}
```

**Processing Flow**:
1. Fetch project + estimates from Supabase
2. Map job types → QBO Items via `job_type_item_map` table
3. Resolve DepartmentRef from `user_sessions.active_location_id` (if set)
4. Build Invoice Line array with ItemRef, Amount, Description
5. POST to `/v3/company/{realmId}/invoice?minorversion=75`
6. Call `api_qbo_map_job_invoice(job_id, invoice_id, doc_number)`
7. Call `api_qbo_update_invoice_mirror(invoice_id, total, balance)`

**Stored Data**:
- `qbo_entity_mapping`: Maps job → invoice
- `invoice_ar_mirror`: Mirrors invoice total, balance, status

---

### 3. toggleOnlinePayments

**Purpose**: Enable/disable online payment options and optionally send invoice email

**Request**:
```json
{
  "op": "toggleOnlinePayments",
  "args": {
    "tenant_id": "uuid",
    "realm_id": "123456789",
    "qbo_invoice_id": "155",
    "allow_credit_card": true,
    "allow_ach": true,
    "send_email": true // Optional
  }
}
```

**Response**:
```json
{
  "success": true,
  "doc_number": "1042",
  "allow_credit_card": true,
  "allow_ach": true,
  "email_sent": true
}
```

**Processing Flow**:
1. GET `/v3/company/{realmId}/invoice/{invoiceId}` (fetch current SyncToken)
2. POST sparse update with `AllowOnlineCreditCardPayment`, `AllowOnlineACHPayment`
3. If `send_email=true`: POST to `/v3/company/{realmId}/invoice/{invoiceId}/send`

**QBO Sparse Update**:
```json
{
  "Id": "155",
  "SyncToken": "3",
  "AllowOnlineCreditCardPayment": true,
  "AllowOnlineACHPayment": true,
  "sparse": true
}
```

---

### 4. setLocation

**Purpose**: Store user's active location for automatic DepartmentRef application

**Request**:
```json
{
  "op": "setLocation",
  "args": {
    "location_id": "uuid"
  }
}
```

**Response**:
```json
{
  "success": true,
  "active_location_id": "uuid",
  "message": "Location set successfully"
}
```

**Processing**:
- Calls `api_set_active_location(location_id)` RPC
- Upserts `user_sessions` table with user's active location
- Subsequent invoice creations automatically include DepartmentRef from `qbo_location_map`

---

## OAuth Token Management

### Token Refresh Flow

All actions automatically handle OAuth token refresh:

```typescript
async function ensureValidToken(tenantId: string, realmId: string) {
  const conn = await getConnection(tenantId, realmId);
  
  if (new Date(conn.expires_at) <= new Date()) {
    // Token expired, refresh it
    const refreshed = await refreshAccessToken(conn.refresh_token);
    
    // Update connection in database
    await supabase.rpc('api_qbo_set_connection', {
      p_realm_id: realmId,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token,
      p_expires_at: new Date(Date.now() + refreshed.expires_in * 1000),
      p_scopes: refreshed.scopes
    });
  }
  
  return conn.access_token;
}
```

### Token Expiry Handling

- Tokens expire after 1 hour
- Refresh tokens expire after 100 days
- Worker checks expiry before every API call
- Automatic refresh with exponential backoff on 401 errors

---

## Rate Limiting & Error Handling

### QBO Rate Limits

- **Default**: 500 requests per minute per company
- **Burst**: Up to 30 simultaneous connections
- **Daily**: No explicit daily limit

### 429 Retry Strategy

```typescript
if (response.status === 429) {
  const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
  await sleep(retryAfter * 1000);
  // Retry with exponential backoff (max 3 attempts)
}
```

### Error Response Format

```json
{
  "success": false,
  "error": "Token expired",
  "code": "OAUTH_TOKEN_EXPIRED",
  "retryable": true
}
```

---

## Environment Variables

Required secrets (set via `supabase secrets set`):

```bash
SUPABASE_URL=https://alxelfrbjzkmtnsulcei.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
QBO_CLIENT_ID=AB...
QBO_CLIENT_SECRET=xyz...
USE_SANDBOX=1  # 0 for production
```

---

## Deployment

```bash
# Deploy function
supabase functions deploy qbo-worker

# Set secrets (if not already set)
supabase secrets set \
  SUPABASE_URL=https://alxelfrbjzkmtnsulcei.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your_key \
  QBO_CLIENT_ID=your_client_id \
  QBO_CLIENT_SECRET=your_secret \
  USE_SANDBOX=1

# Verify deployment
curl -X POST https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-worker \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"op":"setLocation","args":{"location_id":"test-uuid"}}'
```

---

## Monitoring

### Edge Function Logs

View logs in Supabase Dashboard:
- https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions/qbo-worker/logs

Filter by:
- Request ID
- Error messages
- Specific actions (search for `"op":"syncProject"`)

### Database Audit Trail

All QBO operations are logged:
- `qbo_entity_mapping`: Entity relationships
- `qbo_webhook_journal`: Webhook events
- `invoice_ar_mirror`: Invoice state
- `qbo_sync_errors`: Error details

---

## Testing

### Manual Testing

```bash
# Test setLocation
curl -X POST $SUPABASE_URL/functions/v1/qbo-worker \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "op": "setLocation",
    "args": { "location_id": "uuid" }
  }'

# Test syncProject
curl -X POST $SUPABASE_URL/functions/v1/qbo-worker \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "op": "syncProject",
    "args": {
      "tenant_id": "uuid",
      "realm_id": "123456",
      "customer_id": "42",
      "job_id": "uuid",
      "job_name": "Test Job"
    }
  }'
```

### End-to-End Test Flow

1. ✅ Connect QBO via OAuth
2. ✅ Map job types to QBO items
3. ✅ Select active location → `setLocation`
4. ✅ Create project → `syncProject`
5. ✅ Create invoice → `createInvoiceFromEstimates`
6. ✅ Enable payments → `toggleOnlinePayments`
7. ✅ Simulate payment in QBO sandbox
8. ✅ Verify webhook received
9. ✅ Verify `invoice_ar_mirror` updated

---

## Why Unified Worker?

### Before (Multiple Functions)

```
qbo-customer-sync → OAuth refresh logic, error handling
qbo-invoice-create → OAuth refresh logic, error handling
qbo-invoice-send → OAuth refresh logic, error handling
```

**Problems**:
- Duplicate token refresh code
- Inconsistent rate limiting
- Multiple log streams
- Hard to coordinate retries
- Version drift (`minorversion` differences)

### After (Unified Worker)

```
qbo-worker → Single OAuth path, single rate limiter, single log stream
```

**Benefits**:
- ✅ One OAuth refresh mechanism
- ✅ Consistent rate limiting per realm
- ✅ Centralized error handling
- ✅ Single version lock (`minorversion=75`)
- ✅ Easy to add new actions
- ✅ Better monitoring

---

## Future Actions (Easy to Add)

Potential future actions with same infrastructure:

- `createPaymentLink` - Generate QBO payment link
- `recordPayment` - Record manual payment
- `voidInvoice` - Void an invoice
- `createEstimate` - Create QBO estimate
- `syncCustomer` - Sync contact to QBO customer
- `createCreditMemo` - Issue refund/credit

All would use same OAuth, rate limiting, and error handling patterns.

---

## Support

For issues:
1. Check Edge Function logs (link above)
2. Review `qbo_sync_errors` table
3. Verify OAuth token not expired
4. Check QBO API status: https://status.developer.intuit.com
