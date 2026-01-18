import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Enterprise-grade comprehensive onboarding email template (matches production)
const generateEnterpriseEmailHtml = (firstName: string, companyName: string, onboardingUrl: string) => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to PITCH CRM™ - ${companyName}</title>
  <!--[if mso]>
  <style>
    table {border-collapse: collapse;}
    td,th,div,p,a,h1,h2,h3,h4,h5,h6 {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  
  <!-- Preheader Text (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    Your ${companyName} account is ready! Complete 5 easy steps to start saving $46K+/year. &nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  
  <!-- Main Container - Full Width -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        
        <!-- Email Card - WIDER 720px -->
        <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="max-width: 720px; width: 100%;">
          
          <!-- ====================================== -->
          <!-- PREMIUM HEADER WITH PROFESSIONAL LOGO -->
          <!-- ====================================== -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 0;">
              <!-- Gold accent bar -->
              <div style="height: 5px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 25%, #d4af37 50%, #f4e4bc 75%, #d4af37 100%); border-radius: 24px 24px 0 0;"></div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 48px 48px 40px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <!-- Professional Logo -->
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                            <tr>
                              <td style="padding-right: 16px; vertical-align: middle;">
                                <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #16a34a 0%, #0d9488 100%); border-radius: 16px; text-align: center; line-height: 64px; box-shadow: 0 8px 32px rgba(22, 163, 74, 0.4);">
                                  <span style="font-size: 34px; font-weight: 800; color: white; font-family: 'Helvetica Neue', Arial, sans-serif;">P</span>
                                </div>
                              </td>
                              <td style="vertical-align: middle;">
                                <span style="font-size: 38px; font-weight: 800; color: #ffffff; font-family: 'Helvetica Neue', Arial, sans-serif; letter-spacing: -1px;">PITCH</span>
                                <span style="font-size: 38px; font-weight: 800; color: #d4af37; font-family: 'Helvetica Neue', Arial, sans-serif; letter-spacing: -1px;"> CRM</span><sup style="font-size: 14px; color: #d4af37;">™</sup>
                              </td>
                            </tr>
                          </table>
                          <p style="margin: 0; color: #94a3b8; font-size: 15px; letter-spacing: 3px; text-transform: uppercase; font-weight: 500;">
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
          
          <!-- ====================================== -->
          <!-- MAIN CONTENT -->
          <!-- ====================================== -->
          <tr>
            <td style="background: #ffffff; padding: 56px 48px;">
              
              <!-- Personalized Greeting -->
              <h2 style="margin: 0 0 20px; font-size: 32px; font-weight: 700; color: #0f172a; line-height: 1.2;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              
              <p style="margin: 0 0 32px; font-size: 18px; line-height: 1.7; color: #475569;">
                Your <strong style="color: #16a34a;">${companyName}</strong> account is fully activated. This email contains everything you need to set up your entire CRM platform in just 5 simple steps.
              </p>
              
              <!-- ====================================== -->
              <!-- EXECUTIVE SUMMARY METRICS -->
              <!-- ====================================== -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 32px; border: 1px solid #334155;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="33%" style="text-align: center; padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #d4af37; font-size: 36px; font-weight: 800; line-height: 1;">$46K+</p>
                          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Annual Savings</p>
                        </td>
                        <td width="33%" style="text-align: center; padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #22c55e; font-size: 36px; font-weight: 800; line-height: 1;">10+</p>
                          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Tools Replaced</p>
                        </td>
                        <td width="33%" style="text-align: center; padding: 0 16px;">
                          <p style="margin: 0; color: #60a5fa; font-size: 36px; font-weight: 800; line-height: 1;">15 min</p>
                          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Setup Time</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Primary CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 48px;">
                <tr>
                  <td align="center">
                    <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 20px 56px; border-radius: 14px; font-size: 19px; font-weight: 700; letter-spacing: 0.3px; box-shadow: 0 12px 32px rgba(22, 163, 74, 0.4);">
                      🚀 Log In & Complete Setup
                    </a>
                    <p style="margin: 16px 0 0; color: #94a3b8; font-size: 14px;">
                      ⏱️ Takes approximately 15 minutes
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ====================================== -->
              <!-- TOOLS YOU'RE REPLACING -->
              <!-- ====================================== -->
              <h3 style="margin: 0 0 20px; font-size: 22px; font-weight: 700; color: #0f172a;">
                🔄 Software You No Longer Need
              </h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 16px; padding: 24px 28px; border-left: 5px solid #ef4444;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">AccuLynx ($273/mo)</span>
                        </td>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">CompanyCam ($49/mo)</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">Mojo Dialer ($149/mo)</span>
                        </td>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">Roofr ($99/mo)</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">EagleView ($50/report)</span>
                        </td>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">DocuSign ($40/mo)</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">Spotio ($125/mo)</span>
                        </td>
                        <td width="50%" style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #dc2626; font-weight: 700; font-size: 16px;">✗</span>
                          <span style="color: #7f1d1d; font-size: 15px; text-decoration: line-through; margin-left: 10px;">JobNimbus ($99/mo)</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 16px 0 0; color: #166534; font-size: 15px; font-weight: 600; background: #dcfce7; padding: 12px 16px; border-radius: 8px; text-align: center;">
                      ✓ All included in your PITCH CRM™ subscription
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ====================================== -->
              <!-- 5-STEP QUICK START CHECKLIST HEADER -->
              <!-- ====================================== -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 28px; border: 1px solid #bbf7d0;">
                    <p style="margin: 0 0 20px; font-size: 15px; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: 1.5px;">
                      📋 Your 5-Step Quick Start Checklist
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-right: 10px;">
                          <div style="width: 32px; height: 32px; background: #16a34a; border-radius: 50%; text-align: center; line-height: 32px; color: white; font-weight: 700; font-size: 14px;">1</div>
                        </td>
                        <td style="padding-right: 6px;"><div style="width: 48px; height: 4px; background: #e2e8f0; border-radius: 2px;"></div></td>
                        <td style="padding-right: 10px;">
                          <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 32px; color: #94a3b8; font-weight: 700; font-size: 14px;">2</div>
                        </td>
                        <td style="padding-right: 6px;"><div style="width: 48px; height: 4px; background: #e2e8f0; border-radius: 2px;"></div></td>
                        <td style="padding-right: 10px;">
                          <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 32px; color: #94a3b8; font-weight: 700; font-size: 14px;">3</div>
                        </td>
                        <td style="padding-right: 6px;"><div style="width: 48px; height: 4px; background: #e2e8f0; border-radius: 2px;"></div></td>
                        <td style="padding-right: 10px;">
                          <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 32px; color: #94a3b8; font-weight: 700; font-size: 14px;">4</div>
                        </td>
                        <td style="padding-right: 6px;"><div style="width: 48px; height: 4px; background: #e2e8f0; border-radius: 2px;"></div></td>
                        <td>
                          <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; line-height: 32px; color: #94a3b8; font-weight: 700; font-size: 14px;">5</div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 16px 0 0; color: #475569; font-size: 15px;">
                      <strong>~15 minutes</strong> to fully configure your business
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ============================================ -->
              <!-- STEP 1: SET PASSWORD -->
              <!-- ============================================ -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="padding: 28px; background: #fafafa; border-radius: 16px; border-left: 5px solid #16a34a;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="56" valign="top">
                          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 12px; text-align: center; line-height: 48px; color: white; font-weight: 800; font-size: 20px; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);">1</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 10px; font-size: 19px; font-weight: 700; color: #0f172a;">Set Your Password</h3>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 16px; line-height: 1.65;">
                            Click the button above to log in for the first time. You'll be prompted to create a secure password for your account.
                          </p>
                          <p style="margin: 0; color: #64748b; font-size: 14px;">
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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="padding: 28px; background: #fafafa; border-radius: 16px; border-left: 5px solid #d4af37;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="56" valign="top">
                          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #d4af37 0%, #f4e4bc 100%); border-radius: 12px; text-align: center; line-height: 48px; color: #0f172a; font-weight: 800; font-size: 20px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.25);">2</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 10px; font-size: 19px; font-weight: 700; color: #0f172a;">Upload Your Company Logo</h3>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 16px; line-height: 1.65;">
                            Go to <strong>Settings → Company Profile</strong> and upload your logo. This appears on:
                          </p>
                          <ul style="margin: 0 0 14px; padding-left: 22px; color: #475569; font-size: 15px; line-height: 1.9;">
                            <li>All proposals and estimates sent to customers</li>
                            <li>Contracts and agreements (DocuSign)</li>
                            <li>Customer portal &amp; communication</li>
                            <li>Team dashboards and reports</li>
                          </ul>
                          <p style="margin: 0; color: #64748b; font-size: 14px;">
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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="padding: 28px; background: #fafafa; border-radius: 16px; border-left: 5px solid #3b82f6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="56" valign="top">
                          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); border-radius: 12px; text-align: center; line-height: 48px; color: white; font-weight: 800; font-size: 20px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">3</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 10px; font-size: 19px; font-weight: 700; color: #0f172a;">Add Your Team Members</h3>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 16px; line-height: 1.65;">
                            Navigate to <strong>Settings → Team Management</strong> to invite your team:
                          </p>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 14px;">
                            <tr>
                              <td style="padding: 10px 14px; background: #eff6ff; border-radius: 8px; margin-right: 8px;">
                                <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">👔 Sales Reps</span>
                              </td>
                              <td style="width: 10px;"></td>
                              <td style="padding: 10px 14px; background: #f0fdf4; border-radius: 8px;">
                                <span style="color: #16a34a; font-size: 14px; font-weight: 600;">🏢 Office Staff</span>
                              </td>
                              <td style="width: 10px;"></td>
                              <td style="padding: 10px 14px; background: #fef3c7; border-radius: 8px;">
                                <span style="color: #d97706; font-size: 14px; font-weight: 600;">🔧 Project Managers</span>
                              </td>
                            </tr>
                          </table>
                          <ul style="margin: 0 0 14px; padding-left: 22px; color: #475569; font-size: 15px; line-height: 1.9;">
                            <li>Assign roles with specific permissions</li>
                            <li>Link team members to office locations</li>
                            <li>Each person gets their own branded invitation email</li>
                          </ul>
                          <p style="margin: 0; color: #64748b; font-size: 14px;">
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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="padding: 28px; background: #fafafa; border-radius: 16px; border-left: 5px solid #8b5cf6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="56" valign="top">
                          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); border-radius: 12px; text-align: center; line-height: 48px; color: white; font-weight: 800; font-size: 20px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);">4</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 10px; font-size: 19px; font-weight: 700; color: #0f172a;">Configure Commission Structures</h3>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 16px; line-height: 1.65;">
                            PITCH CRM supports flexible compensation models for your team:
                          </p>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 14px;">
                            <tr>
                              <td style="padding: 14px; background: #f5f3ff; border-radius: 10px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #5b21b6; font-size: 15px;">💰 Profit Split</p>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">Set overhead % + commission % on job profit</p>
                              </td>
                            </tr>
                            <tr><td style="height: 10px;"></td></tr>
                            <tr>
                              <td style="padding: 14px; background: #fef3c7; border-radius: 10px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #92400e; font-size: 15px;">⏰ Hourly Pay</p>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">Configure hourly rates for project managers</p>
                              </td>
                            </tr>
                            <tr><td style="height: 10px;"></td></tr>
                            <tr>
                              <td style="padding: 14px; background: #dcfce7; border-radius: 10px;">
                                <p style="margin: 0 0 4px; font-weight: 700; color: #166534; font-size: 15px;">📊 Tiered Commissions</p>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">Create performance-based incentive tiers</p>
                              </td>
                            </tr>
                          </table>
                          <p style="margin: 0; color: #64748b; font-size: 14px;">
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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="padding: 28px; background: #fafafa; border-radius: 16px; border-left: 5px solid #ec4899;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="56" valign="top">
                          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #ec4899 0%, #f472b6 100%); border-radius: 12px; text-align: center; line-height: 48px; color: white; font-weight: 800; font-size: 20px; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.25);">5</div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 10px; font-size: 19px; font-weight: 700; color: #0f172a;">Customize Your Sales Pipeline</h3>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 16px; line-height: 1.65;">
                            Your CRM comes pre-configured with industry-standard stages:
                          </p>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 14px;">
                            <tr>
                              <td style="padding: 8px 12px; background: #fee2e2; border-radius: 6px; font-size: 13px; font-weight: 600; color: #991b1b;">Lead</td>
                              <td style="padding: 0 6px; color: #94a3b8;">→</td>
                              <td style="padding: 8px 12px; background: #fef3c7; border-radius: 6px; font-size: 13px; font-weight: 600; color: #92400e;">Qualified</td>
                              <td style="padding: 0 6px; color: #94a3b8;">→</td>
                              <td style="padding: 8px 12px; background: #dbeafe; border-radius: 6px; font-size: 13px; font-weight: 600; color: #1e40af;">Proposal</td>
                              <td style="padding: 0 6px; color: #94a3b8;">→</td>
                              <td style="padding: 8px 12px; background: #e0e7ff; border-radius: 6px; font-size: 13px; font-weight: 600; color: #3730a3;">Contract</td>
                              <td style="padding: 0 6px; color: #94a3b8;">→</td>
                              <td style="padding: 8px 12px; background: #dcfce7; border-radius: 6px; font-size: 13px; font-weight: 600; color: #166534;">Complete</td>
                            </tr>
                          </table>
                          <p style="margin: 0 0 14px; color: #475569; font-size: 15px; line-height: 1.65;">
                            Go to <strong>Settings → Pipeline Configuration</strong> to:
                          </p>
                          <ul style="margin: 0; padding-left: 22px; color: #475569; font-size: 15px; line-height: 1.9;">
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
              
              <!-- ====================================== -->
              <!-- VIDEO WALKTHROUGHS -->
              <!-- ====================================== -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 20px; padding: 28px; border: 1px solid #bfdbfe;">
                    <h3 style="margin: 0 0 20px; font-size: 20px; font-weight: 700; color: #1e40af;">
                      🎥 Video Walkthroughs
                    </h3>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 12px 0; border-bottom: 1px solid #bfdbfe;">
                          <span style="color: #3b82f6; font-size: 18px;">▶</span>
                          <span style="color: #1e40af; font-size: 15px; margin-left: 12px; font-weight: 500;">Getting Started Overview (5 min)</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 0; border-bottom: 1px solid #bfdbfe;">
                          <span style="color: #3b82f6; font-size: 18px;">▶</span>
                          <span style="color: #1e40af; font-size: 15px; margin-left: 12px; font-weight: 500;">Adding Team Members & Permissions (3 min)</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 0; border-bottom: 1px solid #bfdbfe;">
                          <span style="color: #3b82f6; font-size: 18px;">▶</span>
                          <span style="color: #1e40af; font-size: 15px; margin-left: 12px; font-weight: 500;">Creating Your First Estimate (4 min)</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 0;">
                          <span style="color: #3b82f6; font-size: 18px;">▶</span>
                          <span style="color: #1e40af; font-size: 15px; margin-left: 12px; font-weight: 500;">Setting Up Commission Structures (3 min)</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- ====================================== -->
              <!-- WHAT'S INCLUDED (Value Props Grid) -->
              <!-- ====================================== -->
              <h3 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #0f172a;">
                💎 What's Included in Your Account
              </h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">📞</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">Power Dialer</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">$149/mo value</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">📐</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">AI Measurements</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">$50/report saved</p>
                        </td>
                      </tr>
                      <tr><td colspan="3" style="height: 14px;"></td></tr>
                      <tr>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">📋</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">Smart Estimates</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">$99/mo value</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">🗺️</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">Territory Mapping</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">$125/mo value</p>
                        </td>
                      </tr>
                      <tr><td colspan="3" style="height: 14px;"></td></tr>
                      <tr>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">✍️</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">E-Signatures</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">DocuSign integrated</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="padding: 20px; background: #fafafa; border-radius: 14px; vertical-align: top;">
                          <p style="margin: 0 0 6px; font-size: 24px;">📸</p>
                          <p style="margin: 0 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">Photo Management</p>
                          <p style="margin: 0; color: #16a34a; font-size: 13px; font-weight: 600;">GPS-stamped docs</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Testimonial -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 32px;">
                    <div style="font-size: 48px; color: #d4af37; opacity: 0.5; font-family: Georgia, serif; line-height: 1; margin-bottom: -12px;">"</div>
                    <p style="margin: 0 0 20px; color: #f1f5f9; font-size: 18px; line-height: 1.7; font-style: italic;">
                      PITCH transformed our business. We closed 40% more deals in the first 90 days. The AI measurements alone saved us thousands.
                    </p>
                    <p style="margin: 0; color: #94a3b8; font-size: 15px;">
                      <strong style="color: #f1f5f9;">Mike Rodriguez</strong> — CEO, Apex Roofing Solutions
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ====================================== -->
              <!-- SUPPORT SECTION -->
              <!-- ====================================== -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td style="text-align: center; padding: 32px; background: #f8fafc; border-radius: 20px; border: 1px solid #e2e8f0;">
                    <p style="margin: 0 0 10px; font-size: 20px; font-weight: 700; color: #0f172a;">
                      Need Help Getting Set Up?
                    </p>
                    <p style="margin: 0 0 24px; color: #64748b; font-size: 16px;">
                      Our onboarding team is here to help you succeed
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                      <tr>
                        <td style="padding: 0 20px; text-align: center;">
                          <p style="margin: 0 0 8px; font-size: 28px;">📧</p>
                          <p style="margin: 0; color: #0f172a; font-size: 14px; font-weight: 600;">support@pitch-crm.ai</p>
                        </td>
                        <td style="padding: 0 20px; text-align: center; border-left: 1px solid #e2e8f0;">
                          <p style="margin: 0 0 8px; font-size: 28px;">📞</p>
                          <p style="margin: 0; color: #0f172a; font-size: 14px; font-weight: 600;">Schedule a Call</p>
                        </td>
                        <td style="padding: 0 20px; text-align: center; border-left: 1px solid #e2e8f0;">
                          <p style="margin: 0 0 8px; font-size: 28px;">💬</p>
                          <p style="margin: 0; color: #0f172a; font-size: 14px; font-weight: 600;">Live Chat</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Final CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 32px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 20px; border: 2px solid #bbf7d0;">
                    <p style="margin: 0 0 20px; color: #166534; font-size: 19px; font-weight: 600;">
                      Ready to get started?
                    </p>
                    <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 18px 48px; border-radius: 12px; font-size: 18px; font-weight: 700; box-shadow: 0 8px 24px rgba(22, 163, 74, 0.35);">
                      🚀 Complete Your Setup Now
                    </a>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- ====================================== -->
          <!-- FOOTER -->
          <!-- ====================================== -->
          <tr>
            <td style="background: #0f172a; border-radius: 0 0 24px 24px; padding: 40px 48px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                      <tr>
                        <td style="padding: 0 20px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">📧 Questions?</p>
                          <p style="margin: 6px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">Reply to this email</p>
                        </td>
                        <td style="padding: 0 20px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">⏱️ Setup Time</p>
                          <p style="margin: 6px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">~15 minutes</p>
                        </td>
                        <td style="padding: 0 20px;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">🔒 Security</p>
                          <p style="margin: 6px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">256-bit encrypted</p>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="margin: 0 0 20px; color: #64748b; font-size: 13px;">
                      ⚡ This is a test email. If you didn't request this, please ignore it.
                    </p>
                    
                    <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #d4af37 50%, transparent 100%); margin: 24px 0;"></div>
                    
                    <p style="margin: 0; color: #64748b; font-size: 12px;">
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.error("[send-test-onboarding] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ 
          error: "RESEND_API_KEY not configured",
          hint: "Add RESEND_API_KEY to Edge Function secrets in Supabase Dashboard"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, first_name, company_name } = await req.json();

    if (!email || !first_name || !company_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, first_name, company_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-test-onboarding] Sending enterprise test email to ${email} for ${company_name}`);

    const resend = new Resend(resendApiKey);
    
    // Get verified domain from env or fallback to resend.dev for testing
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromAddress = `PITCH CRM <onboarding@${fromDomain}>`;
    
    const testUrl = "https://pitch-crm.lovable.app/login";
    const emailHtml = generateEnterpriseEmailHtml(first_name, company_name, testUrl);
    const emailSubject = `🧪 TEST: Welcome to PITCH CRM — ${company_name}`;

    console.log(`[send-test-onboarding] Using from address: ${fromAddress}`);
    console.log(`[send-test-onboarding] Email subject: ${emailSubject}`);

    try {
      const emailResult = await resend.emails.send({
        from: fromAddress,
        to: [email],
        subject: emailSubject,
        html: emailHtml,
        tags: [
          { name: "email_type", value: "test_onboarding" },
          { name: "campaign", value: "enterprise_test_v3" }
        ],
      });

      console.log(`[send-test-onboarding] Resend response:`, JSON.stringify(emailResult));

      if (emailResult.error) {
        console.error(`[send-test-onboarding] Resend error:`, emailResult.error);
        return new Response(
          JSON.stringify({ 
            error: emailResult.error.message || "Resend API error",
            resend_error: emailResult.error
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          resend_id: emailResult.data?.id,
          sent_to: email,
          from: fromAddress,
          subject: emailSubject,
          message: `Enterprise test email successfully sent to ${email}`
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (resendError: any) {
      console.error(`[send-test-onboarding] Resend send error:`, resendError);
      return new Response(
        JSON.stringify({ 
          error: resendError.message || "Failed to send email via Resend",
          details: resendError.toString()
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error: any) {
    console.error("[send-test-onboarding] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
