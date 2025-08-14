'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

const links = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Search' },
  { href: '/cart', label: 'Cart' },
  { href: '/orders', label: 'Orders' },
  { href: '/vendor/dashboard', label: 'Vendor' },
  { href: '/driver/dashboard', label: 'Driver' },
  { href: '/admin/dashboard', label: 'Admin' },
]

export default function Navbar() {
  const pathname = usePathname()
  return (
    <nav className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-lg">
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            InC
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {links.map(l => (
            <Link key={l.href} href={l.href} className={cn('hover:text-primary transition-colors', pathname === l.href && 'font-semibold text-primary')}>
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
          <Link href="/(auth)/login" className="rounded bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 transition-colors">Login</Link>
        </div>
      </div>
    </nav>
  )
}