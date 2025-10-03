# Authentication Setup Instructions

## ✅ Authentication is Now Fixed

The login and registration system has been properly configured with:

### 🔧 What Was Fixed

1. **Database Trigger Created**
   - Automatic user profile creation on signup
   - Profiles table properly populated with user metadata
   - Default 'admin' role assigned to new users
   - Proper tenant_id generation

2. **Password Validation Updated**
   - Changed from strict (8+ chars, uppercase, lowercase, number, special) 
   - To lenient (6+ characters minimum)
   - Easier for testing and development

3. **Error Handling Improved**
   - Clear error messages for invalid credentials
   - Email confirmation reminders
   - Connection timeout handling
   - User-friendly error display

4. **Session Management**
   - Proper emailRedirectTo configuration
   - Correct session state tracking
   - Automatic redirect after login/signup
   - Session persistence across page refreshes

## 🚀 Testing the System

### To Register a New Account:
1. Go to the login page
2. Click "Sign Up" tab
3. Fill in:
   - First Name (required)
   - Last Name (optional)
   - Email (valid email required)
   - Company Name (optional)
   - Password (minimum 6 characters)
   - Confirm Password (must match)
4. Click "Create Account"
5. Check your email for confirmation link (if email confirmation is enabled)
6. Click confirmation link
7. Return to login page and sign in

### To Sign In:
1. Enter your registered email
2. Enter your password
3. Click "Sign In"
4. You'll be redirected to the dashboard

## ⚙️ Supabase Configuration

### Email Confirmation Settings

For faster development/testing, you can disable email confirmation:

1. Go to Supabase Dashboard
2. Navigate to: **Authentication > Providers > Email**
3. Find "Confirm email" toggle
4. Turn it **OFF** for testing
5. Save changes

**With email confirmation DISABLED:**
- Users can sign in immediately after signup
- No need to check email for confirmation link
- Faster testing workflow

**With email confirmation ENABLED:**
- Users must click link in email before signing in
- More secure for production
- Standard authentication flow

### URL Configuration

Make sure these are set in Supabase Dashboard under **Authentication > URL Configuration**:

**Site URL:**
```
https://your-project-id.lovableproject.com
```

**Redirect URLs (add all of these):**
```
https://your-project-id.lovableproject.com
https://your-project-id.lovableproject.com/
http://localhost:8080
http://localhost:8080/
```

## 🔐 Current Test Credentials

Based on your screenshot, here are the credentials you're trying to use:
- Email: `jared@obriencontractingusa.com`
- Password: `Jared12345`

### If Login Fails:

**Option 1: Reset Password**
1. Click "Reset" tab on login page
2. Enter your email
3. Check email for reset link
4. Set a new password (minimum 6 characters)
5. Try logging in again

**Option 2: Create New Account**
1. Click "Sign Up" tab
2. Register with a new email
3. Use a simple password (e.g., `test123`)
4. Complete signup process
5. Confirm email if required
6. Sign in with new credentials

## 🐛 Troubleshooting Common Issues

### "Invalid email or password"
- **Cause**: Email/password combination doesn't exist in database
- **Fix**: 
  - Double-check credentials are correct
  - Try password reset
  - Create new account if needed
  - Check if account was created successfully

### "Please check your email and click the confirmation link"
- **Cause**: Email confirmation is enabled and email not confirmed
- **Fix**: 
  - Check email inbox (and spam)
  - Click confirmation link
  - Or disable email confirmation in Supabase

### "Connection error - please check your internet"
- **Cause**: Network issues or Supabase connection problems
- **Fix**: 
  - Check internet connection
  - Verify Supabase project is running
  - Check browser console for errors

### User gets redirected to localhost:3000
- **Cause**: Redirect URLs not properly configured in Supabase
- **Fix**: 
  - Add correct redirect URLs in Supabase dashboard
  - Include your Lovable project URL
  - Include localhost for development

## 📊 Database Structure

### Profiles Table
```sql
id              UUID (primary key, references auth.users)
email           TEXT
first_name      TEXT
last_name       TEXT
company_name    TEXT
role            app_role (default: 'admin')
tenant_id       UUID
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### Automatic Profile Creation
When a user signs up:
1. Auth.users record created by Supabase Auth
2. Trigger `on_auth_user_created` fires
3. Function `handle_new_user()` executes
4. Profile record created in `profiles` table
5. Metadata from signup form populated
6. Default role assigned
7. User can now access the application

## 🎯 Next Steps

1. **Test the System**
   - Try creating a new account
   - Verify profile is created
   - Check you can sign in
   - Confirm redirect to dashboard works

2. **Configure Email Settings** (if needed)
   - Disable email confirmation for testing
   - Or set up SMTP for custom emails
   - Configure email templates

3. **Review User Roles**
   - Default role is 'admin'
   - Can be changed in Supabase dashboard
   - Or programmatically via profile updates

4. **Security Considerations**
   - Re-enable stricter password validation for production
   - Enable email confirmation for production
   - Set up proper rate limiting
   - Review RLS policies

## 🔗 Useful Links

<lov-actions>
  <lov-link url="https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/auth/users">View Users</lov-link>
  <lov-link url="https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/auth/providers">Configure Email Provider</lov-link>
  <lov-link url="https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/database/tables">View Profiles Table</lov-link>
</lov-actions>
