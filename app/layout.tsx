import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import Navigation from "@/components/Navigation"
import { ThemeProvider } from "@/components/ThemeProvider"
import { createClient } from "@/utils/supabase/server"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

export const metadata: Metadata = {
  title: "Aqbobek Technopark",
  description: "Система управления инвентарем и проектами",
  icons: { icon: '/logo.png' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)',  color: '#0d1117' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let role: string | null = null
  let isApproved = false

  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('role, is_approved')
      .eq('id', user.id)
      .maybeSingle()

    if (profile) {
      role = profile.role
      isApproved = !!profile.is_approved
    }
  }

  const showNav = !!user && isApproved && role !== null

  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${inter.className} pb-24 md:pb-0 min-h-screen bg-background selection:bg-primary/20`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          {showNav && <Navigation role={role!} />}
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
