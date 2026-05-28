'use client'

import { useState, useEffect } from 'react'
import { signUp } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'

export default function RegisterPage() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [requestedRole, setRequestedRole] = useState('student')

  useEffect(() => { setMounted(true) }, [])

  const handleSubmit = async (formData: FormData) => {
    formData.set('requested_role', requestedRole)
    setIsLoading(true)
    const result = await signUp(formData)

    if (result?.error) {
      toast({ title: 'Ошибка регистрации', description: result.error, variant: 'destructive' })
      setIsLoading(false)
      return
    }

    toast({
      title: 'Готово',
      description: 'Аккаунт создан. Дождитесь подтверждения администратором.',
    })
    setIsDone(true)
    setTimeout(() => { window.location.href = '/login' }, 2500)
  }

  if (!mounted) return null

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4" suppressHydrationWarning>
      <Card className="w-full max-w-sm shadow-xl border-none" suppressHydrationWarning>
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-2">
            <span className="text-primary font-bold text-xl">R</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Регистрация</CardTitle>
          <CardDescription>Создайте аккаунт в системе</CardDescription>
        </CardHeader>

        <CardContent suppressHydrationWarning>
          <form action={handleSubmit} className="space-y-4" suppressHydrationWarning>
            {/* ФИО */}
            <div className="space-y-1.5">
              <Label htmlFor="fullName">ФИО <span className="text-red-500">*</span></Label>
              <Input
                id="fullName" name="fullName" required
                placeholder="Иванов Иван"
                className="h-11" disabled={isLoading || isDone}
                suppressHydrationWarning
              />
            </div>

            {/* Логин */}
            <div className="space-y-1.5">
              <Label htmlFor="username">Логин <span className="text-red-500">*</span></Label>
              <Input
                id="username" name="username" required
                placeholder="ivanov_petr"
                pattern="^[A-Za-z0-9_.\-]{3,32}$"
                title="3–32 символа: латиница, цифры и _ . -"
                autoComplete="username"
                className="h-11" disabled={isLoading || isDone}
                suppressHydrationWarning
              />
              <p className="text-[11px] text-muted-foreground">
                3–32 символа: латиница, цифры, <code>_ . -</code>
              </p>
            </div>

            {/* Кто вы */}
            <div className="space-y-1.5">
              <Label>Кто вы? <span className="text-red-500">*</span></Label>
              <Select
                value={requestedRole}
                onValueChange={setRequestedRole}
                disabled={isLoading || isDone}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Ученик</SelectItem>
                  <SelectItem value="teacher">Учитель</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Класс — показываем только для учеников */}
            {requestedRole === 'student' && (
              <div className="space-y-1.5">
                <Label htmlFor="class">
                  Класс
                  <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    необязательно
                  </span>
                </Label>
                <Input
                  id="class" name="class"
                  placeholder="10А"
                  className="h-11" disabled={isLoading || isDone}
                  suppressHydrationWarning
                />
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email
                <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  необязательно
                </span>
              </Label>
              <Input
                id="email" name="email" type="email"
                placeholder="name@example.kz"
                className="h-11" disabled={isLoading || isDone}
                suppressHydrationWarning
              />
              <p className="text-[11px] text-muted-foreground">
                Укажите, если хотите получить возможность восстановления пароля.
              </p>
            </div>

            {/* Пароль */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль <span className="text-red-500">*</span></Label>
              <Input
                id="password" name="password" type="password"
                required minLength={6}
                autoComplete="new-password"
                className="h-11" disabled={isLoading || isDone}
                suppressHydrationWarning
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base mt-2"
              disabled={isLoading || isDone}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              {isDone ? 'Готово, перенаправляем…' : 'Зарегистрироваться'}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex-col text-center justify-center pt-2 pb-6 text-sm text-muted-foreground gap-2">
          <span>После регистрации потребуется подтверждение администратора.</span>
          <Link href="/login" className="text-primary hover:underline">
            Уже есть аккаунт? Войти
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
