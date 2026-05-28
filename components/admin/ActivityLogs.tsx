'use client'

import { useEffect, useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { getLogs } from '@/app/actions/logs'
import { Loader2, RefreshCw } from 'lucide-react'

type Log = {
  id: string
  user_id: string | null
  user_name: string
  action: string
  entity_type: string | null
  entity_id: string | null
  details: any
  created_at: string
}

const ACTIONS: { value: string; label: string; color: string }[] = [
  { value: '',                 label: 'Все действия',       color: 'bg-muted' },
  { value: 'login',            label: 'Вход',               color: 'bg-blue-100 text-blue-700' },
  { value: 'logout',           label: 'Выход',              color: 'bg-slate-100 text-slate-700' },
  { value: 'scan',             label: 'Скан QR',            color: 'bg-purple-100 text-purple-700' },
  { value: 'scan_unknown',     label: 'Скан (неизвестно)',  color: 'bg-orange-100 text-orange-700' },
  { value: 'checkout',         label: 'Взял',               color: 'bg-amber-100 text-amber-700' },
  { value: 'return',           label: 'Вернул',             color: 'bg-green-100 text-green-700' },
  { value: 'consumable_use',   label: 'Списание',           color: 'bg-pink-100 text-pink-700' },
  { value: 'inventory_create', label: 'Добавлен инвентарь', color: 'bg-teal-100 text-teal-700' },
  { value: 'inventory_delete', label: 'Удалён инвентарь',   color: 'bg-red-100 text-red-700' },
]

const actionMeta = (action: string) =>
  ACTIONS.find((a) => a.value === action) ?? { label: action, color: 'bg-muted' }

export default function ActivityLogs() {
  const { toast } = useToast()
  const [logs, setLogs] = useState<Log[]>([])
  const [filter, setFilter] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getLogs({ action: filter || null, limit: 300 })
      setLogs(data as Log[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Журнал событий</h2>
          <p className="text-muted-foreground text-sm mt-1">Последние 300 записей. Кто что делал — здесь.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Фильтр" /></SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a.value || '__all__'} value={a.value || '__all__'}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} disabled={isLoading} title="Обновить">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-x-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Время</TableHead>
              <TableHead>Кто</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Объект</TableHead>
              <TableHead>Подробности</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Записей нет</TableCell></TableRow>
            ) : (
              logs.map((log) => {
                const meta = actionMeta(log.action)
                const d = new Date(log.created_at)
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                      {d.toLocaleDateString('ru-RU')} {d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-sm">{log.user_name}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${meta.color}`}>
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.entity_type || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {log.details ? Object.entries(log.details).map(([k, v]) => `${k}: ${String(v)}`).join(', ') : '—'}
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
