'use client'

import { useState, useEffect } from 'react'
import { requestPasswordChange, requestPasswordReset } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function ForgotPasswordPage() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [mounted, setMounted] = useState(false)
  // null = checking, string = logged-in username, false = not logged in
  const [loggedInUsername, setLoggedInUsername] = useState<string | false | null>(null)

  useEffect(() => {
    setMounted(true)
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoggedInUsername(false); return }
      const { data } = await supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .maybeSingle()
      setLoggedInUsername(data?.username ?? false)
    })
  }, [])

  const handleSubmit = async (formData: FormData) => {
    setIsLoading(true)

    let result: { error?: string; success?: boolean }
    if (loggedInUsername) {
      // Авторизованный — смена пароля
      result = await requestPasswordChange(formData)
    } else {
      // Неавторизованный — сброс по логину
      result = await requestPasswordReset(formData)
    }

    if (result?.error) {
      toast({ title: 'Ошибка', description: result.error, variant: 'destructive' })
      setIsLoading(false)
      return
    }

    setIsDone(true)
    setIsLoading(false)
  }

  if (!mounted || loggedInUsername === null) return null

  if (isDone) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4">
        <Card className="w-full max-w-sm shadow-xl border-none text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Заявка отправлена</h2>
            <p className="text-muted-foreground text-sm">
              Администратор рассмотрит вашу заявку. Пока действует старый пароль.
            </p>
            <Link href="/login" className="text-primary hover:underline text-sm">
              Вернуться на страницу входа
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4">
      <Card className="w-full max-w-sm shadow-xl border-none">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-2xl font-bold tracking-tight">Смена пароля</CardTitle>
          <CardDescription>
            {loggedInUsername
              ? `Вы вошли как ${loggedInUsername}. Введите новый пароль — после одобрения администратором он будет применён.`
              : 'Введите ваш логин и желаемый новый пароль. Администратор рассмотрит заявку.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form action={handleSubmit} className="space-y-4">
            {/* Логин — только для незалогиненных */}
            {!loggedInUsername && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Логин</Label>
                <Input
                  id="username" name="username" required
                  placeholder="ivanov_petr"
                  autoComplete="username"
                  className="h-11" disabled={isLoading}
                />
              </div>
            )}

            {/* Новый пароль */}
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">Новый пароль</Label>
              <Input
                id="newPassword" name="newPassword"
                type="password" required minLength={6}
                autoComplete="new-password"
                className="h-11" disabled={isLoading}
              />
            </div>

            {/* Примечание */}
            <div className="space-y-1.5">
              <Label htmlFor="note">
                Примечание для администратора
                <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  необязательно
                </span>
              </Label>
              <Input
                id="note" name="note"
                placeholder="Причина смены пароля"
                className="h-11" disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full h-11 text-base" disabled={isLoading}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              Отправить заявку
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center pt-2 pb-6">
          <Link href="/login" className="text-primary hover:underline text-sm">
            Вернуться на страницу входа
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
