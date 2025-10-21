# 📧 Automated Job Analytics Reports

## Overview
The `export-job-analytics` Edge Function enables automated email delivery of Job Analytics reports with professional PDF generation.

## Features

✅ **3 Input Modes:**
- **HTML Mode**: Pass pre-rendered HTML directly
- **Render URL Mode**: Server fetches and renders a live page (recommended for scheduled reports)
- **Metrics JSON Mode**: Pass raw data, function generates formatted HTML

✅ **Automatic PDF Generation**: Uses `smart-docs-pdf` function for professional documents

✅ **Email Delivery**: Sends reports with signed PDF links via `send-email` function

✅ **Flexible Scheduling**: Manual triggers or automated via cron jobs

## Usage

### 1. From the UI (Manual Email)

1. Navigate to `/job-analytics`
2. Select your desired date range
3. Click "Email Report" button
4. Enter recipient email address
5. Customize subject and message (optional)
6. Click "Send"

The system will:
- Generate a print-optimized view
- Convert it to PDF
- Upload to Supabase Storage
- Email a signed URL (expires in 7 days)

### 2. API Integration

Call from any frontend/backend code:

```typescript
const { data, error } = await supabase.functions.invoke('export-job-analytics', {
  body: {
    from: '2025-01-01',
    to: '2025-01-31',
    recipients: ['ops@company.com', 'gm@company.com'],
    subject: 'Q1 Job Analytics',
    message: 'Attached is the Q1 analytics report.',
    render_url: 'https://yourapp.com/job-analytics?print=1&from=2025-01-01&to=2025-01-31'
  }
});
```

### 3. Scheduled Reports (Cron)

Set up via Supabase Dashboard: **Database → Cron Jobs → Create Job**

**Example: Weekly Monday Reports**
```sql
SELECT cron.schedule(
  'weekly-job-analytics',
  '0 8 * * MON',  -- Every Monday 8am UTC
  $$
  SELECT net.http_post(
    url:='https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:=json_build_object(
      'from', (CURRENT_DATE - INTERVAL '7 days')::text,
      'to', CURRENT_DATE::text,
      'recipients', ARRAY['manager@company.com', 'ops@company.com']
    )::jsonb
  );
  $$
);
```

**Example: Monthly Reports**
```sql
SELECT cron.schedule(
  'monthly-job-analytics',
  '0 9 1 * *',  -- 1st of month at 9am UTC
  $$
  SELECT net.http_post(
    url:='https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:=json_build_object(
      'from', (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::text,
      'to', (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::text,
      'recipients', ARRAY['leadership@company.com']
    )::jsonb
  );
  $$
);
```

## Environment Variables

### Required (Auto-configured)
- `SUPABASE_URL` - Auto-set by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-set by Supabase
- `RESEND_API_KEY` - Required for email sending (must be configured)

### Optional
- `EDGE_BASE` - Base URL for edge functions (auto-detected if not set)
- `DEFAULT_MANAGER_TO` - Comma-separated default recipients (fallback)
- `COMPANY_NAME` - Company name for PDF header (default: "PITCH Roofing CRM")

**To set environment variables:**
1. Go to Supabase Dashboard
2. Navigate to: **Settings → Edge Functions → Manage secrets**
3. Add:
   ```
   EDGE_BASE=https://alxelfrbjzkmtnsulcei.functions.supabase.co
   DEFAULT_MANAGER_TO=ops@yourcompany.com,gm@yourcompany.com
   COMPANY_NAME=PITCH Roofing CRM
   ```

## API Examples

### Mode 1: Render URL (Recommended)

```bash
curl -X POST https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "2025-01-01",
    "to": "2025-01-31",
    "recipients": ["manager@company.com"],
    "render_url": "https://app.yourcrm.com/job-analytics?print=1&from=2025-01-01&to=2025-01-31",
    "subject": "Monthly Job Analytics"
  }'
```

### Mode 2: Direct HTML

```bash
curl -X POST https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics \
  -H 'Content-Type: application/json' \
  -d '{
    "recipients": ["ops@company.com"],
    "html": "<html><h1>Custom Report</h1><p>Total Jobs: 42</p></html>",
    "subject": "Custom Analytics Report"
  }'
```

