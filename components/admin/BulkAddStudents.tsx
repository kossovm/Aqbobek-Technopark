'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { bulkCreateStudents, type NewStudentInput, type CreateResult } from '@/app/actions/admin-create'
import {
  Plus,
  Trash2,
  Loader2,
  Save,
  Wand2,
  CheckCircle2,
  XCircle,
  Copy,
} from 'lucide-react'

type Role = 'student' | 'teacher' | 'admin'

type Row = {
  id: string
  username: string
  fullName: string
  password: string
  email: string
  role: Role
  status?: 'ok' | 'error'
  errorMsg?: string
}

function makeRow(): Row {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `r_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    username: '',
    fullName: '',
    password: '',
    email: '',
    role: 'student',
  }
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export default function BulkAddStudents({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[]>([makeRow()])
  const [isSaving, setIsSaving] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<
    { username: string; password: string }[] | null
  >(null)

  const filledCount = useMemo(
    () => rows.filter((r) => r.username || r.fullName || r.password || r.email).length,
    [rows]
  )

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, status: undefined, errorMsg: undefined } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, makeRow()])
  const removeRow = (id: string) => setRows((prev) => (prev.length <= 1 ? [makeRow()] : prev.filter((r) => r.id !== id)))
  const fillRandomPassword = (id: string) => updateRow(id, { password: randomPassword() })

  const onSubmit = async () => {
    const payload: NewStudentInput[] = rows
      .filter((r) => r.username || r.fullName || r.password)
      .map((r) => ({
        username: r.username.trim(),
        fullName: r.fullName.trim(),
        password: r.password,
        email: r.email.trim() || null,
        role: r.role,
      }))

    if (payload.length === 0) {
      toast({ title: 'Пусто', description: 'Заполните хотя бы одну строчку', variant: 'destructive' })
      return
    }

    setIsSaving(true)
    setCreatedCreds(null)

    const res = await bulkCreateStudents(payload)

    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      setIsSaving(false)
      return
    }

    const results = res.results || []
    const byUsername = new Map<string, CreateResult>()
    results.forEach((r) => byUsername.set(r.username, r))

    const okCount = results.filter((r) => r.status === 'ok').length
    const errCount = results.filter((r) => r.status === 'error').length

    setRows((prev) =>
      prev.map((r) => {
        const out = byUsername.get(r.username.trim().toLowerCase())
        if (!out) return r
        return {
          ...r,
          status: out.status,
          errorMsg: out.error,
        }
      })
    )

    if (okCount > 0) {
      const okPayload = payload
        .filter((p) => byUsername.get(p.username.toLowerCase())?.status === 'ok')
        .map((p) => ({ username: p.username, password: p.password }))
      setCreatedCreds(okPayload)
    }

    toast({
      title: errCount === 0 ? 'Готово' : 'Готово с ошибками',
      description: `Создано: ${okCount}. Ошибок: ${errCount}.`,
      variant: errCount === 0 ? 'default' : 'destructive',
    })

    setIsSaving(false)
  }

  const clearOk = () => {
    setRows((prev) => {
      const remaining = prev.filter((r) => r.status !== 'ok')
      return remaining.length > 0 ? remaining : [makeRow()]
    })
    setCreatedCreds(null)
  }

  const copyCreds = async () => {
    if (!createdCreds || createdCreds.length === 0) return
    const text = createdCreds.map((c) => `${c.username}\t${c.password}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Скопировано', description: 'Логины и пароли в буфере обмена' })
    } catch {
      toast({
        title: 'Не удалось скопировать',
        description: 'Скопируйте вручную из списка ниже',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Массовое добавление учеников</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Добавляйте строки и заполняйте поля. После сохранения аккаунты сразу активны (
            <code>is_approved = true</code>).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={addRow} disabled={isSaving}>
            <Plus className="w-4 h-4 mr-2" /> Новая строка
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || filledCount === 0}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Сохранить всех
          </Button>
        </div>
      </div>

      <div className="border rounded-xl shadow-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="min-w-[180px]">ФИО *</TableHead>
              <TableHead className="min-w-[160px]">Логин *</TableHead>
              <TableHead className="min-w-[180px]">Пароль *</TableHead>
              <TableHead className="min-w-[180px]">Email <span className="text-muted-foreground text-[10px] uppercase">опц.</span></TableHead>
              <TableHead className="min-w-[140px]">Роль</TableHead>
              <TableHead className="w-[140px]">Статус</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={row.id} className={row.status === 'error' ? 'bg-red-50/40' : row.status === 'ok' ? 'bg-green-50/40' : ''}>
                <TableCell>
                  <Input
                    value={row.fullName}
                    onChange={(e) => updateRow(row.id, { fullName: e.target.value })}
                    placeholder="Иванов Иван"
                    disabled={isSaving || row.status === 'ok'}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.username}
                    onChange={(e) => updateRow(row.id, { username: e.target.value })}
                    placeholder="ivanov_petr"
                    pattern="^[A-Za-z0-9_.\-]{3,32}$"
                    autoComplete="off"
                    disabled={isSaving || row.status === 'ok'}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1.5">
                    <Input
                      value={row.password}
                      onChange={(e) => updateRow(row.id, { password: e.target.value })}
                      placeholder="мин. 6 символов"
                      type="text"
                      autoComplete="off"
                      disabled={isSaving || row.status === 'ok'}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Сгенерировать пароль"
                      onClick={() => fillRandomPassword(row.id)}
                      disabled={isSaving || row.status === 'ok'}
                    >
                      <Wand2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    value={row.email}
                    onChange={(e) => updateRow(row.id, { email: e.target.value })}
                    type="email"
                    placeholder="—"
                    disabled={isSaving || row.status === 'ok'}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={row.role}
                    onValueChange={(v) => updateRow(row.id, { role: v as Role })}
                    disabled={!isAdmin || isSaving || row.status === 'ok'}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">Ученик</SelectItem>
                      <SelectItem value="teacher" disabled={!isAdmin}>Учитель</SelectItem>
                      <SelectItem value="admin" disabled={!isAdmin}>Админ</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {row.status === 'ok' ? (
                    <span className="text-green-700 inline-flex items-center gap-1 text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4" /> Создан
                    </span>
                  ) : row.status === 'error' ? (
                    <span className="text-red-700 inline-flex items-center gap-1 text-xs font-semibold" title={row.errorMsg}>
                      <XCircle className="w-4 h-4" /> {row.errorMsg || 'Ошибка'}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">№ {idx + 1}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => removeRow(row.id)}
                    disabled={isSaving}
                    title="Удалить строку"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {createdCreds && createdCreds.length > 0 && (
        <div className="border rounded-xl bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Созданные аккаунты ({createdCreds.length})</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Сохраните или раздайте ученикам. Пароли больше нигде не показываются.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyCreds}>
                <Copy className="w-4 h-4 mr-2" /> Скопировать
              </Button>
              <Button variant="ghost" size="sm" onClick={clearOk}>
                Убрать готовые строки
              </Button>
            </div>
          </div>
          <pre className="font-mono text-xs bg-muted/40 rounded-lg p-3 max-h-64 overflow-auto">
{createdCreds.map((c) => `${c.username}\t${c.password}`).join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}
