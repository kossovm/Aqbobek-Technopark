'use client'

import { useState, useEffect, useRef } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { login, loginByQR } from '@/app/actions/auth'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Loader2, KeyRound, ScanLine } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Method = 'password' | 'qr'

export default function LoginPage() {
  const { toast } = useToast()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [method, setMethod] = useState<Method>('password')
  const lastScanRef = useRef<{ qr: string; ts: number } | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const handlePasswordSubmit = async (formData: FormData) => {
    setIsLoading(true)
    const result = await login(formData)
    if (result?.error) {
      toast({ title: 'Ошибка входа', description: result.error, variant: 'destructive' })
      setIsLoading(false)
    }
  }

  const handleQRScan = async (text: string) => {
    if (!text || isLoading) return
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.qr === text && now - lastScanRef.current.ts < 1500) return
    lastScanRef.current = { qr: text, ts: now }

    setIsLoading(true)
    try {
      const res = await loginByQR(text.trim())
      if ('error' in res) {
        toast({ title: 'QR не подошёл', description: res.error, variant: 'destructive' })
        return
      }
      // Завершаем вход на клиенте — это поставит cookies через @supabase/ssr.
      const supabase = createClient()
      const { error } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: 'email',
      })
      if (error) {
        toast({ title: 'Ошибка входа', description: error.message, variant: 'destructive' })
        return
      }
      toast({ title: 'Вход выполнен' })
      router.replace('/')
      router.refresh()
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  if (!mounted) return null

  return (
    <div className="flex items-center justify-center min-h-screen hero-glow p-4" suppressHydrationWarning>
      <Card className="w-full max-w-sm shadow-2xl glass border-border/50" suppressHydrationWarning>
        <CardHeader className="space-y-2 text-center pb-4 pt-7">
          <div className="flex justify-center mb-1">
            <Logo size={56} />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Aqbobek Technopark</CardTitle>
          <CardDescription>Управление оборудованием и материалами</CardDescription>
        </CardHeader>

        <div className="px-6">
          <div className="grid grid-cols-2 gap-1 bg-muted/60 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setMethod('password')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                method === 'password' ? 'bg-background shadow' : 'text-muted-foreground'
              }`}
            >
              <KeyRound className="w-4 h-4" /> Пароль
            </button>
            <button
              type="button"
              onClick={() => setMethod('qr')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                method === 'qr' ? 'bg-background shadow' : 'text-muted-foreground'
              }`}
            >
              <ScanLine className="w-4 h-4" /> QR-код
            </button>
          </div>
        </div>

        <CardContent className="pt-4" suppressHydrationWarning>
          {method === 'password' ? (
            <form action={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2 text-left">
                <Label htmlFor="username">Логин</Label>
                <Input
                  id="username" name="username" type="text"
                  autoComplete="username" required placeholder="ivanov_petr"
                  className="h-11" disabled={isLoading}
                  suppressHydrationWarning
                />
              </div>
              <div className="space-y-2 text-left">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password" name="password" type="password"
                  autoComplete="current-password" required
                  className="h-11" disabled={isLoading}
                  suppressHydrationWarning
                />
              </div>
              <Button type="submit" className="w-full h-11 text-base mt-2 rounded-xl shadow-md shadow-primary/20" disabled={isLoading}>
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Войти в систему
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="aspect-square overflow-hidden rounded-xl relative bg-black">
                <Scanner
                  onScan={(result) => {
                    if (result && result.length > 0) handleQRScan(result[0].rawValue)
                  }}
                  onError={(err) => console.error(err)}
                />
                {isLoading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white gap-2">
                    <Logo size={24} spinning /> Вход…
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Покажите камере свой QR из профиля. Если у вас его ещё нет — войдите по паролю и распечатайте на странице «Профиль».
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex-col text-center justify-center pt-0 pb-6 text-sm text-muted-foreground gap-2">
          <Link href="/register" className="text-primary hover:underline">
            Нет аккаунта? Зарегистрироваться
          </Link>
          <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline text-xs">
            Забыли пароль?
          </Link>
          <span className="text-xs">Аккаунты активируются преподавателем.</span>
        </CardFooter>
      </Card>
    </div>
  )
}
