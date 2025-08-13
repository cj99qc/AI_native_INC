import { NextResponse } from 'next/server'

export function middleware() {
  return NextResponse.next()
}

export const config = {
  matcher: ['/vendor/:path*', '/driver/:path*', '/admin/:path*'],
}