### Mode 3: Metrics JSON

```bash
curl -X POST https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "2025-01-01",
    "to": "2025-01-31",
    "recipients": ["manager@company.com"],
    "metrics": {
      "total_jobs": 42,
      "lead_jobs": 15,
      "production_jobs": 12,
      "closed_jobs": 8,
      "completion_rate": 19
    }
  }'
```

## Response Format

**Success Response:**
```json
{
  "success": true,
  "pdf_url": "https://alxelfrbjzkmtnsulcei.supabase.co/storage/v1/object/sign/...",
  "recipients_count": 2,
  "email_results": [
    { "recipient": "ops@company.com", "success": true },
    { "recipient": "gm@company.com", "success": true }
  ],
  "date_range": {
    "from": "2025-01-01",
    "to": "2025-01-31"
  }
}
```

**Error Response:**
```json
{
  "error": "Error message",
  "message": "Detailed error information"
}
```

## Troubleshooting

### No email received
- ✅ Check Supabase Edge Function logs: [View Logs](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions/export-job-analytics/logs)
- ✅ Verify `RESEND_API_KEY` is configured correctly
- ✅ Check recipient email address is valid
- ✅ Check spam/junk folders

### PDF generation fails
- ✅ Verify `smart-docs-pdf` function is deployed
- ✅ Check function logs for errors
- ✅ Ensure HTML is valid (no syntax errors)
- ✅ Verify Storage bucket has proper permissions

### Render URL fails
- ✅ Verify URL is publicly accessible (no authentication required)
- ✅ Check network connectivity from Supabase edge functions
- ✅ Ensure `print=1` parameter is included in URL
- ✅ Verify date parameters are in correct format (YYYY-MM-DD)

### Scheduled reports not sending
- ✅ Verify cron job is created correctly in Supabase
- ✅ Check cron job logs for execution history
- ✅ Ensure pg_cron extension is enabled
- ✅ Verify network.http module is available

## Print Mode

The `/job-analytics?print=1` route provides a print-optimized view:

**Features:**
- Removes navigation and action buttons
- Optimized layout for PDF generation
- Reads date range from URL parameters
- Professional formatting with company branding

**URL Parameters:**
- `print=1` - Enables print mode
- `from=YYYY-MM-DD` - Start date (required)
- `to=YYYY-MM-DD` - End date (required)

**Example:**
```
https://yourapp.com/job-analytics?print=1&from=2025-01-01&to=2025-01-31
```

## Security Considerations

🔒 **JWT Verification**: Disabled (`verify_jwt = false`) to allow cron execution
- Cron jobs cannot pass JWT tokens
- Function uses service role key internally
- Safe because it only reads/emails aggregated data

🔒 **Rate Limiting**: Consider adding rate limits for manual invocations
- Prevent abuse of email sending
- Suggested: max 10 emails per hour per tenant

🔒 **Data Access**: Function uses service role key
- Has full database access internally
- Only exposes aggregated metrics in PDFs
- No raw contact/job data in emails

🔒 **Link Expiration**: PDF links expire after 7 days (signed URLs)
- Recipients need link to view PDF
- No authentication bypass risk
- Links automatically become invalid after expiry

## Success Metrics

After implementation, verify:
- ✅ Email reports sent successfully from UI
- ✅ Scheduled cron reports working (if configured)
- ✅ PDF generated with correct data and date range
- ✅ Email delivery confirmed
- ✅ Zero errors in Supabase function logs
- ✅ PDF links accessible and expire properly

## Next Steps

1. **Test Manual Email**: Send a test report from the UI
2. **Verify PDF Content**: Check that all metrics display correctly
3. **Set up Cron Jobs**: Configure weekly/monthly scheduled reports
4. **Monitor Logs**: Check edge function logs for any issues
5. **Train Users**: Share this documentation with team

## Related Documentation

- [Job Analytics Dashboard](/job-analytics)
- [Smart Docs PDF Function](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions/smart-docs-pdf)
- [Send Email Function](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions/send-email)
- [Edge Function Logs](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions/export-job-analytics/logs)
