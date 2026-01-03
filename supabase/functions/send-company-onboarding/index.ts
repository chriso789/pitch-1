import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin BCC for all onboarding emails
const ADMIN_BCC = 'support@obriencontractingusa.com';

interface OnboardingEmailRequest {
  tenant_id: string;
  user_id?: string;
  email: string;
  first_name: string;
  last_name?: string;
  company_name: string;
}

// Comprehensive 5-step onboarding email template
const generateComprehensiveEmailHtml = (firstName: string, companyName: string, onboardingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Welcome to PITCH CRM - ${companyName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <!-- Main Container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <!-- Email Card -->
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width: 640px; width: 100%;">
          
          <!-- Premium Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 0;">
              <div style="height: 4px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 50%, #d4af37 100%);"></div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 48px 40px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 20px; margin-bottom: 24px; text-align: center; line-height: 80px;">
                            <span style="font-size: 40px; font-weight: 800; color: white;">P</span>
                          </div>
                          <h1 style="margin: 0; font-size: 32px; font-weight: 800;">
                            <span style="color: #ffffff;">PITCH</span>
                            <span style="color: #d4af37;"> CRM</span>
                          </h1>
                          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">
                            The #1 Construction Sales Platform
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="background: #ffffff; padding: 48px 40px;">
              
              <!-- Personalized Greeting -->
              <h2 style="margin: 0 0 16px; font-size: 28px; font-weight: 700; color: #0f172a;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569;">
                Your <strong style="color: #16a34a;">${companyName}</strong> account is ready! This email will guide you through setting up your entire CRM in just 5 simple steps.
              </p>
              
              <!-- Progress Indicator -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 24px; border: 1px solid #bbf7d0;">
                    <p style="margin: 0 0 16px; font-size: 14px; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: 1px;">
                      📋 Your 5-Step Quick Start Checklist
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-right: 8px;">
                          <div style="width: 28px; height: 28px; background: #16a34a; border-radius: 50%; text-align: center; line-height: 28px; color: white; font-weight: 700; font-size: 12px;">1</div>
                        </td>
                        <td style="padding-right: 4px;"><div style="width: 40px; height: 3px; background: #e2e8f0;"></div></td>
                        <td style="padding-right: 8px;">
                          <div style="width: 28px; height: 28px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 28px; color: #94a3b8; font-weight: 700; font-size: 12px;">2</div>
                        </td>
                        <td style="padding-right: 4px;"><div style="width: 40px; height: 3px; background: #e2e8f0;"></div></td>
                        <td style="padding-right: 8px;">
                          <div style="width: 28px; height: 28px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 28px; color: #94a3b8; font-weight: 700; font-size: 12px;">3</div>
                        </td>
                        <td style="padding-right: 4px;"><div style="width: 40px; height: 3px; background: #e2e8f0;"></div></td>
                        <td style="padding-right: 8px;">
                          <div style="width: 28px; height: 28px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 28px; color: #94a3b8; font-weight: 700; font-size: 12px;">4</div>
                        </td>
                        <td style="padding-right: 4px;"><div style="width: 40px; height: 3px; background: #e2e8f0;"></div></td>
                        <td>
                          <div style="width: 28px; height: 28px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 28px; color: #94a3b8; font-weight: 700; font-size: 12px;">5</div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 12px 0 0; color: #475569; font-size: 14px;">
                      <strong>~15 minutes</strong> to fully set up your business
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Primary CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td align="center">
                    <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 18px 48px; border-radius: 12px; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 8px 24px rgba(22, 163, 74, 0.35);">
                      🚀 Log In & Complete Setup
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 1: SET PASSWORD -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="padding: 24px; background: #fafafa; border-radius: 16px; border-left: 5px solid #16a34a;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 12px; text-align: center; line-height: 44px; color: white; font-weight: 800; font-size: 18px;">1</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #0f172a;">Set Your Password</h3>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 15px; line-height: 1.6;">
                            Click the button above to log in for the first time. You'll be prompted to create a secure password for your account.
                          </p>
                          <p style="margin: 0; color: #64748b; font-size: 13px;">
                            ⏱️ <strong>Takes:</strong> 1 minute
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 2: UPLOAD COMPANY LOGO -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="padding: 24px; background: #fafafa; border-radius: 16px; border-left: 5px solid #d4af37;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #d4af37 0%, #f4e4bc 100%); border-radius: 12px; text-align: center; line-height: 44px; color: #0f172a; font-weight: 800; font-size: 18px;">2</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #0f172a;">Upload Your Company Logo</h3>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 15px; line-height: 1.6;">
                            Go to <strong>Settings → Company Profile</strong> and upload your logo. This appears on:
                          </p>
                          <ul style="margin: 0 0 12px; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                            <li>All proposals and estimates sent to customers</li>
                            <li>Contracts and agreements (DocuSign)</li>
                            <li>Customer portal &amp; communication</li>
                            <li>Team dashboards and reports</li>
                          </ul>
                          <p style="margin: 0; color: #64748b; font-size: 13px;">
                            💡 <strong>Tip:</strong> Use a PNG with transparent background for best results
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 3: ADD TEAM MEMBERS -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="padding: 24px; background: #fafafa; border-radius: 16px; border-left: 5px solid #3b82f6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); border-radius: 12px; text-align: center; line-height: 44px; color: white; font-weight: 800; font-size: 18px;">3</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #0f172a;">Add Your Team Members</h3>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 15px; line-height: 1.6;">
                            Navigate to <strong>Settings → Team Management</strong> to invite your team:
                          </p>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 12px;">
                            <tr>
                              <td style="padding: 8px 12px; background: #eff6ff; border-radius: 8px; margin-right: 8px;">
                                <span style="color: #1d4ed8; font-size: 13px; font-weight: 600;">👔 Sales Reps</span>
                              </td>
                              <td style="width: 8px;"></td>
                              <td style="padding: 8px 12px; background: #f0fdf4; border-radius: 8px;">
                                <span style="color: #16a34a; font-size: 13px; font-weight: 600;">🏢 Office Staff</span>
                              </td>
                              <td style="width: 8px;"></td>
                              <td style="padding: 8px 12px; background: #fef3c7; border-radius: 8px;">
                                <span style="color: #d97706; font-size: 13px; font-weight: 600;">🔧 Project Managers</span>
                              </td>
                            </tr>
                          </table>
                          <ul style="margin: 0 0 12px; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                            <li>Assign roles with specific permissions</li>
                            <li>Link team members to office locations</li>
                            <li>Each person gets their own branded invitation email</li>
                          </ul>
                          <p style="margin: 0; color: #64748b; font-size: 13px;">
                            ⏱️ <strong>Takes:</strong> 2-3 minutes per team member
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 4: CONFIGURE PAY STRUCTURES -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="padding: 24px; background: #fafafa; border-radius: 16px; border-left: 5px solid #8b5cf6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); border-radius: 12px; text-align: center; line-height: 44px; color: white; font-weight: 800; font-size: 18px;">4</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #0f172a;">Configure Commission Structures</h3>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 15px; line-height: 1.6;">
                            PITCH CRM supports flexible compensation models for your team:
                          </p>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 12px;">
                            <tr>
                              <td style="padding: 12px; background: #f5f3ff; border-radius: 8px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #5b21b6; font-size: 14px;">💰 Profit Split</p>
                                <p style="margin: 0; color: #6b7280; font-size: 13px;">Set overhead % + commission % on job profit</p>
                              </td>
                            </tr>
                            <tr><td style="height: 8px;"></td></tr>
                            <tr>
                              <td style="padding: 12px; background: #fef3c7; border-radius: 8px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #92400e; font-size: 14px;">⏰ Hourly Pay</p>
                                <p style="margin: 0; color: #6b7280; font-size: 13px;">Configure hourly rates for project managers</p>
                              </td>
                            </tr>
                            <tr><td style="height: 8px;"></td></tr>
                            <tr>
                              <td style="padding: 12px; background: #dcfce7; border-radius: 8px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #166534; font-size: 14px;">📊 Tiered Commissions</p>
                                <p style="margin: 0; color: #6b7280; font-size: 13px;">Create performance-based incentive tiers</p>
                              </td>
                            </tr>
                          </table>
                          <p style="margin: 0; color: #64748b; font-size: 13px;">
                            💡 <strong>Benefit:</strong> Automatic earnings tracking on every job!
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 5: CUSTOMIZE PIPELINE -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="padding: 24px; background: #fafafa; border-radius: 16px; border-left: 5px solid #ec4899;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #ec4899 0%, #f472b6 100%); border-radius: 12px; text-align: center; line-height: 44px; color: white; font-weight: 800; font-size: 18px;">5</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #0f172a;">Customize Your Sales Pipeline</h3>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 15px; line-height: 1.6;">
                            Your CRM comes pre-configured with industry-standard stages:
                          </p>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 12px;">
                            <tr>
                              <td style="padding: 6px 10px; background: #fee2e2; border-radius: 6px; font-size: 12px; font-weight: 600; color: #991b1b;">Lead</td>
                              <td style="padding: 0 4px; color: #94a3b8;">→</td>
                              <td style="padding: 6px 10px; background: #fef3c7; border-radius: 6px; font-size: 12px; font-weight: 600; color: #92400e;">Qualified</td>
                              <td style="padding: 0 4px; color: #94a3b8;">→</td>
                              <td style="padding: 6px 10px; background: #dbeafe; border-radius: 6px; font-size: 12px; font-weight: 600; color: #1e40af;">Proposal</td>
                              <td style="padding: 0 4px; color: #94a3b8;">→</td>
                              <td style="padding: 6px 10px; background: #e0e7ff; border-radius: 6px; font-size: 12px; font-weight: 600; color: #3730a3;">Contract</td>
                              <td style="padding: 0 4px; color: #94a3b8;">→</td>
                              <td style="padding: 6px 10px; background: #dcfce7; border-radius: 6px; font-size: 12px; font-weight: 600; color: #166534;">Complete</td>
                            </tr>
                          </table>
                          <p style="margin: 0 0 12px; color: #475569; font-size: 14px; line-height: 1.6;">
                            Go to <strong>Settings → Pipeline Configuration</strong> to:
                          </p>
                          <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                            <li>Add/remove pipeline stages</li>
                            <li>Configure lead sources</li>
                            <li>Set up job types (Roofing, Siding, Gutters, etc.)</li>
                            <li>Create automation triggers for stage changes</li>
                          </ul>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- WHAT YOU'RE GETTING (Value Props) -->
              <!-- ============================================ -->
              <h3 style="margin: 0 0 20px; font-size: 20px; font-weight: 700; color: #0f172a;">
                💎 What's Included in Your Account:
              </h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">📞</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">Power Dialer</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">$149/mo value</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">📐</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">AI Measurements</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">$50/report saved</p>
                        </td>
                      </tr>
                      <tr><td colspan="3" style="height: 12px;"></td></tr>
                      <tr>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">📋</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">Smart Estimates</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">$99/mo value</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">🗺️</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">Territory Mapping</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">$125/mo value</p>
                        </td>
                      </tr>
                      <tr><td colspan="3" style="height: 12px;"></td></tr>
                      <tr>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">✍️</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">E-Signatures</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">DocuSign integrated</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 16px; background: #fafafa; border-radius: 12px; vertical-align: top;">
                          <p style="margin: 0 0 4px; font-size: 20px;">📸</p>
                          <p style="margin: 0 0 2px; font-weight: 700; color: #0f172a; font-size: 14px;">Photo Management</p>
                          <p style="margin: 0; color: #16a34a; font-size: 12px; font-weight: 600;">GPS-stamped docs</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Testimonial -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; padding: 28px;">
                    <div style="font-size: 36px; color: #d4af37; opacity: 0.4; font-family: Georgia, serif; line-height: 1;">"</div>
                    <p style="margin: -10px 0 16px; color: #f1f5f9; font-size: 16px; line-height: 1.7; font-style: italic;">
                      PITCH transformed our business. We closed 40% more deals in the first 90 days. The AI measurements alone saved us thousands.
                    </p>
                    <p style="margin: 0; color: #94a3b8; font-size: 14px;">
                      <strong style="color: #f1f5f9;">Mike Rodriguez</strong> — CEO, Apex Roofing Solutions
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Final CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 28px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; border: 2px solid #bbf7d0;">
                    <p style="margin: 0 0 16px; color: #166534; font-size: 17px; font-weight: 600;">
                      Ready to get started?
                    </p>
                    <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-size: 17px; font-weight: 700;">
                      🚀 Complete Your Setup Now
                    </a>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #0f172a; border-radius: 0 0 24px 24px; padding: 32px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                      <tr>
                        <td style="padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 12px;">📧 Questions?</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 13px; font-weight: 600;">Reply to this email</p>
                        </td>
                        <td style="padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 12px;">⏱️ Setup Time</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 13px; font-weight: 600;">~15 minutes</p>
                        </td>
                        <td style="padding: 0 16px;">
                          <p style="margin: 0; color: #94a3b8; font-size: 12px;">🔒 Security</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 13px; font-weight: 600;">256-bit encrypted</p>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="margin: 0 0 16px; color: #64748b; font-size: 12px;">
                      ⚡ This link expires in 4 hours. If you didn't request this, please ignore this email.
                    </p>
                    
                    <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #d4af37 50%, transparent 100%); margin: 20px 0;"></div>
                    
                    <p style="margin: 0; color: #64748b; font-size: 11px;">
                      © ${new Date().getFullYear()} PITCH CRM. All rights reserved.<br>
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Privacy Policy</a> • 
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Terms of Service</a> • 
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Unsubscribe</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
  
</body>
</html>
`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { tenant_id, user_id, email, first_name, last_name, company_name }: OnboardingEmailRequest = await req.json();

    if (!tenant_id || !email || !first_name || !company_name) {
      console.error('[send-company-onboarding] Missing required fields:', { tenant_id, email, first_name, company_name });
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-company-onboarding] Sending comprehensive onboarding email to ${email} for ${company_name}`);

    // Generate unique token
    const token = crypto.randomUUID() + '-' + Date.now().toString(36);
    
    // Token expires in 4 hours for security
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 4);

    // Store token in database
    const { error: tokenError } = await supabase
      .from('company_onboarding_tokens')
      .insert({
        tenant_id,
        user_id,
        email,
        token,
        expires_at: expiresAt.toISOString(),
      });

    if (tokenError) {
      console.error('[send-company-onboarding] Failed to create onboarding token:', tokenError);
      return new Response(
        JSON.stringify({ error: "Failed to create onboarding token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build onboarding URL
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-crm.lovable.app";
    const onboardingUrl = `${appUrl}/onboarding/${token}`;

    // Try to fetch custom template from database
    let emailHtml: string;
    let emailSubject: string;
    
    const { data: customTemplate } = await supabase
      .from('email_templates')
      .select('subject, html_body')
      .eq('template_type', 'onboarding')
      .eq('is_active', true)
      .eq('is_default', true)
      .single();
    
    if (customTemplate?.html_body) {
      console.log('[send-company-onboarding] Using custom template from database');
      emailHtml = customTemplate.html_body
        .replace(/\{\{first_name\}\}/g, first_name)
        .replace(/\{\{company_name\}\}/g, company_name)
        .replace(/\{\{login_url\}\}/g, onboardingUrl);
      emailSubject = customTemplate.subject
        .replace(/\{\{first_name\}\}/g, first_name)
        .replace(/\{\{company_name\}\}/g, company_name);
    } else {
      console.log('[send-company-onboarding] Using comprehensive 5-step email template');
      emailHtml = generateComprehensiveEmailHtml(first_name, company_name, onboardingUrl);
      emailSubject = `🎉 Welcome to PITCH CRM — Complete Your ${company_name} Setup (5 Easy Steps)`;
    }

    let resendMessageId = null;
    let emailError: string | null = null;

    // Send email via Resend with RETRY LOGIC
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
      const fromAddress = `PITCH CRM <onboarding@${fromDomain}>`;
      
      const maxAttempts = 3;
      let attempts = 0;
      
      while (!resendMessageId && attempts < maxAttempts) {
        attempts++;
        console.log(`[send-company-onboarding] Attempt ${attempts}/${maxAttempts} - Sending from: ${fromAddress} to: ${email}`);
        
        try {
          const emailResult = await resend.emails.send({
            from: fromAddress,
            to: [email],
            bcc: [ADMIN_BCC], // Always BCC admin
            subject: emailSubject,
            html: emailHtml,
            tags: [
              { name: "email_type", value: "company_onboarding" },
              { name: "tenant_id", value: tenant_id },
              { name: "campaign", value: "company_onboarding_v2" }
            ],
          });

          console.log('[send-company-onboarding] Resend response:', JSON.stringify(emailResult));
          
          if (emailResult.error) {
            console.error(`[send-company-onboarding] Attempt ${attempts} failed:`, emailResult.error);
            emailError = emailResult.error.message || 'Resend API error';
          } else {
            resendMessageId = emailResult?.data?.id || null;
            emailError = null;
            console.log(`[send-company-onboarding] Email sent successfully on attempt ${attempts}, ID:`, resendMessageId);
          }
        } catch (sendError: any) {
          console.error(`[send-company-onboarding] Attempt ${attempts} exception:`, sendError);
          emailError = sendError.message || 'Failed to send email';
        }
        
        // Wait before retry (exponential backoff)
        if (!resendMessageId && attempts < maxAttempts) {
          const waitMs = 1000 * attempts;
          console.log(`[send-company-onboarding] Waiting ${waitMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    } else {
      console.error('[send-company-onboarding] RESEND_API_KEY not configured!');
      emailError = 'RESEND_API_KEY not configured';
    }

    // Log the email send with detailed error info
    const { error: logError } = await supabase
      .from('onboarding_email_log')
      .insert({
        tenant_id,
        recipient_email: email,
        recipient_name: `${first_name} ${last_name || ''}`.trim(),
        sent_by: user_id,
        status: resendMessageId ? 'sent' : 'failed',
        resend_message_id: resendMessageId,
        metadata: { 
          company_name, 
          onboarding_url: onboardingUrl,
          error: emailError,
          bcc_admin: ADMIN_BCC,
          email_type: 'comprehensive_5_step'
        }
      });

    if (logError) {
      console.warn('[send-company-onboarding] Failed to log email:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        token,
        onboarding_url: onboardingUrl,
        expires_at: expiresAt.toISOString(),
        resend_message_id: resendMessageId,
        email_sent: !!resendMessageId
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('[send-company-onboarding] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
