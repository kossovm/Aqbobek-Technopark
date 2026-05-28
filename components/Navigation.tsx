'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, QrCode, Package, Settings, LogOut,
  FolderKanban, User as UserIcon,
} from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function Navigation({ role }: { role: string }) {
  const pathname = usePathname()

  const HIDDEN_ON = ['/login', '/register', '/rules', '/forgot-password']
  if (HIDDEN_ON.includes(pathname)) return null

  const links = [
    { href: '/',             icon: Home,         label: 'Главная'  },
    { href: '/my-projects',  icon: FolderKanban, label: 'Проекты'  },
    { href: '/consumables',  icon: Package,      label: 'Списание' },
    { href: '/profile',      icon: UserIcon,     label: 'Профиль'  },
  ]

  if (role === 'admin' || role === 'teacher') {
    links.push({ href: '/admin', icon: Settings, label: 'Админка' })
  }

  return (
    <>
      {/* ── Topbar (Desktop) ──────────────────────────────────────────── */}
      <nav className="hidden md:flex sticky top-0 z-50 items-center justify-between px-6 py-2.5 border-b bg-background/80 backdrop-blur-md shadow-sm">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="На главную">
          <Logo size={34} withText textClass="text-xl" />
        </Link>

        <div className="flex items-center gap-5">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm font-medium transition-colors hover:text-primary relative py-1 ${
                pathname === l.href
                  ? 'text-primary after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-primary after:rounded-full'
                  : 'text-muted-foreground'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/scanner">
            <Button
              variant="default"
              size="sm"
              className="gap-2 rounded-full px-5 shadow-md shadow-primary/20 bg-primary hover:bg-primary/90"
            >
              <QrCode className="w-4 h-4" /> Сканер
            </Button>
          </Link>
          <div className="h-5 w-px bg-border" />
          <ThemeToggle />
          <form action={logout}>
            <Button
              variant="ghost"
              size="icon"
              title="Выйти"
              className="text-muted-foreground hover:text-red-500 rounded-full"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </nav>

      {/* ── Bottom bar (Mobile) ────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur-md flex items-center justify-between px-1 pb-5 pt-2 z-50 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        {links.map((l) => {
          const Icon = l.icon
          const isActive = pathname === l.href
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-primary/10' : ''}`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[9px] font-semibold tracking-wide uppercase">{l.label}</span>
            </Link>
          )
        })}

        {/* Floating Scanner Button */}
        <div className="relative -top-5 px-1">
          <Link
            href="/scanner"
            className="bg-primary text-white p-3.5 rounded-full shadow-xl shadow-primary/40 flex items-center justify-center active:scale-95 transition-transform border-[4px] border-background"
          >
            <QrCode className="w-6 h-6" />
          </Link>
        </div>

        <form action={logout} className="flex-1 flex flex-col items-center justify-center">
          <button
            type="submit"
            className="w-full flex flex-col items-center py-1 gap-0.5 text-muted-foreground hover:text-red-500 transition-colors"
          >
            <div className="p-1.5 rounded-xl">
              <LogOut className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold tracking-wide uppercase">Выход</span>
          </button>
        </form>
      </nav>
    </>
  )
}
