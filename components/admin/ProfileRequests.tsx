'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import {
  getProfileChangeRequests, approveProfileChange, rejectProfileChange,
  bulkApproveProfileChanges, bulkRejectProfileChanges,
} from '@/app/actions/admin'
import { Loader2, Check, X, CheckCheck, XCircle } from 'lucide-react'

type Req = {
  id: string
  user_id: string
  requested_full_name: string | null
  requested_class: string | null
  requested_email: string | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
  reject_reason: string | null
  user?: {
    id: string
    full_name: string | null
    username: string | null
    email: string | null
    class: string | null
  } | { full_name: string | null; username: string | null; email: string | null; class: string | null }[] | null
}

export default function ProfileRequests() {
  const { toast } = useToast()
  const [reqs, setReqs] = useState<Req[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getProfileChangeRequests('pending')
      setReqs(data as Req[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const userOf = (r: Req) => Array.isArray(r.user) ? r.user[0] : r.user

  const handleApprove = async (id: string) => {
    setBusy(id)
    const res = await approveProfileChange(id)
    setBusy(null)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Одобрено' }); load() }
  }

  const handleReject = async (id: string) => {
    const reason = prompt('Причина отказа (опционально)') ?? ''
    setBusy(id)
    const res = await rejectProfileChange(id, reason)
    setBusy(null)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Отклонено' }); load() }
  }

  const toggle = (id: string) => setSelected((p) => {
    const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s
  })
  const toggleAll = () => setSelected(
    selected.size === reqs.length ? new Set() : new Set(reqs.map((r) => r.id))
  )

  const handleBulkApprove = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Одобрить ${ids.length} заявок?`)) return
    const res = await bulkApproveProfileChanges(ids)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Одобрено' }); setSelected(new Set()); load() }
  }
  const handleBulkReject = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Отклонить ${ids.length} заявок?`)) return
    const res = await bulkRejectProfileChanges(ids)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Отклонено' }); setSelected(new Set()); load() }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Заявки на смену профиля</h2>
          <p className="text-muted-foreground text-sm mt-1">
            ФИО, класс, email — изменения вступают в силу только после вашего одобрения.
          </p>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleBulkApprove}>
              <CheckCheck className="w-4 h-4 mr-1" /> Принять ({selected.size})
            </Button>
            <Button size="sm" variant="outline" onClick={handleBulkReject}>
              <XCircle className="w-4 h-4 mr-1" /> Отклонить ({selected.size})
            </Button>
          </div>
        )}
      </div>

      <div className="border rounded-xl bg-card overflow-x-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={reqs.length > 0 && selected.size === reqs.length}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead>Пользователь</TableHead>
              <TableHead>Изменения</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead>Подана</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center h-24">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell></TableRow>
            ) : reqs.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                Заявок нет
              </TableCell></TableRow>
            ) : (
              reqs.map((r) => {
                const u = userOf(r)
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <input
                        type="checkbox" className="w-4 h-4 accent-primary"
                        checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{u?.full_name || u?.username || '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {u?.username} · {u?.class && `${u.class} · `}{u?.email}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm space-y-0.5">
                      {r.requested_full_name && (
                        <div>ФИО: <span className="text-muted-foreground line-through">{u?.full_name || '—'}</span> → <b>{r.requested_full_name}</b></div>
                      )}
                      {r.requested_class && (
                        <div>Класс: <span className="text-muted-foreground line-through">{u?.class || '—'}</span> → <b>{r.requested_class}</b></div>
                      )}
                      {r.requested_email && (
                        <div>Email: <span className="text-muted-foreground line-through">{u?.email || '—'}</span> → <b>{r.requested_email}</b></div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {r.note || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => handleApprove(r.id)} disabled={busy === r.id}>
                        <Check className="w-4 h-4 mr-1 text-green-600" /> Принять
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleReject(r.id)} disabled={busy === r.id}
                      >
                        <X className="w-4 h-4 mr-1" /> Отказ
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
