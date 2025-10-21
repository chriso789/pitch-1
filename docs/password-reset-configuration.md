# Password Reset Configuration Guide

This guide explains how to properly configure password reset functionality in your PITCH CRM application.

## Overview

The password reset flow uses Supabase's native authentication system to send secure reset links to users. These links are time-limited and single-use for security.

## Requirements

### 1. Supabase URL Configuration

**CRITICAL:** You must configure the redirect URLs in your Supabase project for password reset to work correctly.

#### Steps to Configure:

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Add the following URLs:

**Site URL:**
```
https://your-app-domain.com
```
Or for development:
```
http://localhost:3000
```

**Redirect URLs (add all that apply):**
```
https://your-app-domain.com/reset-password
https://your-preview-url.lovable.app/reset-password
http://localhost:3000/reset-password
```

4. Click **Save** to apply changes

### 2. Email Provider Configuration

Supabase uses its own email service by default, but you can configure a custom SMTP provider for better deliverability:

1. Go to **Authentication** → **Email Templates** in Supabase Dashboard
2. Configure SMTP settings (optional but recommended for production)
3. Customize the password reset email template if desired

## How Password Reset Works

### User Flow:

1. **User requests reset:**
   - User goes to Login page → Reset tab
   - Enters their email address
   - Clicks "Send Reset Link"

2. **System sends email:**
   - Supabase generates a secure token with 1-hour expiration
   - Email is sent with reset link containing `access_token`, `refresh_token`, and `type=recovery`
   - Example link format: `https://your-app.com/reset-password?access_token=xxx&refresh_token=yyy&type=recovery`

3. **User clicks link:**
   - Link opens `/reset-password` page
   - System validates the tokens
   - If valid, user can enter new password

4. **Password is updated:**
   - User enters and confirms new password
   - System updates the password in Supabase Auth
   - User is signed out and redirected to login

### Security Features:

- ✅ Tokens expire after **1 hour**
- ✅ Tokens are **single-use** (can't be reused after password is reset)
- ✅ Tokens include cryptographic signatures to prevent tampering
- ✅ User is automatically signed out after successful reset
- ✅ No information is revealed about whether an email exists in the system

## Troubleshooting

### Issue: "Invalid or Expired Reset Link"

**Possible Causes:**

1. **Token Expired (Most Common)**
   - Reset links are only valid for 1 hour
   - **Solution:** Request a new reset link

2. **Redirect URL Not Configured**
   - The URL in the reset link doesn't match Supabase configuration
   - **Solution:** Add your domain to Supabase Redirect URLs (see step 1 above)

3. **Token Already Used**
   - Password was already reset with this link
   - **Solution:** Request a new reset link

4. **Incomplete Link**
   - URL was not fully copied from email
   - **Solution:** Copy the entire link or click the button in the email

### Issue: User Not Receiving Reset Email

**Possible Causes:**

1. **Email in Spam/Junk Folder**
   - Check spam folder
   - Add `noreply@mail.app.supabase.io` to safe senders

2. **Email Provider Blocking**
   - Some corporate email systems block automated emails
   - **Solution:** Use a personal email or configure custom SMTP

3. **Invalid Email Address**
   - User entered wrong email
   - **Solution:** Verify email spelling

4. **Email Delivery Delay**
   - Sometimes emails take a few minutes
   - **Solution:** Wait 5-10 minutes and check spam folder

### Issue: "Connection Error" When Requesting Reset

**Possible Causes:**

1. **Network Issues**
   - Check internet connection
   - Try again after a moment

2. **Supabase Service Down**
   - Rare, but check Supabase status page
   - **Solution:** Wait and retry

### Debugging with Console Logs

The application logs detailed information to the browser console. To view:

1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Look for password reset logs marked with ✅ (success) or ❌ (error)

**Example logs you'll see:**

```
✅ Password reset email requested: {email: "user@example.com", redirectTo: "...", timestamp: "..."}
🔐 Validating reset token: {hasAccessToken: true, hasRefreshToken: true, type: "recovery"}
✅ Token validated successfully: {userId: "...", timestamp: "..."}
✅ Password updated successfully
```

## Testing Checklist

### Before Going Live:

- [ ] Verify Site URL is set in Supabase
- [ ] Verify all Redirect URLs are configured
- [ ] Test password reset flow in preview environment
- [ ] Test password reset flow in production
- [ ] Verify reset emails are being received
- [ ] Check that reset emails are not in spam
- [ ] Test with expired link (wait 1+ hour)
- [ ] Test error messages are clear and helpful

### For Different Environments:

**Development (localhost:3000):**
```
http://localhost:3000/reset-password
```

**Preview (Lovable):**
```
https://your-preview-id.lovable.app/reset-password
```

**Production:**
```
https://your-custom-domain.com/reset-password
```

## Best Practices

### For Users:

1. ⏰ Use the reset link within 1 hour
2. 📧 Check spam folder if email doesn't arrive
3. 🔗 Click the button in the email rather than copying the link
4. 🔒 Choose a strong password (8+ characters with uppercase, lowercase, number, and special character)

### For Administrators:

1. 🌐 Configure ALL redirect URLs for all environments
2. 📧 Consider custom SMTP for better email deliverability
3. 📝 Customize email templates with your branding
4. 🔍 Monitor auth logs in Supabase for failed reset attempts
5. 🔐 Educate users about token expiration (1 hour limit)

## Support

If you continue to experience issues:

1. Check browser console for detailed error logs
2. Review Supabase Auth logs in the dashboard
3. Verify URL configuration matches exactly
4. Test with a different email provider
5. Contact your system administrator

---

**Last Updated:** 2025-10-21
**PITCH CRM Version:** 1.0
