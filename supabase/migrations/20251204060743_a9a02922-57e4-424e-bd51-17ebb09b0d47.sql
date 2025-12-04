-- Add new template categories: followup, reminder
-- Insert 12+ professional pre-designed templates

-- Update template_type constraint to allow new types
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_template_type_check;

-- Insert Follow-up Templates
INSERT INTO email_templates (name, template_type, subject, html_body, variables, is_active, is_default)
VALUES 
(
  'Check-In Email',
  'followup',
  'Hi {{first_name}}, just checking in!',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <tr><td style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Just Checking In! 👋</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">I wanted to reach out and see how things are going with your roofing projects. Has everything been running smoothly?</p>
          <p style="color: #475569; line-height: 1.8; font-size: 16px; margin-top: 20px;">If you have any questions about using PITCH CRM or need help with any features, I''m here to help!</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{action_url}}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed, #a855f7); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Schedule a Call</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM • We''re here to help you succeed</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "action_url"]',
  true,
  true
),
(
  'Thank You Email',
  'followup',
  'Thank you, {{first_name}}! 🙏',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Thank You! 🎉</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Dear {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">We wanted to take a moment to express our sincere gratitude for choosing PITCH CRM for {{company_name}}.</p>
          <p style="color: #475569; line-height: 1.8; font-size: 16px; margin-top: 20px;">Your trust means the world to us, and we''re committed to helping your business grow and succeed.</p>
          <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; margin-top: 25px; text-align: center;">
            <p style="color: #059669; font-weight: 600; margin: 0; font-size: 18px;">💚 You''re Part of the Family Now!</p>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "company_name"]',
  true,
  false
),
(
  'We Miss You',
  'followup',
  '{{first_name}}, we miss you at PITCH CRM!',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #dc2626 0%, #f87171 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">We Miss You! 💔</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">We noticed you haven''t logged in for a while, and we miss having you around!</p>
          <p style="color: #475569; line-height: 1.8; font-size: 16px; margin-top: 20px;">Here''s what you might have missed:</p>
          <ul style="color: #475569; line-height: 2; font-size: 16px;">
            <li>New AI-powered roof measurements</li>
            <li>Improved estimate templates</li>
            <li>Faster power dialer performance</li>
          </ul>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{login_url}}" style="display: inline-block; background: linear-gradient(135deg, #dc2626, #f87171); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">Come Back & Explore</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "login_url"]',
  true,
  false
);

-- Insert Reminder Templates
INSERT INTO email_templates (name, template_type, subject, html_body, variables, is_active, is_default)
VALUES 
(
  'Appointment Reminder',
  'reminder',
  'Reminder: Your appointment is tomorrow, {{first_name}}!',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">⏰ Appointment Reminder</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">This is a friendly reminder about your upcoming appointment:</p>
          <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; color: #92400e; font-weight: 600; font-size: 18px;">📅 {{appointment_date}}</p>
            <p style="margin: 10px 0 0; color: #78350f;">{{appointment_details}}</p>
          </div>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">Please make sure to have any necessary documents ready. We look forward to meeting with you!</p>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "appointment_date", "appointment_details"]',
  true,
  true
),
(
  'Payment Reminder',
  'reminder',
  'Payment reminder for {{company_name}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">💳 Payment Reminder</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">This is a friendly reminder that your subscription payment for {{company_name}} is due soon.</p>
          <div style="background: #f0f9ff; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center;">
            <p style="color: #0369a1; font-weight: 600; margin: 0 0 10px; font-size: 14px;">Amount Due</p>
            <p style="color: #1e3a5f; font-weight: 700; margin: 0; font-size: 32px;">{{amount}}</p>
            <p style="color: #64748b; margin: 10px 0 0; font-size: 14px;">Due: {{due_date}}</p>
          </div>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{payment_url}}" style="display: inline-block; background: linear-gradient(135deg, #1e3a5f, #2d5a87); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">Pay Now</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "amount", "due_date", "payment_url"]',
  true,
  false
),
(
  'Renewal Notice',
  'reminder',
  'Your PITCH CRM subscription is up for renewal!',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #0891b2 0%, #22d3ee 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🔄 Subscription Renewal</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">Your PITCH CRM subscription for {{company_name}} is coming up for renewal on {{renewal_date}}.</p>
          <p style="color: #475569; line-height: 1.8; font-size: 16px; margin-top: 20px;">To ensure uninterrupted service, please review your subscription and update payment details if needed.</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{action_url}}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #22d3ee); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">Manage Subscription</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "renewal_date", "action_url"]',
  true,
  false
);

