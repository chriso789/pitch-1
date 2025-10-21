# Export Job Analytics Edge Function

Generates and emails Job Analytics reports as PDF documents.

## Features

- **3 Input Modes:**
  - `html`: Direct HTML string
  - `render_url`: URL to fetch and render (recommended for scheduled reports)
  - `metrics`: Raw metrics JSON to format

- **Automatic PDF Generation:** Uses `smart-docs-pdf` function
- **Email Delivery:** Sends reports via `send-email` function
- **Flexible Scheduling:** Can be triggered manually or via cron

## Environment Variables

Required:
- `SUPABASE_URL` - Auto-set by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-set by Supabase
- `RESEND_API_KEY` - Required for email sending

Optional:
- `EDGE_BASE` - Base URL for edge functions (auto-detected)
- `DEFAULT_MANAGER_TO` - Comma-separated default recipients
- `COMPANY_NAME` - Company name for PDF header (default: "PITCH Roofing CRM")

## Usage Examples

### 1. Render URL Mode (Recommended)

```bash
curl -X POST https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "2025-01-01",
    "to": "2025-01-31",
    "recipients": ["manager@company.com"],
    "render_url": "https://app.yourcrm.com/job-analytics?print=1&from=2025-01-01&to=2025-01-31"
  }'
```

### 2. Direct HTML Mode

```bash
curl -X POST https://alxelfrbjzkmtnsulcei.functions.supabase.co/export-job-analytics \
  -H 'Content-Type: application/json' \
  -d '{
    "recipients": ["ops@company.com"],
    "html": "<html><h1>Job Analytics</h1></html>"
  }'
```

### 3. Metrics JSON Mode

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
      "closed_jobs": 8
    }
  }'
```

## Scheduling with Cron

Set up via Supabase Dashboard (Database → Cron Jobs):

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
      'recipients', ARRAY['manager@company.com']
    )::jsonb
  );
  $$
);
```

## Response Format

```json
{
  "success": true,
  "pdf_url": "https://...signed-url...",
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

## Troubleshooting

**No email received:**
- Check Supabase Edge Function logs
- Verify `RESEND_API_KEY` is configured
- Check recipient email address is valid

**PDF generation fails:**
- Verify `smart-docs-pdf` function is deployed
- Check function logs for errors
- Ensure HTML is valid

**Render URL fails:**
- Verify URL is publicly accessible
- Check for authentication requirements
- Ensure print mode parameter is included
