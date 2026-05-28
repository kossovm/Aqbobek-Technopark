'use client'

import { useEffect, useState } from 'react'
import {
  getAllScheduleEvents, createScheduleEvent, updateScheduleEvent, deleteScheduleEvent,
  type ScheduleEvent, type DayOfWeek, DAY_NAMES,
} from '@/app/actions/schedule'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { LogoSpinner } from '@/components/Logo'
import { Plus, Trash2, Pencil, Save, Clock, Users, CalendarDays } from 'lucide-react'

const DAYS = Object.entries(DAY_NAMES) as [string, string][]

const emptyForm = () => ({
  title: '',
  description: '',
  class_group: '',
  day_of_week: '1' as string,
  time_start: '',
  time_end: '',
})

export default function ScheduleManagement() {
  const { toast } = useToast()
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [form, setForm] = useState(emptyForm())
  const [editId, setEditId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getAllScheduleEvents()
      setEvents(data)
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    }
    setIsLoading(false)
  }
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  const openEdit = (ev: ScheduleEvent) => {
    setEditId(ev.id)
    setForm({
      title: ev.title,
      description: ev.description ?? '',
      class_group: ev.class_group ?? '',
      day_of_week: String(ev.day_of_week),
      time_start: ev.time_start,
      time_end: ev.time_end ?? '',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.time_start) {
      toast({ title: 'Заполните название и время', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    if (editId) {
      const res = await updateScheduleEvent(editId, {
        title: form.title,
        description: form.description || null,
        class_group: form.class_group || null,
        day_of_week: Number(form.day_of_week) as DayOfWeek,
        time_start: form.time_start,
        time_end: form.time_end || null,
      })
      setIsSaving(false)
      if (res.error) { toast({ title: 'Ошибка', description: res.error, variant: 'destructive' }); return }
      toast({ title: 'Сохранено' })
    } else {
      const res = await createScheduleEvent({
        title: form.title,
        description: form.description || null,
        class_group: form.class_group || null,
        day_of_week: Number(form.day_of_week) as DayOfWeek,
        time_start: form.time_start,
        time_end: form.time_end || null,
      })
      setIsSaving(false)
      if ('error' in res && res.error) { toast({ title: 'Ошибка', description: res.error, variant: 'destructive' }); return }
      toast({ title: 'Создано' })
    }
    setDialogOpen(false)
    load()
  }

  const handleDelete = async (ev: ScheduleEvent) => {
    if (!confirm(`Удалить «${ev.title}»?`)) return
    const res = await deleteScheduleEvent(ev.id)
    if (res.error) { toast({ title: 'Ошибка', description: res.error, variant: 'destructive' }); return }
    toast({ title: 'Удалено' })
    load()
  }

  const grouped = events.reduce((acc, ev) => {
    const k = String(ev.day_of_week) as string
    if (!acc[k]) acc[k] = []
    acc[k].push(ev)
    return acc
  }, {} as Record<string, ScheduleEvent[]>)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" /> Расписание
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Все пользователи видят события сегодня на главной. Вы можете управлять всеми событиями.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 rounded-full">
          <Plus className="w-4 h-4" /> Новое событие
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12"><LogoSpinner size={36} /></div>
      ) : events.length === 0 ? (
        <div className="border border-dashed rounded-2xl p-10 text-center text-muted-foreground">
          Событий нет. Добавьте расписание!
        </div>
      ) : (
        <div className="space-y-6">
          {DAYS.map(([dayKey, dayName]) => {
            const dayEvents = grouped[dayKey] ?? []
            if (dayEvents.length === 0) return null
            return (
              <div key={dayKey} className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{dayName}</h3>
                <div className="space-y-2">
                  {dayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="bg-card border rounded-xl p-3.5 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm">{ev.title}</div>
                        {ev.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ev.description}</p>
                        )}
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {ev.time_start.slice(0, 5)}{ev.time_end ? ` – ${ev.time_end.slice(0, 5)}` : ''}
                          </span>
                          {ev.class_group && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" /> {ev.class_group}
                            </span>
                          )}
                          {ev.author && (
                            <span className="text-muted-foreground/60">
                              {ev.author.full_name || ev.author.username}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(ev)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(ev)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? 'Изменить событие' : 'Новое событие'}</DialogTitle>
            <DialogDescription>
              Событие увидят все пользователи в день его проведения.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              placeholder="Название *"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <Input
              placeholder="Описание"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <Input
              placeholder="Класс / группа (10А, Robotics...)"
              value={form.class_group}
              onChange={(e) => setForm((f) => ({ ...f, class_group: e.target.value }))}
            />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">День недели</label>
              <Select value={form.day_of_week} onValueChange={(v) => setForm((f) => ({ ...f, day_of_week: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Начало *</label>
                <Input type="time" value={form.time_start} onChange={(e) => setForm((f) => ({ ...f, time_start: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Конец</label>
                <Input type="time" value={form.time_end} onChange={(e) => setForm((f) => ({ ...f, time_end: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Отмена</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LogoSpinner size={16} className="mr-2" /> : <Save className="w-4 h-4 mr-1" />}
              {editId ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
