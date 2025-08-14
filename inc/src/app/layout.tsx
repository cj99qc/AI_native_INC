import type { Metadata } from "next";
// Temporarily disable Google Fonts due to network restrictions
// import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { SupabaseProvider } from '@/providers/SupabaseProvider'
import { CartProvider } from '@/providers/CartProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'

export const metadata: Metadata = {
  title: "InC - AI-Native Logistics Marketplace",
  description: "Premier AI-native, location-first local logistics marketplace for seamless multi-role interactions",
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": "InC Logistics"
  }
};

export const dynamic = 'force-dynamic'

// Temporarily disable Google Fonts due to network restrictions
// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });
// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="antialiased">{/* className={`${geistSans.variable} ${geistMono.variable} antialiased`} */}
        <SupabaseProvider>
          <ToasterProvider>
            <CartProvider>
              <Navbar />
              <main className="min-h-[70vh]">{children}</main>
              <Footer />
            </CartProvider>
          </ToasterProvider>
        </SupabaseProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(registration) {
                      console.log('SW registered: ', registration);
                    })
                    .catch(function(registrationError) {
                      console.log('SW registration failed: ', registrationError);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
