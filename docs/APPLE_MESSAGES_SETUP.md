# Apple Messages for Business Setup

## Prerequisites
1. Apple Business Register account (https://register.apple.com/)
2. CSP/MSP account (Zendesk, Webex Connect, Freshworks, LivePerson)
3. Apple-approved business identity

## Setup Steps

### 1. Register with Apple
- Go to Apple Business Register
- Create Messages for Business account
- Submit business verification docs
- Wait for Apple approval (1-2 weeks)

### 2. Choose CSP
Supported CSPs:
- **Zendesk** (easiest for CRM)
- **Webex Connect** (enterprise)
- **Freshworks**
- **LivePerson**

### 3. Configure CSP
- Add Business ID from Apple
- Set webhook URL to: `https://your-project.supabase.co/functions/v1/amb-inbound`
- Configure message routing

### 4. Set Supabase Secrets
```bash
AMB_CSP_API_KEY=your_csp_api_key
AMB_CSP_ENDPOINT=https://csp-api-endpoint.com/send
```

### 5. Test
- Send test message from iPhone to your business
- Check `messages` table for inbound message
- Reply via `amb-send` function

## Important Notes
- AMB is NOT iMessage hacking - it's Apple's official business channel
- Requires Apple Business Register approval
- Must use approved CSP (cannot DIY)
- Messages appear in iOS Messages app with business branding

## CSP Integration Examples

### Zendesk
```typescript
// Zendesk webhook format
{
  "from": "+15551234567",
  "to": "business_id",
  "text": "Customer message",
  "source_id": "zendesk_message_id"
}
```

### Webex Connect
```typescript
// Webex webhook format
{
  "sender": "+15551234567",
  "recipient": "business_id",
  "message": {
    "text": "Customer message"
  },
  "messageId": "webex_message_id"
}
```

## Next Steps
1. Apply for Apple Business Register
2. Choose and configure your CSP
3. Update Edge Functions with CSP-specific payload formats
4. Test end-to-end messaging flow
