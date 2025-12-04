-- Create email_templates table for customizable email templates
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('onboarding', 'announcement', 'feature', 'maintenance', 'urgent', 'custom')),
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  variables JSONB DEFAULT '["first_name", "company_name", "login_url"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies - master users can manage all templates, others can view tenant templates
CREATE POLICY "Master users can manage all templates"
  ON public.email_templates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'
    )
  );

CREATE POLICY "Tenant admins can manage their templates"
  ON public.email_templates
  FOR ALL
  USING (
    tenant_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.tenant_id = email_templates.tenant_id
    )
  );

-- Create index for faster lookups
CREATE INDEX idx_email_templates_type ON public.email_templates(template_type);
CREATE INDEX idx_email_templates_tenant ON public.email_templates(tenant_id);

-- Insert default onboarding template
INSERT INTO public.email_templates (name, template_type, subject, html_body, variables, is_default, tenant_id)
VALUES (
  'Premium Onboarding',
  'onboarding',
  'Welcome to PITCH CRM - Let''s Get You Started! 🚀',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header with gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 40px 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Welcome to PITCH CRM</h1>
              <p style="color: #94a3b8; margin: 10px 0 0; font-size: 16px;">Your all-in-one roofing business platform</p>
            </td>
          </tr>
          
          <!-- Progress indicator -->
          <tr>
            <td style="padding: 30px 40px 20px; text-align: center;">
              <p style="color: #64748b; margin: 0 0 15px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Step 1 of 5</p>
              <div style="background-color: #e2e8f0; border-radius: 10px; height: 8px; width: 100%;">
                <div style="background: linear-gradient(90deg, #c9a227 0%, #dbb42c 100%); border-radius: 10px; height: 8px; width: 20%;"></div>
              </div>
            </td>
          </tr>
          
          <!-- Main content -->
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="color: #1e3a5f; margin: 0 0 20px; font-size: 22px;">Hi {{first_name}},</h2>
              <p style="color: #475569; line-height: 1.6; margin: 0 0 20px; font-size: 16px;">
                Welcome aboard! Your company <strong style="color: #1e3a5f;">{{company_name}}</strong> is now set up on PITCH CRM. 
                You''re about to transform how you manage leads, measurements, and estimates.
              </p>
            </td>
          </tr>
          
          <!-- Features grid -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding: 10px;">
                    <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; text-align: center;">
                      <div style="font-size: 32px; margin-bottom: 10px;">📞</div>
                      <h3 style="color: #1e3a5f; margin: 0 0 5px; font-size: 16px;">Power Dialer</h3>
                      <p style="color: #64748b; margin: 0; font-size: 13px;">300+ calls/hour</p>
                    </div>
                  </td>
                  <td width="50%" style="padding: 10px;">
                    <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; text-align: center;">
                      <div style="font-size: 32px; margin-bottom: 10px;">🛰️</div>
                      <h3 style="color: #1e3a5f; margin: 0 0 5px; font-size: 16px;">AI Measurements</h3>
                      <p style="color: #64748b; margin: 0; font-size: 13px;">98%+ accuracy</p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding: 10px;">
                    <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; text-align: center;">
                      <div style="font-size: 32px; margin-bottom: 10px;">📋</div>
                      <h3 style="color: #1e3a5f; margin: 0 0 5px; font-size: 16px;">Smart Estimates</h3>
                      <p style="color: #64748b; margin: 0; font-size: 13px;">Auto-populate</p>
                    </div>
                  </td>
                  <td width="50%" style="padding: 10px;">
                    <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; text-align: center;">
                      <div style="font-size: 32px; margin-bottom: 10px;">🗺️</div>
                      <h3 style="color: #1e3a5f; margin: 0 0 5px; font-size: 16px;">Territory Maps</h3>
                      <p style="color: #64748b; margin: 0; font-size: 13px;">GPS tracking</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="{{login_url}}" style="display: inline-block; background: linear-gradient(135deg, #c9a227 0%, #dbb42c 100%); color: #1e3a5f; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(201, 162, 39, 0.4);">
                Get Started Now →
              </a>
            </td>
          </tr>
          
          <!-- Savings highlight -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #a7f3d0;">
                <p style="color: #059669; margin: 0; font-size: 14px; font-weight: 600;">
                  💰 Save $46,000+/year by replacing 7+ expensive tools
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; margin: 0 0 10px; font-size: 14px;">
                Questions? Reply to this email or contact support
              </p>
              <p style="color: #94a3b8; margin: 0; font-size: 12px;">
                © 2025 PITCH CRM. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "login_url"]'::jsonb,
  true,
  NULL
);

-- Insert default announcement templates
INSERT INTO public.email_templates (name, template_type, subject, html_body, variables, is_default, tenant_id)
VALUES 
(
  'Feature Announcement',
  'feature',
  '🚀 New Feature: {{feature_name}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 30px; text-align: center;">
              <span style="font-size: 48px;">🚀</span>
              <h1 style="color: #ffffff; margin: 15px 0 0; font-size: 24px;">New Feature Available!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="color: #1e3a5f; margin: 0 0 15px;">Hi {{first_name}},</h2>
              <p style="color: #475569; line-height: 1.6;">{{message}}</p>
              <a href="{{action_url}}" style="display: inline-block; background: #c9a227; color: #1e3a5f; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; margin-top: 20px;">Learn More →</a>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center;">
              <p style="color: #94a3b8; margin: 0; font-size: 12px;">© 2025 PITCH CRM</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "feature_name", "message", "action_url"]'::jsonb,
  true,
  NULL
),
(
  'Maintenance Notice',
  'maintenance',
  '🔧 Scheduled Maintenance: {{maintenance_date}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; text-align: center;">
              <span style="font-size: 48px;">🔧</span>
              <h1 style="color: #ffffff; margin: 15px 0 0; font-size: 24px;">Scheduled Maintenance</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="color: #1e3a5f; margin: 0 0 15px;">Hi {{first_name}},</h2>
              <p style="color: #475569; line-height: 1.6;">{{message}}</p>
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 15px; margin-top: 20px;">
                <p style="color: #92400e; margin: 0; font-weight: 600;">📅 {{maintenance_date}}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center;">
              <p style="color: #94a3b8; margin: 0; font-size: 12px;">© 2025 PITCH CRM</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "maintenance_date", "message"]'::jsonb,
  true,
  NULL
),
(
  'Urgent Alert',
  'urgent',
  '⚠️ Urgent: {{alert_title}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: ''Segoe UI'', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
              <span style="font-size: 48px;">⚠️</span>
              <h1 style="color: #ffffff; margin: 15px 0 0; font-size: 24px;">Urgent Notice</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="color: #1e3a5f; margin: 0 0 15px;">Hi {{first_name}},</h2>
              <p style="color: #475569; line-height: 1.6;">{{message}}</p>
              <a href="{{action_url}}" style="display: inline-block; background: #dc2626; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; margin-top: 20px;">Take Action →</a>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center;">
              <p style="color: #94a3b8; margin: 0; font-size: 12px;">© 2025 PITCH CRM</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  '["first_name", "company_name", "alert_title", "message", "action_url"]'::jsonb,
  true,
  NULL
);

-- Create trigger for updated_at
CREATE TRIGGER update_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();