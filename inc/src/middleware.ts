import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Validate environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Middleware] Missing Supabase environment variables')
    // Return early if environment is not configured
    return res
  }

  // Create a Supabase client configured to use cookies
  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // Set the cookie on both the request and response
          req.cookies.set({ name, value, ...options })
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          // Remove the cookie from both the request and response
          req.cookies.set({ name, value: '', ...options })
          res.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // Refresh session if expired - required for Server Components
  // This will also handle cookie refreshing automatically
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    console.error('Middleware session error:', sessionError)
  }

  // Get user profile to check role
  let userRole = null
  if (session?.user) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()
      
      if (profileError) {
        console.error('Middleware profile fetch error:', profileError)
      } else {
        userRole = profile?.role
      }
    } catch (error) {
      console.error('Middleware profile query error:', error)
    }
  }

  const { pathname } = req.nextUrl

  console.log(`[Middleware] ${pathname} - Session: ${session ? 'EXISTS' : 'NONE'} - Role: ${userRole || 'NONE'}`)

  // Redirect to login if accessing protected routes without auth
  if (!session && (
    pathname.startsWith('/vendor') ||
    pathname.startsWith('/driver') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/cart') ||
    pathname.startsWith('/orders') ||
    pathname.startsWith('/checkout')
  )) {
    const redirectUrl = new URL('/login', req.url)
    redirectUrl.searchParams.set('redirect', pathname)
    console.log(`[Middleware] Redirecting to login: ${redirectUrl.toString()}`)
    return NextResponse.redirect(redirectUrl)
  }

  // Role-based route protection
  if (session && userRole) {
    // Admin routes - only admins
    if ((pathname.startsWith('/admin') || pathname.startsWith('/dashboard/admin')) && userRole !== 'admin') {
      console.log(`[Middleware] Access denied to admin route for role: ${userRole}`)
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Vendor routes - only vendors and admins
    if ((pathname.startsWith('/vendor') || pathname.startsWith('/dashboard/vendor')) && !['vendor', 'admin'].includes(userRole)) {
      console.log(`[Middleware] Access denied to vendor route for role: ${userRole}`)
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Driver routes - only drivers and admins  
    if ((pathname.startsWith('/driver') || pathname.startsWith('/dashboard/driver')) && !['driver', 'admin'].includes(userRole)) {
      console.log(`[Middleware] Access denied to driver route for role: ${userRole}`)
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Customer dashboard - only customers and admins
    if (pathname.startsWith('/dashboard/customer') && !['customer', 'admin'].includes(userRole)) {
      console.log(`[Middleware] Access denied to customer route for role: ${userRole}`)
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // Redirect authenticated users away from auth pages
  if (session && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    // Get redirect parameter if exists
    const redirectTo = req.nextUrl.searchParams.get('redirect')
    
    if (redirectTo) {
      console.log(`[Middleware] Redirecting authenticated user to: ${redirectTo}`)
      return NextResponse.redirect(new URL(redirectTo, req.url))
    }

    // Role-based default redirects as per requirements
    switch (userRole) {
      case 'customer':
        console.log(`[Middleware] Redirecting customer to dashboard`)
        return NextResponse.redirect(new URL('/dashboard/customer', req.url))
      case 'vendor':
        console.log(`[Middleware] Redirecting vendor to dashboard`)
        return NextResponse.redirect(new URL('/dashboard/vendor', req.url))
      case 'driver':
        console.log(`[Middleware] Redirecting driver to dashboard`)
        return NextResponse.redirect(new URL('/dashboard/driver', req.url))
      case 'admin':
        console.log(`[Middleware] Redirecting admin to dashboard`)
        return NextResponse.redirect(new URL('/dashboard/admin', req.url))
      default:
        console.log(`[Middleware] Redirecting user with unknown role to customer dashboard`)
        return NextResponse.redirect(new URL('/dashboard/customer', req.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}