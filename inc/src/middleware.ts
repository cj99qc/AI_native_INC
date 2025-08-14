import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  // Refresh session if expired - required for Server Components
  const { data: { session } } = await supabase.auth.getSession()

  // Get user profile to check role
  let userRole = null
  if (session?.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
    userRole = profile?.role
  }

  const { pathname } = req.nextUrl

  // Redirect to login if accessing protected routes without auth
  if (!session && (
    pathname.startsWith('/vendor') ||
    pathname.startsWith('/driver') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/cart') ||
    pathname.startsWith('/orders') ||
    pathname.startsWith('/checkout')
  )) {
    const redirectUrl = new URL('/(auth)/login', req.url)
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Role-based route protection
  if (session && userRole) {
    // Admin routes - only admins
    if (pathname.startsWith('/admin') && userRole !== 'admin') {
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Vendor routes - only vendors and admins
    if (pathname.startsWith('/vendor') && !['vendor', 'admin'].includes(userRole)) {
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Driver routes - only drivers and admins  
    if (pathname.startsWith('/driver') && !['driver', 'admin'].includes(userRole)) {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // Redirect authenticated users away from auth pages
  if (session && (pathname.startsWith('/(auth)/login') || pathname.startsWith('/(auth)/signup'))) {
    // Get redirect parameter if exists
    const redirectTo = req.nextUrl.searchParams.get('redirect')
    
    if (redirectTo) {
      return NextResponse.redirect(new URL(redirectTo, req.url))
    }

    // Role-based default redirects
    switch (userRole) {
      case 'vendor':
        return NextResponse.redirect(new URL('/vendor/dashboard', req.url))
      case 'driver':
        return NextResponse.redirect(new URL('/driver/dashboard', req.url))
      case 'admin':
        return NextResponse.redirect(new URL('/admin/dashboard', req.url))
      default:
        return NextResponse.redirect(new URL('/', req.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}