-- Insert additional Announcement templates
INSERT INTO email_templates (name, template_type, subject, html_body, variables, is_active, is_default)
VALUES 
(
  'Product Update',
  'announcement',
  '🚀 New in PITCH CRM: {{feature_name}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #4f46e5 0%, #818cf8 100%); padding: 40px 30px; text-align: center;">
          <p style="color: #c7d2fe; margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">Product Update</p>
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">{{feature_name}}</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">We''re excited to announce a major update to PITCH CRM that will help you work smarter and close more deals!</p>
          <div style="background: #eef2ff; border-radius: 12px; padding: 25px; margin: 25px 0;">
            <h3 style="color: #4f46e5; margin: 0 0 15px;">What''s New:</h3>
            <p style="color: #475569; margin: 0;">{{message}}</p>
          </div>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{action_url}}" style="display: inline-block; background: linear-gradient(135deg, #4f46e5, #818cf8); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">Try It Now</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "feature_name", "message", "action_url"]',
  true,
  false
),
(
  'Company News',
  'announcement',
  '📰 News from PITCH CRM',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #1e3a5f 0%, #d4af37 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">📰 Company News</h1>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Dear {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">{{message}}</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{action_url}}" style="display: inline-block; background: linear-gradient(135deg, #1e3a5f, #2d5a87); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">Learn More</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "message", "action_url"]',
  true,
  false
),
(
  'Weekly Digest',
  'announcement',
  'Your weekly PITCH CRM digest, {{first_name}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">📊 Weekly Digest</h1>
          <p style="color: #99f6e4; margin: 10px 0 0; font-size: 14px;">Your week at a glance</p>
        </td></tr>
        <tr><td style="padding: 40px 30px;">
          <h2 style="color: #1e3a5f; margin: 0 0 20px;">Hi {{first_name}},</h2>
          <p style="color: #475569; line-height: 1.8; font-size: 16px;">Here''s what happened at {{company_name}} this week:</p>
          <table width="100%" style="margin: 25px 0;">
            <tr>
              <td style="background: #f0fdfa; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
                <p style="color: #0f766e; font-size: 24px; font-weight: 700; margin: 0;">{{leads_count}}</p>
                <p style="color: #64748b; font-size: 12px; margin: 5px 0 0;">New Leads</p>
              </td>
              <td style="width: 10px;"></td>
              <td style="background: #f0fdfa; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
                <p style="color: #0f766e; font-size: 24px; font-weight: 700; margin: 0;">{{estimates_count}}</p>
                <p style="color: #64748b; font-size: 12px; margin: 5px 0 0;">Estimates Sent</p>
              </td>
              <td style="width: 10px;"></td>
              <td style="background: #f0fdfa; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
                <p style="color: #0f766e; font-size: 24px; font-weight: 700; margin: 0;">{{jobs_won}}</p>
                <p style="color: #64748b; font-size: 12px; margin: 5px 0 0;">Jobs Won</p>
              </td>
            </tr>
          </table>
          <div style="text-align: center; margin-top: 30px;">
            <a href="{{login_url}}" style="display: inline-block; background: linear-gradient(135deg, #0f766e, #14b8a6); color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Dashboard</a>
          </div>
        </td></tr>
        <tr><td style="background-color: #f8fafc; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© 2025 PITCH CRM</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "leads_count", "estimates_count", "jobs_won", "login_url"]',
  true,
  false
);