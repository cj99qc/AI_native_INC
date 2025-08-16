'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VoiceButton } from '@/components/ui/VoiceButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  Search, 
  User, 
  LogOut, 
  Settings,
  Bell,
  Package
} from 'lucide-react'

export default function Navbar() {
  const pathname = usePathname()
  const { user, loading, signOut, isCustomer, isVendor, isDriver, isAdmin } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (query: string) => {
    if (query.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(query.trim())}`
    }
  }

  const handleVoiceSearch = (transcript: string) => {
    setSearchQuery(transcript)
    handleSearch(transcript)
  }

  const getNavLinks = () => {
    const links = [{ href: '/', label: 'Home' }]
    
    if (user) {
      if (isCustomer || isAdmin) {
        links.push(
          { href: '/cart', label: 'Cart' },
          { href: '/orders', label: 'Orders' }
        )
      }
      
      if (isVendor || isAdmin) {
        links.push({ href: '/dashboard/vendor', label: 'Vendor' })
      }
      
      if (isDriver || isAdmin) {
        links.push({ href: '/dashboard/driver', label: 'Driver' })
      }
      
      if (isAdmin) {
        links.push({ href: '/dashboard/admin', label: 'Admin' })
      }
    }
    
    return links
  }

  if (loading) {
    return (
      <nav className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="h-6 w-12 animate-pulse bg-gray-200 rounded"></div>
          <div className="h-6 w-48 animate-pulse bg-gray-200 rounded"></div>
        </div>
      </nav>
    )
  }

  return (
    <nav className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 gap-4">
        {/* Logo */}
        <Link href="/" className="font-semibold text-lg flex-shrink-0">
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            InC
          </span>
        </Link>

        {/* Search Bar - Full width on larger screens, hidden on mobile */}
        <div className="hidden md:flex flex-1 max-w-2xl mx-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              type="text"
              placeholder="Search products, businesses, services..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(searchQuery)
                }
              }}
              className="pl-10 pr-12 h-10"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
              <VoiceButton onTranscript={handleVoiceSearch} />
            </div>
          </div>
        </div>

        {/* Navigation Links & Actions */}
        <div className="flex items-center gap-2 md:gap-4 text-sm">
          {/* Navigation Links */}
          <div className="hidden lg:flex items-center gap-4">
            {getNavLinks().map(link => (
              <Link 
                key={link.href} 
                href={link.href} 
                className={cn(
                  'hover:text-primary transition-colors', 
                  pathname === link.href && 'font-semibold text-primary'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Search icon for mobile */}
          <Link href="/search" className="md:hidden">
            <Button variant="ghost" size="sm">
              <Search className="h-4 w-4" />
            </Button>
          </Link>

          {/* Notifications (if authenticated) */}
          {user && (
            <Button variant="ghost" size="sm">
              <Bell className="h-4 w-4" />
            </Button>
          )}

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Auth Section */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <User className="h-4 w-4" />
                  <span className="hidden sm:block">
                    {user.profile?.name || user.email.split('@')[0]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <Settings className="mr-2 h-4 w-4" />
                    Profile & Settings
                  </Link>
                </DropdownMenuItem>
                {user.role !== 'customer' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/${user.role}`}>
                        <Package className="mr-2 h-4 w-4" />
                        {user.role === 'vendor' ? 'Business' : user.role === 'driver' ? 'Driver' : user.role === 'admin' ? 'Admin' : 'Customer'} Dashboard
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/(auth)/login">
                <Button variant="ghost" size="sm">
                  Login
                </Button>
              </Link>
              <Link href="/(auth)/signup">
                <Button size="sm" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                  Sign Up
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}