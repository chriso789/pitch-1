# Contract Reports System

The Contract Reports System provides comprehensive analytics and tracking for digital signature envelopes in Lovable CRM.

## Features

### Report Types

1. **Contract Status Report**
   - Total contracts created
   - Status breakdown (draft, sent, in progress, completed, voided)
   - Completion rate percentage
   - Average completion time in days
   - Visual metrics cards with key performance indicators

2. **Contract Tracking Report**
   - Detailed audit trail for each contract
   - Complete event timeline showing:
     - Envelope creation
     - Document sending
     - Recipient opens/views
     - Signature completions
     - Status changes
   - IP address tracking for security
   - Chronological event history

3. **Contract Volume Report**
   - Daily contract creation statistics
   - Total contracts vs. completed contracts
   - Average daily contract volume
   - Completion rate trends
   - Detailed daily breakdown table

## Usage

### Web Interface

1. Navigate to `/contract-reports` in your Lovable CRM
2. Select a report type by clicking on the report card or using the dropdown
3. Configure date range (defaults to last 30 days)
4. Optionally enable email delivery with recipients
5. Click "Generate Report" to create PDF
6. Download or view the generated report

### API Integration

#### Endpoint
```
POST /functions/v1/generate-contract-reports
```

#### Authentication
Requires JWT authentication via `Authorization: Bearer <token>` header

#### Request Body
```json
{
  "report_type": "status" | "tracking" | "volume",
  "from": "2024-01-01",
  "to": "2024-01-31",
  "send_email": true,
  "recipients": ["manager@company.com", "admin@company.com"],
  "subject": "Monthly Contract Report",
  "message": "Here is your monthly contract report."
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `report_type` | string | Yes | Type of report: `status`, `tracking`, or `volume` |
| `from` | string | No | Start date (ISO format). Defaults to 30 days ago |
| `to` | string | No | End date (ISO format). Defaults to today |
| `send_email` | boolean | No | Whether to send report via email |
| `recipients` | array | No | Email addresses to send report to |
| `subject` | string | No | Email subject line |
| `message` | string | No | Email message body |

#### Response
```json
{
  "success": true,
  "pdf_url": "https://storage.supabase.co/signed-url...",
  "report_type": "status",
  "date_range": {
    "from": "2024-01-01",
    "to": "2024-01-31"
  },
  "email_results": [
    {
      "recipient": "manager@company.com",
      "success": true
    }
  ]
}
```

## Examples

### cURL Example - Status Report
```bash
curl -X POST \
  'https://your-project.supabase.co/functions/v1/generate-contract-reports' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "report_type": "status",
    "from": "2024-01-01",
    "to": "2024-01-31"
  }'
```

### cURL Example - Tracking Report with Email
```bash
curl -X POST \
  'https://your-project.supabase.co/functions/v1/generate-contract-reports' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "report_type": "tracking",
    "from": "2024-01-01",
    "to": "2024-01-31",
    "send_email": true,
    "recipients": ["manager@company.com"],
    "subject": "Contract Tracking Report - January 2024",
    "message": "Please review the attached contract tracking report."
  }'
```

### JavaScript Example
```javascript
const { data, error } = await supabase.functions.invoke('generate-contract-reports', {
  body: {
    report_type: 'volume',
    from: '2024-01-01',
    to: '2024-01-31',
    send_email: true,
    recipients: ['team@company.com']
  }
});

if (error) {
  console.error('Report generation failed:', error);
} else {
  console.log('Report URL:', data.pdf_url);
}
```

## Scheduling Automated Reports

### Using Supabase Cron Jobs

Create scheduled reports using Supabase's cron functionality:

```sql
-- Weekly status report every Monday at 9 AM
SELECT cron.schedule(
  'weekly-contract-status-report',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/generate-contract-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'report_type', 'status',
      'send_email', true,
      'recipients', ARRAY['management@company.com']
    )
  ) AS request_id;
  $$
);

-- Monthly volume report on 1st of each month
SELECT cron.schedule(
  'monthly-contract-volume-report',
  '0 8 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/generate-contract-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'report_type', 'volume',
      'from', (date_trunc('month', CURRENT_DATE - interval '1 month'))::text,
      'to', (date_trunc('month', CURRENT_DATE) - interval '1 day')::text,
      'send_email', true,
      'recipients', ARRAY['reports@company.com'],
      'subject', 'Monthly Contract Volume Report'
    )
  ) AS request_id;
  $$
);
```

## Report Templates

All report templates are professionally designed with:
- Company branding header
- Responsive layouts for print/PDF
- Color-coded status indicators
- Clear metrics visualization
- Confidential footer with generation timestamp

### Customization

Templates can be customized by editing:
- `src/lib/reports/contractReportTemplates.ts` - HTML/CSS templates
- `supabase/functions/generate-contract-reports/index.ts` - Data queries and logic

## Troubleshooting

### Report Generation Fails

1. **Check Authentication**: Ensure valid JWT token is provided
2. **Verify Date Range**: Confirm dates are in valid ISO format (YYYY-MM-DD)
3. **Database Access**: Verify user has access to signature_envelopes table
4. **Check Logs**: Review edge function logs in Supabase Dashboard

### Email Not Delivered

1. **Verify Recipients**: Ensure email addresses are valid
2. **Check RESEND_API_KEY**: Confirm API key is set in environment variables
3. **Review Email Logs**: Check send-email function logs
4. **Domain Validation**: Ensure sending domain is validated in Resend

### PDF Not Generated

1. **HTML Validation**: Check for malformed HTML in templates
2. **Puppeteer Errors**: Review smart-docs-pdf function logs
3. **Storage Access**: Verify Supabase Storage bucket permissions
4. **Memory Limits**: Large reports may hit function memory limits

## Security

- All reports require JWT authentication
- Row Level Security (RLS) filters data by tenant
- PDF URLs are signed and expire after 7 days
- Audit trail includes IP addresses for compliance
- Email delivery uses secure API keys (RESEND_API_KEY)

## Performance

- Reports are generated on-demand (not cached)
- Large date ranges may take longer to process
- Consider pagination for very large datasets
- PDF generation typically takes 2-5 seconds
- Email delivery adds 1-2 seconds per recipient

## Related Documentation

- [Smart Docs System](./SMART_TAGS.md)
- [Digital Signatures](../src/features/signatures/README.md)
- [PDF Generation](../supabase/functions/smart-docs-pdf/README.md)
- [Email Delivery](../supabase/functions/send-email/README.md)
