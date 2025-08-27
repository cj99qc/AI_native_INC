# Admin Setup Guide

## Setting Up Admin Access

For security reasons, the admin role is not available through public signup. Only the platform owner and authorized team members should have admin access.

## Manual Admin Setup Process

### Option 1: Database Direct Access (Recommended)

1. **Access your Supabase dashboard** or connect directly to your PostgreSQL database

2. **Update the user's profile** to set admin role:

```sql
-- Replace 'your-user-email@example.com' with your actual email
UPDATE profiles 
SET role = 'admin' 
WHERE id = (
  SELECT id 
  FROM auth.users 
  WHERE email = 'your-user-email@example.com'
);
```

3. **Verify the change**:

```sql
-- Check that the role was updated successfully
SELECT u.email, p.role, p.name 
FROM auth.users u 
JOIN profiles p ON u.id = p.id 
WHERE p.role = 'admin';
```

### Option 2: Supabase Dashboard (If RLS allows)

1. Go to your Supabase project dashboard
2. Navigate to **Table Editor** → **profiles** table  
3. Find your user record (search by email/name)
4. Edit the `role` column and change it to `'admin'`
5. Save the changes

### Option 3: API Endpoint (For Developers)

Create a one-time admin setup endpoint (remove after use):

```typescript
// pages/api/setup-admin.ts (create temporarily, delete after use)
export default async function handler(req, res) {
  // Add strong authentication here - this is just an example
  const { email, adminSecret } = req.body
  
  if (adminSecret !== process.env.ADMIN_SETUP_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = createServerSupabaseClient({ req, res })
  
  // Update user role to admin
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('email', email)
    .select()

  return res.json({ data, error })
}
```

## Verifying Admin Access

After setting up admin access:

1. **Sign up as normal** using customer, vendor, or driver role
2. **Manually update your role** using one of the methods above  
3. **Log out and log back in** to refresh your session
4. You should now have access to `/dashboard/admin` and admin features

## Security Considerations

- **Never expose admin signup publicly** - always use manual setup
- **Limit admin access** to only essential team members
- **Regular audit** of admin users in your database
- **Use strong authentication** for any temporary admin setup endpoints
- **Remove setup scripts** after initial configuration

## Troubleshooting

### "Access Denied" after setting admin role
- Log out completely and log back in to refresh the session
- Check that the `role` field in the database was actually updated
- Verify your RLS (Row Level Security) policies allow admin access

### Database changes not reflecting
- Clear browser cache and cookies
- Check if there are any caching layers affecting the user session
- Verify the database transaction was committed successfully

## Database Schema Reference

The `profiles` table structure for admin users:
```sql
-- Example admin profile record
{
  id: 'user-uuid-here',
  email: 'admin@yourcompany.com', 
  name: 'Your Name',
  role: 'admin',  -- This is the key field
  onboarding_completed: true,
  kyc_status: null,  -- Not applicable for admin
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z'
}
```

## Support

If you need assistance with admin setup, ensure you have:
1. Database access credentials
2. User email that needs admin privileges
3. Confirmation that the user has already signed up as a regular user first

---

**Important**: Keep this documentation secure and remove it from public repositories. Consider storing admin setup instructions in your team's internal documentation system.