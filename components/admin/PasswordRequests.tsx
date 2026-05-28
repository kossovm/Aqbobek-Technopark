'use client'

import { useEffect, useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  getPasswordChangeRequests,
  approvePasswordChange,
  rejectPasswordChange,
  bulkApprovePasswordChanges,
  bulkRejectPasswordChanges,
} from '@/app/actions/admin'
import {
  Loader2, Check, X, Eye, EyeOff, CheckCheck, XCircle,
} from 'lucide-react'

type Request = {
  id: string
  user_id: string | null
  username: string
  full_name: string
  type: string
  status: string
  note: string | null
  created_at: string
  reviewed_at: string | null
}

type Visibility = Record<string, boolean>

export default function PasswordRequests() {
  const { toast } = useToast()
  const [requests, setRequests] = useState<Request[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [visible, setVisible] = useState<Visibility>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [isBulkBusy, setIsBulkBusy] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getPasswordChangeRequests(showAll ? 'all' : 'pending')
      setRequests(data as Request[])
      setSelected(new Set())
    } catch (e: any) {
      toast({ title: 'Ошибка загрузки', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, [showAll])

  const setIdBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => { const s = new Set(prev); busy ? s.add(id) : s.delete(id); return s })

  const handleApprove = async (id: string) => {
    setIdBusy(id, true)
    const res = await approvePasswordChange(id)
    setIdBusy(id, false)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Пароль применён' }); load() }
  }

  const handleReject = async (id: string) => {
    setIdBusy(id, true)
    const res = await rejectPasswordChange(id)
    setIdBusy(id, false)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Заявка отклонена' }); load() }
  }

  const handleBulkApprove = async () => {
    if (selected.size === 0) return
    setIsBulkBusy(true)
    const ids = Array.from(selected)
    const res = await bulkApprovePasswordChanges(ids)
    setIsBulkBusy(false)
    if (res.error) toast({ title: 'Частичная ошибка', description: res.error, variant: 'destructive' })
    else toast({ title: `Одобрено ${ids.length} заявок` })
    load()
  }

  const handleBulkReject = async () => {
    if (selected.size === 0) return
    setIsBulkBusy(true)
    const ids = Array.from(selected)
    const res = await bulkRejectPasswordChanges(ids)
    setIsBulkBusy(false)
    if (res.error) toast({ title: 'Частичная ошибка', description: res.error, variant: 'destructive' })
    else toast({ title: `Отклонено ${ids.length} заявок` })
    load()
  }

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const toggleAll = () =>
    setSelected(
      selected.size === pendingRows.length && pendingRows.length > 0
        ? new Set()
        : new Set(pendingRows.map((r) => r.id))
    )

  const toggleVisible = (id: string) =>
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }))

  const pendingRows = requests.filter((r) => r.status === 'pending')

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Заявки на смену пароля</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Одобрите — и новый пароль сразу применится. Отклоните — старый останется.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && !isBulkBusy && (
            <>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={handleBulkApprove}
              >
                <CheckCheck className="w-4 h-4 mr-1" />
                Одобрить выбранные ({selected.size})
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBulkReject}>
                <XCircle className="w-4 h-4 mr-1" />
                Отклонить выбранные
              </Button>
            </>
          )}
          {isBulkBusy && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Только ожидающие' : 'Показать все'}
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={isLoading}>
            Обновить
          </Button>
        </div>
      </div>

      <div className="border rounded-xl shadow-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={pendingRows.length > 0 && selected.size === pendingRows.length}
                  onChange={toggleAll}
                  title="Выбрать все ожидающие"
                />
              </TableHead>
              <TableHead>Пользователь</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Новый пароль</TableHead>
              <TableHead>Примечание</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                  {showAll ? 'Нет заявок' : 'Нет ожидающих заявок'}
                </TableCell>
              </TableRow>
            ) : (
              requests.map((req) => {
                const isPending = req.status === 'pending'
                const isBusy = busyIds.has(req.id)
                const isChecked = selected.has(req.id)
                return (
                  <TableRow
                    key={req.id}
                    className={
                      req.status === 'approved'
                        ? 'bg-green-50/30'
                        : req.status === 'rejected'
                        ? 'bg-red-50/30'
                        : ''
                    }
                  >
                    <TableCell>
                      {isPending && (
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-primary"
                          checked={isChecked}
                          onChange={() => toggleSelect(req.id)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{req.full_name || req.username}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {req.username}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        req.type === 'reset'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {req.type === 'reset' ? 'Сброс' : 'Смена'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm">
                          {visible[req.id] ? '(скрыт после одобрения)' : '••••••••'}
                        </span>
                        <button
                          onClick={() => toggleVisible(req.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {visible[req.id]
                            ? <EyeOff className="w-4 h-4" />
                            : <Eye className="w-4 h-4" />
                          }
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                      {req.note || '—'}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString('ru-RU')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={req.status} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isPending && (
                        <>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 mr-2"
                            disabled={isBusy}
                            onClick={() => handleApprove(req.id)}
                          >
                            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                            Одобрить
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={isBusy}
                            onClick={() => handleReject(req.id)}
                          >
                            <X className="w-4 h-4 mr-1" /> Отклонить
                          </Button>
                        </>
                      )}
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:  { label: 'Ожидает',   cls: 'bg-yellow-100 text-yellow-700' },
    approved: { label: 'Одобрено',  cls: 'bg-green-100 text-green-700' },
    rejected: { label: 'Отклонено', cls: 'bg-red-100 text-red-700' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-muted' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls}`}>
      {label}
    </span>
  )
}
